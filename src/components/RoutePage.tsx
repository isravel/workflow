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
import type { Activity, ActivityPriority, Category, Task } from "@/domain/types";
import { createJournalBackup, importJournalBackup, loadJournal } from "@/repositories/activityRepository";
import styles from "../styles/route-page.module.scss";

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [persistenceNotice, setPersistenceNotice] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState("violet-600");
  const [newPriorityName, setNewPriorityName] = useState("");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("timeline");
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
  const availableCategories = categoriesForPreferences(preferences);
  const configuredCategories = [...categories, ...preferences.customCategories];
  const removedCategories = configuredCategories.filter((category) => !availableCategories.some((item) => item.id === category.id));

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
    const blob = new Blob([createJournalBackup({ activities, tasks })], { type: "application/json" });
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
      setPersistenceNotice(`Imported ${imported.activities.length} ${imported.activities.length === 1 ? "activity" : "activities"} and ${imported.tasks.length} ${imported.tasks.length === 1 ? "task" : "tasks"}.`);
    } catch (error) {
      setPersistenceNotice(error instanceof Error ? error.message : "The selected backup could not be imported.");
    }
  };

  const isSearch = eyebrow === "Find your work";
  const isStatistics = eyebrow === "See the shape";
  const isSettings = eyebrow === "Make it yours";

  return (
    <div className={styles.page}>
      <main className={styles.shell}>
        <header className={styles.topline}>
          <Link className={styles.brand} href="/"><span className={styles.brandMark}>W</span>WorkFlow Journal</Link>
          <Link className={styles.back} href="/"><ArrowLeft size={15} /> Timeline</Link>
        </header>
        <section className={styles.content} aria-labelledby="route-title">
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title} id="route-title">{title}</h1>
          <p className={styles.description}>{description}</p>

          {isSearch && (
            <div className={styles.searchPanel}>
              <label className={styles.label} htmlFor="activity-search">Search activities</label>
              <div className={styles.searchField}><Search size={16} /><input id="activity-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try “research”, “prototype”, or a date" autoFocus /></div>
              {loadError && <p className={styles.errorResult} role="alert">{loadError}</p>}
              {activities === null && !loadError && <p className={styles.emptyResult}>Loading activity history…</p>}
              <div className={styles.resultList}>
                {activities !== null && !loadError && matchingActivities.map((activity) => {
                  const category = configuredCategories.find((item) => item.id === activity.categoryId) ?? categories[0];
                  return (
                    <Link className={styles.result} href={`/?date=${dateForActivity(activity, preferences.timezone)}`} key={activity.id}>
                      <div><strong>{activity.title}</strong><span>{category.name} · {formatDuration(activity.startAt, activity.endAt, clock)}{activity.priority && activity.priority !== "normal" ? ` · ${activity.priority} priority` : ""}</span></div>
                      <time>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: preferences.timezone }).format(new Date(activity.startAt))}</time>
                    </Link>
                  );
                })}
                {activities !== null && !loadError && matchingActivities.length === 0 && <p className={styles.emptyResult}>No activities match those filters.</p>}
              </div>
            </div>
          )}

          {isStatistics && (
            <div className={styles.statsPanel}>
              {loadError && <p className={styles.errorResult} role="alert">{loadError}</p>}
              {activities === null && !loadError && <p className={styles.emptyResult}>Loading activity history…</p>}
              <div className={styles.statGrid}>
                <div className={styles.stat}><span>Tracked time</span><strong>{Math.floor(totals.tracked / 60)}h {totals.tracked % 60}m</strong><small>sum of recorded work</small></div>
                <div className={styles.stat}><span>Deep work</span><strong>{Math.floor(totals.focus / 60)}h {totals.focus % 60}m</strong><small>category kind: focus</small></div>
                <div className={styles.stat}><span>Meetings</span><strong>{Math.floor(totals.meetings / 60)}h {totals.meetings % 60}m</strong><small>category kind: meeting</small></div>
                <div className={styles.stat}><span>Last 7 days</span><strong>{Math.floor(weeklyMinutes / 60)}h {weeklyMinutes % 60}m</strong><small>calendar-week window</small></div>
              </div>
              <div className={styles.categoryList} aria-label="Category breakdown">
                {categoryTotals.map(({ category, minutes }) => (
                  <div className={styles.categoryRow} key={category.id}>
                    <span>{category.name}</span>
                    <div className={styles.categoryBar}><i style={{ width: `${Math.min(100, (minutes / Math.max(totals.tracked, 1)) * 100)}%` }} /></div>
                    <strong>{Math.floor(minutes / 60)}h {minutes % 60}m</strong>
                  </div>
                ))}
              </div>
              <div className={styles.dailyList} aria-label="Recent daily totals">
                <h2>Recent days</h2>
                {dailyTotals.map(([date, minutes]) => (
                  <Link className={styles.dailyRow} href={`/?date=${date}`} key={date}>
                    <span>{date}</span>
                    <strong>{Math.floor(minutes / 60)}h {minutes % 60}m</strong>
                  </Link>
                ))}
                {dailyTotals.length === 0 && <p className={styles.emptyResult}>No recorded days yet.</p>}
              </div>
            </div>
          )}

          {isSettings && (
            <div className={styles.settingsPanel}>
              <div className={styles.settingsLayout}>
                <div className={styles.settingsTabs} role="tablist" aria-label="Settings sections">
                  {settingsTabs.map((tab) => (
                    <button
                      className={`${styles.settingsTab} ${settingsTab === tab.id ? styles.settingsTabActive : ""}`}
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

                <div className={styles.settingsTabContent}>
                {settingsTab === "timeline" && (
                <section className={styles.settingsTabPanel} id="settings-panel-timeline" role="tabpanel" aria-labelledby="settings-tab-timeline">
                  <div className={styles.setting}>
                    <div><strong>Visible day</strong><span>Keep the timeline focused on your working hours.</span></div>
                    <div className={styles.fieldPair}>
                      <label>From<select value={preferences.startHour} onChange={(event) => updatePreferences({ startHour: event.target.value })}><option>07:00</option><option>08:00</option><option>09:00</option></select></label>
                      <label>To<select value={preferences.endHour} onChange={(event) => updatePreferences({ endHour: event.target.value })}><option>18:00</option><option>20:00</option><option>22:00</option></select></label>
                    </div>
                  </div>
                  <div className={styles.setting}>
                    <div><strong>Snap interval</strong><span>Editing increments stay independent from zoom.</span></div>
                    <select aria-label="Snap interval" className={styles.select} value={preferences.snapMinutes} onChange={(event) => updatePreferences({ snapMinutes: Number(event.target.value) as TimelinePreferences["snapMinutes"] })}><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">60 minutes</option></select>
                  </div>
                  <div className={styles.setting}>
                    <div><strong>Timezone</strong><span>Wall-clock dates and activity times use this zone.</span></div>
                    <select aria-label="Timezone" className={styles.select} value={preferences.timezone} onChange={(event) => updatePreferences({ timezone: event.target.value as TimelinePreferences["timezone"] })}>{timezoneOptions.map((timezoneOption) => <option key={timezoneOption} value={timezoneOption}>{timezoneOption}</option>)}</select>
                  </div>
                  <p className={styles.settingFootnote}>Timeline preview: {preferences.startHour}–{preferences.endHour} · snap to {preferences.snapMinutes} minutes · {preferences.timezone}.</p>
                </section>
                )}

                {settingsTab === "rest-days" && (
                <section className={styles.settingsTabPanel} id="settings-panel-rest-days" role="tabpanel" aria-labelledby="settings-tab-rest-days">
                  <div className={styles.setting}>
                    <div><strong>Rest-day rows</strong><span>Show or hide weekly holidays, public holidays, and leave rows in the timeline.</span></div>
                    <button className={styles.toggle} type="button" onClick={toggleRestDays} aria-pressed={showRestDays}>{showRestDays ? "Shown" : "Hidden"}</button>
                  </div>
                  <div className={`${styles.setting} ${styles.restDaysSetting}`}>
                    <div><strong>Weekly holidays</strong><span>Choose the days that repeat every week.</span></div>
                    <div className={styles.weekdayOptions}>
                      {weeklyHolidayOptions.map((day) => (
                        <label className={styles.weekdayOption} key={day.value}>
                          <input type="checkbox" checked={preferences.weeklyHolidayDays.includes(day.value)} onChange={() => toggleWeeklyHoliday(day.value)} />
                          <span>{day.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className={`${styles.setting} ${styles.restDaysSetting}`}>
                    <div><strong>Date marker</strong><span>Mark one whole day as a public holiday or leave.</span></div>
                    <div className={styles.restDayEditor}>
                      <label className={styles.restDaysDateField}><span>Date</span><input type="date" aria-label="Date to mark" value={restDayDate} onChange={(event) => setRestDayDate(event.currentTarget.value)} /></label>
                      <span className={styles.restDayCurrentStatus}>{selectedRestDayStatus ? restDayLabel(selectedRestDayStatus) : "Working day"}</span>
                      <div className={styles.restDayActions}>
                        <button className={`${styles.restDayButton} ${selectedRestDayStatus === "public-holiday" ? styles.restDayButtonSelected : ""}`} type="button" aria-pressed={selectedRestDayStatus === "public-holiday"} onClick={() => setSelectedDayStatus("public-holiday")}>Public holiday</button>
                        <button className={`${styles.restDayButton} ${selectedRestDayStatus === "leave" ? styles.restDayButtonSelected : ""}`} type="button" aria-pressed={selectedRestDayStatus === "leave"} onClick={() => setSelectedDayStatus("leave")}>Leave</button>
                      </div>
                      {selectedRestDayStatus && <button className={styles.clearRestDayButton} type="button" onClick={() => setSelectedDayStatus(null)}>Clear date marker</button>}
                    </div>
                  </div>
                </section>
                )}

                {settingsTab === "categories" && (
                <section className={styles.settingsTabPanel} id="settings-panel-categories" role="tabpanel" aria-labelledby="settings-tab-categories">
                  <div className={`${styles.setting} ${styles.managementSetting}`}>
                    <div><strong>Manage categories</strong><span>Add categories with a color, or remove categories from future activity forms.</span></div>
                    <div className={styles.managementPanel}>
                      <form className={styles.managementForm} onSubmit={addCategory}>
                        <label>Category name<input aria-label="New category name" value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="e.g. Client work" /></label>
                        <label>Color<select aria-label="New category color" value={newCategoryColor} onChange={(event) => setNewCategoryColor(event.target.value)}>{activityColorOptions.map((option) => <option key={option.token} value={option.token}>{option.label}</option>)}</select></label>
                        <button className={styles.toggle} type="submit">Add category</button>
                      </form>
                      {removedCategories.length > 0 && <div className={styles.managementList}><span className={styles.managementListLabel}>Removed categories</span>{removedCategories.map((category) => <div className={styles.managementRow} key={category.id}><span>{category.name}</span><button className={styles.textButton} type="button" onClick={() => restoreCategory(category.id)}>Restore</button></div>)}</div>}
                    </div>
                  </div>
                  <div className={styles.setting}><div><strong>Visible categories</strong><span>Hide categories from the timeline without deleting their history.</span></div><div className={styles.categoryChecks}>{availableCategories.map((category) => <label key={category.id}><input type="checkbox" checked={preferences.categoryIds.includes(category.id)} onChange={() => toggleCategory(category.id)} />{category.name}</label>)}</div></div>
                  <div className={`${styles.setting} ${styles.categorySettingsSetting}`}><div><strong>Category defaults</strong><span>Set each category&apos;s global color and priority for new activities.</span></div><div className={styles.categorySettings}>{availableCategories.map((category) => { const setting = preferences.categorySettings[category.id] ?? { colorToken: category.colorToken, priority: preferences.priorityOptions[0] ?? "normal" }; return <div className={styles.categorySetting} key={category.id}><div className={styles.categorySettingName}><span className={styles.categoryColorDot} style={{ background: `var(--activity-color-${setting.colorToken})` }} /><strong>{category.name}</strong><button className={styles.textButton} type="button" onClick={() => removeCategory(category)} aria-label={`Remove ${category.name} category`}>Remove</button></div><div className={styles.categorySettingControls}><label>Color<select aria-label={`${category.name} color`} value={setting.colorToken} onChange={(event) => updateCategorySetting(category.id, { colorToken: event.target.value as typeof setting.colorToken })}>{activityColorOptions.map((option) => <option key={option.token} value={option.token}>{option.label}</option>)}</select></label><label>Priority<select aria-label={`${category.name} default priority`} value={setting.priority} onChange={(event) => updateCategorySetting(category.id, { priority: event.target.value as ActivityPriority })}>{preferences.priorityOptions.map((priority) => <option key={priority} value={priority}>{priority.replace(/[-_]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())}</option>)}</select></label></div></div>; })}</div></div>
                </section>
                )}

                {settingsTab === "priorities" && (
                <section className={styles.settingsTabPanel} id="settings-panel-priorities" role="tabpanel" aria-labelledby="settings-tab-priorities">
                  <div className={styles.setting}><div><strong>Manage priorities</strong><span>Priority options are global. Existing activities keep their recorded value.</span></div><div className={styles.managementPanel}><form className={styles.managementForm} onSubmit={addPriority}><label>Priority name<input aria-label="New priority name" value={newPriorityName} onChange={(event) => setNewPriorityName(event.target.value)} placeholder="e.g. Urgent" /></label><button className={styles.toggle} type="submit">Add priority</button></form><div className={styles.managementList}>{preferences.priorityOptions.map((priority) => <div className={styles.managementRow} key={priority}><span>{priority.replace(/[-_]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())}</span><button className={styles.textButton} type="button" onClick={() => removePriority(priority)} aria-label={`Remove ${priority} priority`}>Remove</button></div>)}</div></div></div>
                </section>
                )}

                {settingsTab === "appearance" && (
                <section className={styles.settingsTabPanel} id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance">
                  <div className={styles.setting}><div><strong>Theme</strong><span>Light and dark are saved under workflow.theme.</span></div><button className={styles.toggle} type="button" onClick={toggleTheme} aria-pressed={theme === "dark"}>{theme === "dark" ? "Dark" : "Light"}</button></div>
                </section>
                )}

                {settingsTab === "data" && (
                <section className={styles.settingsTabPanel} id="settings-panel-data" role="tabpanel" aria-labelledby="settings-tab-data">
                  <div className={styles.setting}><div><strong>Activity backup</strong><span>Export a JSON copy or replace this browser&apos;s activities from a validated backup.</span></div><div className={styles.backupActions}><button className={styles.toggle} type="button" onClick={exportBackup}>Export backup</button><button className={styles.toggle} type="button" onClick={() => importInputRef.current?.click()}>Import backup</button><input className={styles.fileInput} ref={importInputRef} type="file" accept="application/json,.json" aria-label="Choose activity backup" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBackup(file); event.target.value = ""; }} /></div></div>
                </section>
                )}

                {persistenceNotice && <p className={styles.persistenceNotice} role="status">{persistenceNotice}</p>}
                </div>
              </div>
            </div>
          )}

          {!isSearch && !isStatistics && !isSettings && <p className={styles.note}><Icon size={15} /><Sparkles size={14} />{note}</p>}
        </section>
      </main>
    </div>
  );
}
