"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, BarChart3, Search, Settings, Sparkles } from "lucide-react";
import { categories } from "@/data/fixtures";
import { activityColorOptions } from "@/domain/activityColors";
import {
  categoriesForPreferences,
  defaultTimelinePreferences,
  readTimelinePreferences,
  restDayLabel,
  restDayStatusForDate,
  saveTimelinePreferences,
  showRestDaysStorageKey,
  timezoneOptions,
  weeklyHolidayOptions,
  type RestDayKind,
  type TimelinePreferences,
} from "@/domain/preferences";
import { addDays, dateFromTimestamp, defaultClockTimestamp, runtimeClock } from "@/domain/time";
import {
  activityExportRanges,
  activityMatchesDateRange,
  buildActivityExportRows,
  buildActivityExportSettings,
  createActivityCsv,
  createActivityPrintDocument,
  createActivityXls,
  resolveActivityDateRange,
  type ActivityExportRange,
} from "@/domain/activityExport";
import type { Activity, ActivityPriority, Category, Task } from "@/domain/types";
import { createJournalBackup, importJournalBackup, loadJournal, saveJournal, type SampleDataState } from "@/repositories/activityRepository";

type RoutePageProps = {
  eyebrow: string;
  title: string;
  description: string;
  note: string;
};

const selectedDateStorageKey = "workflow.selectedDate";
const settingsTabs = [
  { id: "timeline", label: "Timeline" },
  { id: "rest-days", label: "Rest days" },
  { id: "categories", label: "Categories" },
  { id: "priorities", label: "Priorities" },
  { id: "appearance", label: "Appearance" },
  { id: "data", label: "Data" },
] as const;
type SettingsTab = (typeof settingsTabs)[number]["id"];

const dateForActivity = (activity: Activity, timezone: string) => dateFromTimestamp(activity.startAt, timezone);

const formatDuration = (startAt: string, endAt: string | null, clock: number) => {
  const end = endAt ? new Date(endAt) : new Date(clock);
  const minutes = Math.max(0, Math.round((end.getTime() - new Date(startAt).getTime()) / 60000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const downloadTextFile = (contents: string, type: string, filename: string) => {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const minutesForActivity = (activity: Activity, clock: number) =>
  Math.max(0, Math.round((new Date(activity.endAt ?? new Date(clock).toISOString()).getTime() - new Date(activity.startAt).getTime()) / 60000));

export function RoutePage({ eyebrow, title, description, note }: RoutePageProps) {
  const Icon = eyebrow === "Find your work" ? Search : eyebrow === "See the shape" ? BarChart3 : Settings;
  const [query, setQuery] = useState("");
  const [preferences, setPreferences] = useState<TimelinePreferences>(defaultTimelinePreferences);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return window.localStorage.getItem("workflow.theme") === "dark" ? "dark" : "light";
  });
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sampleDataState, setSampleDataState] = useState<SampleDataState>("pending");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [persistenceNotice, setPersistenceNotice] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState("violet-600");
  const [newPriorityName, setNewPriorityName] = useState("");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("timeline");
  const [exportRange, setExportRange] = useState<ActivityExportRange>("all");
  const [exportStartDate, setExportStartDate] = useState("");
  const [exportEndDate, setExportEndDate] = useState("");
  const [showRestDays, setShowRestDays] = useState(() => (
    typeof window === "undefined" || window.localStorage.getItem(showRestDaysStorageKey) !== "false"
  ));
  const [restDayDate, setRestDayDate] = useState(() => {
    if (typeof window !== "undefined") {
      const storedDate = window.localStorage.getItem(selectedDateStorageKey);
      if (storedDate && /^\d{4}-\d{2}-\d{2}$/.test(storedDate)) return storedDate;
      return dateFromTimestamp(new Date(runtimeClock()).toISOString(), defaultTimelinePreferences.timezone);
    }
    return dateFromTimestamp(new Date(defaultClockTimestamp).toISOString(), defaultTimelinePreferences.timezone);
  });
  const [clock, setClock] = useState(() => defaultClockTimestamp);
  const importInputRef = useRef<HTMLInputElement>(null);
  const visibleActivities = useMemo(() => activities ?? [], [activities]);
  const sampleActivityCount = visibleActivities.filter((activity) => activity.isSample).length;
  const availableCategories = categoriesForPreferences(preferences);
  const configuredCategories = [...categories, ...preferences.customCategories];
  const removedCategories = configuredCategories.filter((category) => !availableCategories.some((item) => item.id === category.id));
  const exportToday = dateFromTimestamp(new Date(clock).toISOString(), preferences.timezone);
  const resolvedExportRange = resolveActivityDateRange(
    exportRange,
    exportToday,
    preferences.timezone,
    exportStartDate,
    exportEndDate,
  );
  const activitiesInExportRange = useMemo(() => {
    if (!activities || !resolvedExportRange) return [];
    return activities.filter((activity) => activityMatchesDateRange(activity, resolvedExportRange, preferences.timezone));
  }, [activities, resolvedExportRange, preferences.timezone]);

  useEffect(() => {
    const syncPreferences = () => setPreferences(readTimelinePreferences());
    syncPreferences();
    const clockFrame = window.requestAnimationFrame(() => setClock(runtimeClock()));
    window.addEventListener("workflow-preferences-change", syncPreferences);
    let mounted = true;
    loadJournal((error) => {
      console.error("Could not load journal history.", error);
      if (mounted) setLoadError("Journal history could not be loaded.");
    }).then((journal) => {
      if (mounted) {
        setActivities(journal?.activities ?? []);
        setTasks(journal?.tasks ?? []);
        setSampleDataState(journal?.sampleDataState ?? "shown");
      }
    });
    const interval = window.setInterval(() => setClock(runtimeClock()), 1000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.cancelAnimationFrame(clockFrame);
      window.removeEventListener("workflow-preferences-change", syncPreferences);
    };
  }, []);

  const matchingActivities = visibleActivities.filter((activity) => {
    const category = configuredCategories.find((item) => item.id === activity.categoryId);
    const haystack = `${activity.title} ${activity.notes} ${activity.tags.join(" ")} ${category?.name ?? ""} ${dateForActivity(activity, preferences.timezone)}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const totals = visibleActivities.reduce(
    (result, activity) => {
      const minutes = minutesForActivity(activity, clock);
      const category = configuredCategories.find((item) => item.id === activity.categoryId);
      result.tracked += minutes;
      if (category?.kind === "focus") result.focus += minutes;
      if (category?.kind === "meeting") result.meetings += minutes;
      return result;
    },
    { tracked: 0, focus: 0, meetings: 0 },
  );

  const categoryTotals = availableCategories.map((category) => ({
    category,
    minutes: visibleActivities
      .filter((activity) => activity.categoryId === category.id)
      .reduce((sum, activity) => sum + minutesForActivity(activity, clock), 0),
  }));

  const dailyTotals = useMemo(() => {
    const totalsByDate = new Map<string, number>();
    visibleActivities.forEach((activity) => {
      const date = dateForActivity(activity, preferences.timezone);
      totalsByDate.set(date, (totalsByDate.get(date) ?? 0) + minutesForActivity(activity, clock));
    });
    return [...totalsByDate.entries()].sort(([left], [right]) => right.localeCompare(left)).slice(0, 7);
  }, [visibleActivities, clock, preferences.timezone]);

  const weeklyMinutes = useMemo(() => {
    const today = dateFromTimestamp(new Date(clock).toISOString(), preferences.timezone);
    const dates = new Set(Array.from({ length: 7 }, (_, index) => addDays(today, -index, preferences.timezone)));
    return visibleActivities.reduce(
      (total, activity) => dates.has(dateForActivity(activity, preferences.timezone)) ? total + minutesForActivity(activity, clock) : total,
      0,
    );
  }, [visibleActivities, clock, preferences.timezone]);

  const updatePreferences = (patch: Partial<TimelinePreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    saveTimelinePreferences(next);
  };

  const toggleRestDays = () => {
    setShowRestDays((current) => {
      const next = !current;
      window.localStorage.setItem(showRestDaysStorageKey, String(next));
      return next;
    });
  };

  const toggleWeeklyHoliday = (day: (typeof weeklyHolidayOptions)[number]["value"]) => {
    const weeklyHolidayDays = preferences.weeklyHolidayDays.includes(day)
      ? preferences.weeklyHolidayDays.filter((value) => value !== day)
      : [...preferences.weeklyHolidayDays, day];
    updatePreferences({ weeklyHolidayDays });
  };

  const selectedRestDayStatus = restDayDate ? restDayStatusForDate(restDayDate, preferences) : null;

  const setSelectedDayStatus = (status: RestDayKind | null) => {
    if (!restDayDate) return;
    const restDayOverrides = { ...preferences.restDayOverrides };
    if (status) restDayOverrides[restDayDate] = status;
    else delete restDayOverrides[restDayDate];
    updatePreferences({ restDayOverrides });
  };

  const toggleCategory = (categoryId: string) => {
    const categoryIds = preferences.categoryIds.includes(categoryId)
      ? preferences.categoryIds.filter((id) => id !== categoryId)
      : [...preferences.categoryIds, categoryId];
    if (categoryIds.length === 0) return;
    updatePreferences({ categoryIds });
  };

  const addCategory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newCategoryName.trim();
    if (!name) {
      setPersistenceNotice("Enter a category name before adding it.");
      return;
    }
    if (configuredCategories.some((category) => category.name.toLowerCase() === name.toLowerCase())) {
      setPersistenceNotice("A category with that name already exists.");
      return;
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "category";
    const category: Category = {
      id: `custom-${slug}-${Date.now()}`,
      name,
      kind: null,
      colorToken: newCategoryColor as Category["colorToken"],
      icon: "FileText",
    };
    updatePreferences({
      customCategories: [...preferences.customCategories, category],
      categoryIds: [...preferences.categoryIds, category.id],
      categorySettings: {
        ...preferences.categorySettings,
        [category.id]: { colorToken: category.colorToken, priority: preferences.priorityOptions.includes("normal") ? "normal" : preferences.priorityOptions[0] },
      },
    });
    setNewCategoryName("");
    setPersistenceNotice(`Added category "${name}".`);
  };

  const removeCategory = (category: Category) => {
    if (availableCategories.length <= 1) {
      setPersistenceNotice("Keep at least one category available.");
      return;
    }
    updatePreferences({
      removedCategoryIds: [...new Set([...preferences.removedCategoryIds, category.id])],
      categoryIds: preferences.categoryIds.filter((id) => id !== category.id),
    });
    setPersistenceNotice(`Removed category "${category.name}". Existing activities were preserved.`);
  };

  const restoreCategory = (categoryId: string) => {
    updatePreferences({
      removedCategoryIds: preferences.removedCategoryIds.filter((id) => id !== categoryId),
      categoryIds: preferences.categoryIds.includes(categoryId)
        ? preferences.categoryIds
        : [...preferences.categoryIds, categoryId],
    });
    setPersistenceNotice("Category restored.");
  };

  const addPriority = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newPriorityName.trim();
    const value = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!value) {
      setPersistenceNotice("Enter a priority name before adding it.");
      return;
    }
    if (preferences.priorityOptions.some((priority) => priority.toLowerCase() === value)) {
      setPersistenceNotice("That priority already exists.");
      return;
    }
    updatePreferences({ priorityOptions: [...preferences.priorityOptions, value] });
    setNewPriorityName("");
    setPersistenceNotice(`Added priority "${name}".`);
  };

  const removePriority = (priority: ActivityPriority) => {
    if (preferences.priorityOptions.length <= 1) {
      setPersistenceNotice("Keep at least one priority available.");
      return;
    }
    if (visibleActivities.some((activity) => activity.priority === priority)) {
      setPersistenceNotice(`Cannot remove "${priority}" because existing activities use it.`);
      return;
    }
    const priorityOptions = preferences.priorityOptions.filter((item) => item !== priority);
    const fallbackPriority = priorityOptions.includes("normal") ? "normal" : priorityOptions[0] ?? "normal";
    const categorySettings = Object.fromEntries(
      Object.entries(preferences.categorySettings).map(([categoryId, setting]) => [
        categoryId,
        setting.priority === priority ? { ...setting, priority: fallbackPriority } : setting,
      ]),
    );
    updatePreferences({ priorityOptions, categorySettings });
    setPersistenceNotice(`Removed priority "${priority}".`);
  };

  const updateCategorySetting = (
    categoryId: string,
    patch: Partial<TimelinePreferences["categorySettings"][string]>,
  ) => {
    updatePreferences({
      categorySettings: {
        ...preferences.categorySettings,
        [categoryId]: {
          ...preferences.categorySettings[categoryId],
          ...patch,
        },
      },
    });
  };

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    window.localStorage.setItem("workflow.theme", nextTheme);
    setTheme(nextTheme);
  };

  const exportBackup = () => {
    if (activities === null) {
      setPersistenceNotice("Activity history is still loading.");
      return;
    }
    const blob = new Blob([createJournalBackup({ activities, tasks, sampleDataState })], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `workflow-journal-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setPersistenceNotice(`Exported ${activities.length} ${activities.length === 1 ? "activity" : "activities"} and ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}.`);
  };

  const clearSampleEntries = async () => {
    if (activities === null) {
      setPersistenceNotice("Activity history is still loading.");
      return;
    }
    const sampleEntries = activities.filter((activity) => activity.isSample);
    if (sampleEntries.length === 0) return;
    if (!window.confirm(`Clear ${sampleEntries.length} sample ${sampleEntries.length === 1 ? "entry" : "entries"}? Your activities and tasks will stay.`)) return;

    const remainingActivities = activities.filter((activity) => !activity.isSample);
    const result = await saveJournal({
      activities: remainingActivities,
      tasks,
      sampleDataState: "cleared",
    }, (error) => console.error("Could not clear sample activities.", error));
    if (!result.saved) {
      setPersistenceNotice("Sample entries could not be cleared. Your current activities were kept.");
      return;
    }

    setActivities(remainingActivities);
    setSampleDataState("cleared");
    setPersistenceNotice(result.remoteError
      ? `Cleared ${sampleEntries.length} sample ${sampleEntries.length === 1 ? "entry" : "entries"} in this browser. The data service could not be updated.`
      : `Cleared ${sampleEntries.length} sample ${sampleEntries.length === 1 ? "entry" : "entries"}. Your other activities were kept.`);
  };

  const exportActivityReport = (format: "csv" | "xls" | "pdf") => {
    if (activities === null) {
      setPersistenceNotice("Activity history is still loading.");
      return;
    }
    if (!resolvedExportRange) {
      setPersistenceNotice("Choose a valid start and end date for your export.");
      return;
    }
    if (activitiesInExportRange.length === 0) {
      setPersistenceNotice("There are no activities in that date range.");
      return;
    }

    const rows = buildActivityExportRows(
      activitiesInExportRange,
      configuredCategories,
      tasks,
      preferences.timezone,
      clock,
    );
    const storedViewMode = window.localStorage.getItem("workflow.viewMode");
    const viewMode = storedViewMode === "kanban" || storedViewMode === "table" ? storedViewMode : "timeline";
    const settings = buildActivityExportSettings(preferences, configuredCategories, theme, showRestDays, viewMode);
    const rangeLabel = exportRange === "all"
      ? "All dates"
      : exportRange === "custom"
        ? `${exportStartDate} to ${exportEndDate}`
        : activityExportRanges.find((range) => range.value === exportRange)?.label ?? "Selected dates";
    const rangeFilePart = resolvedExportRange.from && resolvedExportRange.to
      ? `${resolvedExportRange.from}-to-${resolvedExportRange.to}`
      : "all-dates";

    if (format === "pdf") {
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        setPersistenceNotice("Allow pop-ups to open the PDF export. Choose Save as PDF in the print window.");
        return;
      }
      printWindow.document.open();
      printWindow.document.write(createActivityPrintDocument(rows, rangeLabel, preferences.timezone, settings));
      printWindow.document.close();
      printWindow.focus();
      window.setTimeout(() => printWindow.print(), 250);
      setPersistenceNotice("Choose Save as PDF in the print window to download your report.");
      return;
    }

    if (format === "csv") {
      downloadTextFile(createActivityCsv(rows, settings), "text/csv;charset=utf-8", `workflow-activities-${rangeFilePart}.csv`);
      setPersistenceNotice(`Exported ${rows.length} activities as CSV.`);
      return;
    }

    downloadTextFile(createActivityXls(rows, settings), "application/vnd.ms-excel;charset=utf-8", `workflow-activities-${rangeFilePart}.xls`);
    setPersistenceNotice(`Exported ${rows.length} activities as Excel.`);
  };

  const importBackup = async (file: File) => {
    if (!window.confirm("Importing a backup replaces the journal data currently stored in this browser. Continue?")) return;
    try {
      const imported = await importJournalBackup(await file.text(), (error) => {
        console.error("Could not save imported journal history.", error);
      });
      if (!imported) {
        setPersistenceNotice("The backup could not be saved. Your current activities were kept.");
        return;
      }
      setActivities(imported.activities);
      setTasks(imported.tasks);
      setSampleDataState(imported.sampleDataState ?? "shown");
      setPersistenceNotice(`Imported ${imported.activities.length} ${imported.activities.length === 1 ? "activity" : "activities"} and ${imported.tasks.length} ${imported.tasks.length === 1 ? "task" : "tasks"}.`);
    } catch (error) {
      setPersistenceNotice(error instanceof Error ? error.message : "The selected backup could not be imported.");
    }
  };

  const isSearch = eyebrow === "Find your work";
  const isStatistics = eyebrow === "See the shape";
  const isSettings = eyebrow === "Make it yours";

  return (
    <div className={"route"}>
      <main className={"route__shell"}>
        <header className={"route__topline"}>
          <Link className={"route__brand"} href="/"><span className={"route__brand-mark"}>W</span>WorkFlow Journal</Link>
          <Link className={"route__back"} href="/"><ArrowLeft size={15} /> Timeline</Link>
        </header>
        <section className={"route__content"} aria-labelledby="route-title">
          <p className={"route__eyebrow"}>{eyebrow}</p>
          <h1 className={"route__title"} id="route-title">{title}</h1>
          <p className={"route__description"}>{description}</p>

          {isSearch && (
            <div className={"search"}>
              <label className={"search__label"} htmlFor="activity-search">Search activities</label>
              <div className={"search__field"}><Search size={16} /><input id="activity-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try “research”, “prototype”, or a date" autoFocus /></div>
              {loadError && <p className={"route__error"} role="alert">{loadError}</p>}
              {activities === null && !loadError && <p className={"route__empty"}>Loading activity history…</p>}
              <div className={"search__results"}>
                {activities !== null && !loadError && matchingActivities.map((activity) => {
                  const category = configuredCategories.find((item) => item.id === activity.categoryId) ?? categories[0];
                  return (
                    <Link className={"search__result"} href={`/?date=${dateForActivity(activity, preferences.timezone)}`} key={activity.id}>
                      <div><strong>{activity.title}</strong><span>{category.name} · {formatDuration(activity.startAt, activity.endAt, clock)}{activity.priority && activity.priority !== "normal" ? ` · ${activity.priority} priority` : ""}</span></div>
                      <time>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: preferences.timezone }).format(new Date(activity.startAt))}</time>
                    </Link>
                  );
                })}
                {activities !== null && !loadError && matchingActivities.length === 0 && <p className={"route__empty"}>No activities match those filters.</p>}
              </div>
            </div>
          )}

          {isStatistics && (
            <div className={"statistics"}>
              {loadError && <p className={"route__error"} role="alert">{loadError}</p>}
              {activities === null && !loadError && <p className={"route__empty"}>Loading activity history…</p>}
              <div className={"statistics__grid"}>
                <div className={"statistics__stat"}><span>Tracked time</span><strong>{Math.floor(totals.tracked / 60)}h {totals.tracked % 60}m</strong><small>sum of recorded work</small></div>
                <div className={"statistics__stat"}><span>Deep work</span><strong>{Math.floor(totals.focus / 60)}h {totals.focus % 60}m</strong><small>category kind: focus</small></div>
                <div className={"statistics__stat"}><span>Meetings</span><strong>{Math.floor(totals.meetings / 60)}h {totals.meetings % 60}m</strong><small>category kind: meeting</small></div>
                <div className={"statistics__stat"}><span>Last 7 days</span><strong>{Math.floor(weeklyMinutes / 60)}h {weeklyMinutes % 60}m</strong><small>calendar-week window</small></div>
              </div>
              <div className={"category-breakdown"} aria-label="Category breakdown">
                {categoryTotals.map(({ category, minutes }) => (
                  <div className={"category-breakdown__row"} key={category.id}>
                    <span>{category.name}</span>
                    <div className={"category-breakdown__bar"}><i style={{ width: `${Math.min(100, (minutes / Math.max(totals.tracked, 1)) * 100)}%` }} /></div>
                    <strong>{Math.floor(minutes / 60)}h {minutes % 60}m</strong>
                  </div>
                ))}
              </div>
              <div className={"statistics__daily"} aria-label="Recent daily totals">
                <h2>Recent days</h2>
                {dailyTotals.map(([date, minutes]) => (
                  <Link className={"statistics__daily-row"} href={`/?date=${date}`} key={date}>
                    <span>{date}</span>
                    <strong>{Math.floor(minutes / 60)}h {minutes % 60}m</strong>
                  </Link>
                ))}
                {dailyTotals.length === 0 && <p className={"route__empty"}>No recorded days yet.</p>}
              </div>
            </div>
          )}

          {isSettings && (
            <div className={"settings"}>
              <div className={"settings__layout"}>
                <div className={"settings__tabs"} role="tablist" aria-label="Settings sections">
                  {settingsTabs.map((tab) => (
                    <button
                      className={`${"settings__tab"} ${settingsTab === tab.id ? "settings__tab--active" : ""}`}
                      type="button"
                      role="tab"
                      id={`settings-tab-${tab.id}`}
                      aria-selected={settingsTab === tab.id}
                      aria-controls={`settings-panel-${tab.id}`}
                      key={tab.id}
                      onClick={() => setSettingsTab(tab.id)}
                    >
                      <strong>{tab.label}</strong>
                    </button>
                  ))}
                </div>

                <div className={"settings__content"}>
                {settingsTab === "timeline" && (
                <section className={"settings__panel"} id="settings-panel-timeline" role="tabpanel" aria-labelledby="settings-tab-timeline">
                  <div className={"settings__row"}>
                    <div><strong>Visible day</strong><span>Keep the timeline focused on your working hours.</span></div>
                    <div className={"settings__field-pair"}>
                      <label>From<select value={preferences.startHour} onChange={(event) => updatePreferences({ startHour: event.target.value })}><option>07:00</option><option>08:00</option><option>09:00</option></select></label>
                      <label>To<select value={preferences.endHour} onChange={(event) => updatePreferences({ endHour: event.target.value })}><option>18:00</option><option>20:00</option><option>22:00</option></select></label>
                    </div>
                  </div>
                  <div className={"settings__row"}>
                    <div><strong>Snap interval</strong><span>Editing increments stay independent from zoom.</span></div>
                    <select aria-label="Snap interval" className={"settings__select"} value={preferences.snapMinutes} onChange={(event) => updatePreferences({ snapMinutes: Number(event.target.value) as TimelinePreferences["snapMinutes"] })}><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">60 minutes</option></select>
                  </div>
                  <div className={"settings__row"}>
                    <div><strong>Timezone</strong><span>Wall-clock dates and activity times use this zone.</span></div>
                    <select aria-label="Timezone" className={"settings__select"} value={preferences.timezone} onChange={(event) => updatePreferences({ timezone: event.target.value as TimelinePreferences["timezone"] })}>{timezoneOptions.map((timezoneOption) => <option key={timezoneOption} value={timezoneOption}>{timezoneOption}</option>)}</select>
                  </div>
                  <p className={"settings__footnote"}>Timeline preview: {preferences.startHour}–{preferences.endHour} · snap to {preferences.snapMinutes} minutes · {preferences.timezone}.</p>
                </section>
                )}

                {settingsTab === "rest-days" && (
                <section className={"settings__panel"} id="settings-panel-rest-days" role="tabpanel" aria-labelledby="settings-tab-rest-days">
                  <div className={"settings__row"}>
                    <div><strong>Rest-day rows</strong><span>Show or hide weekly holidays, public holidays, and leave rows in the timeline.</span></div>
                    <button className={"settings__toggle"} type="button" onClick={toggleRestDays} aria-pressed={showRestDays} data-setting="rest-days-visibility" data-setting-scope="global">{showRestDays ? "Shown" : "Hidden"}</button>
                  </div>
                  <div className={`${"settings__row"} ${"rest-days__section"}`}>
                    <div><strong>Weekly holidays</strong><span>Choose the days that repeat every week.</span></div>
                    <div className={"rest-days__weekdays"}>
                      {weeklyHolidayOptions.map((day) => (
                        <label className={"rest-days__weekday"} key={day.value}>
                          <input type="checkbox" checked={preferences.weeklyHolidayDays.includes(day.value)} onChange={() => toggleWeeklyHoliday(day.value)} />
                          <span>{day.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className={`${"settings__row"} ${"rest-days__section"}`}>
                    <div><strong>Date marker</strong><span>Mark one whole day as a public holiday or leave.</span></div>
                    <div className={"rest-days__editor"}>
                      <label className={"rest-days__date"}><span>Date</span><input type="date" aria-label="Date to mark" value={restDayDate} onChange={(event) => setRestDayDate(event.currentTarget.value)} /></label>
                      <span className={"rest-days__status"}>{selectedRestDayStatus ? restDayLabel(selectedRestDayStatus) : "Working day"}</span>
                      <div className={"rest-days__actions"}>
                        <button className={`${"rest-days__button"} ${selectedRestDayStatus === "public-holiday" ? "rest-days__button--selected" : ""}`} type="button" aria-pressed={selectedRestDayStatus === "public-holiday"} onClick={() => setSelectedDayStatus("public-holiday")}>Public holiday</button>
                        <button className={`${"rest-days__button"} ${selectedRestDayStatus === "leave" ? "rest-days__button--selected" : ""}`} type="button" aria-pressed={selectedRestDayStatus === "leave"} onClick={() => setSelectedDayStatus("leave")}>Leave</button>
                      </div>
                      {selectedRestDayStatus && <button className={"rest-days__clear"} type="button" onClick={() => setSelectedDayStatus(null)}>Clear date marker</button>}
                    </div>
                  </div>
                </section>
                )}

                {settingsTab === "categories" && (
                <section className={"settings__panel"} id="settings-panel-categories" role="tabpanel" aria-labelledby="settings-tab-categories">
                  <div className={`${"settings__row"} ${"settings__management"}`}>
                    <div><strong>Manage categories</strong><span>Add categories with a color, or remove categories from future activity forms.</span></div>
                    <div className={"settings__management-panel"}>
                      <form className={"settings__management-form"} onSubmit={addCategory}>
                        <label>Category name<input aria-label="New category name" value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="e.g. Client work" /></label>
                        <label>Color<select aria-label="New category color" value={newCategoryColor} onChange={(event) => setNewCategoryColor(event.target.value)}>{activityColorOptions.map((option) => <option key={option.token} value={option.token}>{option.label}</option>)}</select></label>
                        <button className={"settings__toggle"} type="submit">Add category</button>
                      </form>
                      {removedCategories.length > 0 && <div className={"settings__management-list"}><span className={"settings__management-list-label"}>Removed categories</span>{removedCategories.map((category) => <div className={"settings__management-row"} key={category.id}><span>{category.name}</span><button className={"settings__text-button"} type="button" onClick={() => restoreCategory(category.id)}>Restore</button></div>)}</div>}
                    </div>
                  </div>
                  <div className={"settings__row"}><div><strong>Visible categories</strong><span>Hide categories from the timeline without deleting their history.</span></div><div className={"settings__category-checks"}>{availableCategories.map((category) => <label key={category.id}><input type="checkbox" checked={preferences.categoryIds.includes(category.id)} onChange={() => toggleCategory(category.id)} />{category.name}</label>)}</div></div>
                  <div className={`${"settings__row"} ${"settings__category-defaults"}`}><div><strong>Category defaults</strong><span>Set each category&apos;s global color and priority for new activities.</span></div><div className={"settings__categories"}>{availableCategories.map((category) => { const setting = preferences.categorySettings[category.id] ?? { colorToken: category.colorToken, priority: preferences.priorityOptions[0] ?? "normal" }; return <div className={"settings__category"} key={category.id}><div className={"settings__category-name"}><span className={"settings__category-dot"} style={{ background: `var(--activity-color-${setting.colorToken})` }} /><strong>{category.name}</strong><button className={"settings__text-button"} type="button" onClick={() => removeCategory(category)} aria-label={`Remove ${category.name} category`}>Remove</button></div><div className={"settings__category-controls"}><label>Color<select aria-label={`${category.name} color`} value={setting.colorToken} onChange={(event) => updateCategorySetting(category.id, { colorToken: event.target.value as typeof setting.colorToken })}>{activityColorOptions.map((option) => <option key={option.token} value={option.token}>{option.label}</option>)}</select></label><label>Priority<select aria-label={`${category.name} default priority`} value={setting.priority} onChange={(event) => updateCategorySetting(category.id, { priority: event.target.value as ActivityPriority })}>{preferences.priorityOptions.map((priority) => <option key={priority} value={priority}>{priority.replace(/[-_]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())}</option>)}</select></label></div></div>; })}</div></div>
                </section>
                )}

                {settingsTab === "priorities" && (
                <section className={"settings__panel"} id="settings-panel-priorities" role="tabpanel" aria-labelledby="settings-tab-priorities">
                  <div className={"settings__row"}><div><strong>Manage priorities</strong><span>Priority options are global. Existing activities keep their recorded value.</span></div><div className={"settings__management-panel"}><form className={"settings__management-form"} onSubmit={addPriority}><label>Priority name<input aria-label="New priority name" value={newPriorityName} onChange={(event) => setNewPriorityName(event.target.value)} placeholder="e.g. Urgent" /></label><button className={"settings__toggle"} type="submit">Add priority</button></form><div className={"settings__management-list"}>{preferences.priorityOptions.map((priority) => <div className={"settings__management-row"} key={priority}><span>{priority.replace(/[-_]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())}</span><button className={"settings__text-button"} type="button" onClick={() => removePriority(priority)} aria-label={`Remove ${priority} priority`}>Remove</button></div>)}</div></div></div>
                </section>
                )}

                {settingsTab === "appearance" && (
                <section className={"settings__panel"} id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance">
                  <div className={"settings__row"}><div><strong>Theme</strong><span>Light and dark are saved under workflow.theme.</span></div><button className={"settings__toggle"} type="button" onClick={toggleTheme} aria-pressed={theme === "dark"}>{theme === "dark" ? "Dark" : "Light"}</button></div>
                </section>
                )}

                {settingsTab === "data" && (
                <section className={"settings__panel"} id="settings-panel-data" role="tabpanel" aria-labelledby="settings-tab-data">
                  <div className={"settings__export"}>
                    <div className={"settings__export-heading"}>
                      <div><strong>Activity export</strong><span>Download your activity log for a date range.</span></div>
                      <span className={"settings__export-count"}>{activities === null ? "Loading activities…" : `${activitiesInExportRange.length} ${activitiesInExportRange.length === 1 ? "activity" : "activities"}`}</span>
                    </div>
                    <div className={"settings__export-controls"}>
                      <label>Date range<select aria-label="Export date range" className={"settings__select"} value={exportRange} onChange={(event) => {
                        const nextRange = event.target.value as ActivityExportRange;
                        if (nextRange === "custom" && (!exportStartDate || !exportEndDate)) {
                          setExportStartDate(exportToday);
                          setExportEndDate(exportToday);
                        }
                        setExportRange(nextRange);
                      }}>{activityExportRanges.map((range) => <option value={range.value} key={range.value}>{range.label}</option>)}</select></label>
                      {exportRange === "custom" && <>
                        <label>From<input aria-label="Export start date" type="date" value={exportStartDate} onChange={(event) => setExportStartDate(event.target.value)} /></label>
                        <label>To<input aria-label="Export end date" type="date" value={exportEndDate} onChange={(event) => setExportEndDate(event.target.value)} /></label>
                      </>}
                    </div>
                    <div className={"settings__export-actions"}>
                      <button className={"settings__toggle"} type="button" disabled={activities === null || !resolvedExportRange} onClick={() => exportActivityReport("xls")}>Export Excel</button>
                      <button className={"settings__toggle"} type="button" disabled={activities === null || !resolvedExportRange} onClick={() => exportActivityReport("csv")}>Export CSV</button>
                      <button className={"settings__toggle"} type="button" disabled={activities === null || !resolvedExportRange} onClick={() => exportActivityReport("pdf")}>Export PDF</button>
                    </div>
                    <p className={"settings__footnote"}>Each export includes the matching activities and your current journal settings. PDF opens a print window where you can choose Save as PDF.</p>
                  </div>
                  <div className={"settings__row"}>
                    <div><strong>Sample entries</strong><span>Examples appear automatically when the journal is empty. Clear them here; activities you recorded will stay.</span></div>
                    <button
                      className={"settings__toggle"}
                      type="button"
                      disabled={activities === null || sampleActivityCount === 0}
                      onClick={() => void clearSampleEntries()}
                    >
                      Clear sample entries{sampleActivityCount > 0 ? ` · ${sampleActivityCount}` : ""}
                    </button>
                  </div>
                  <div className={"settings__row"}><div><strong>Activity backup</strong><span>Export a JSON copy or replace this browser&apos;s activities from a validated backup.</span></div><div className={"settings__backup-actions"}><button className={"settings__toggle"} type="button" onClick={exportBackup}>Export backup</button><button className={"settings__toggle"} type="button" onClick={() => importInputRef.current?.click()}>Import backup</button><input className={"settings__file-input"} ref={importInputRef} type="file" accept="application/json,.json" aria-label="Choose activity backup" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBackup(file); event.target.value = ""; }} /></div></div>
                </section>
                )}

                {persistenceNotice && <p className={"settings__notice"} role="pwa-status">{persistenceNotice}</p>}
                </div>
              </div>
            </div>
          )}

          {!isSearch && !isStatistics && !isSettings && <p className={"route__note"}><Icon size={15} /><Sparkles size={14} />{note}</p>}
        </section>
      </main>
    </div>
  );
}
