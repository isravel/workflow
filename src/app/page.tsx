"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  BarChart3,
  BookOpen,
  Bug,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Coffee,
  FileText,
  FolderKanban,
  ListChecks,
  ListTodo,
  Map as MapIcon,
  Moon,
  Palette,
  Play,
  Plus,
  Presentation,
  Search,
  Settings,
  Sun,
  Trash2,
  Utensils,
  Users,
  Zap,
} from "lucide-react";
import { categories, demoActivities } from "@/data/fixtures";
import { activityColorOptions, isActivityColorToken, type ActivityColorToken } from "@/domain/activityColors";
import type { Activity, ActivityPriority, Task, TaskStatus } from "@/domain/types";
import {
  defaultTimelinePreferences,
  categoriesForPreferences,
  hoursForRange,
  minutesForHour,
  readTimelinePreferences,
  restDayLabel,
  restDayStatusForDate,
  showRestDaysStorageKey,
  type TimelinePreferences,
} from "@/domain/preferences";
import {
  addDays as addDaysInTimezone,
  addMonths,
  defaultClockTimestamp,
  dateFromTimestamp as dateFromTimestampInTimezone,
  daysInMonth,
  formatDateLabel as formatDateLabelInTimezone,
  formatDayName as formatDayNameInTimezone,
  formatMonthLabel as formatMonthLabelInTimezone,
  formatTime as formatTimeInTimezone,
  minutesFromClock as minutesFromClockInTimezone,
  minutesFromTimestamp as minutesFromTimestampInTimezone,
  runtimeClock,
  startOfMonth,
  timestampForWallTime,
} from "@/domain/time";
import { durationMinutesFromInput } from "@/domain/parsing";
import { buildTimelineLayout, timelineLayoutConstants } from "@/domain/timelineLayout";
import { layoutModeForWidth, responsiveBreakpoints, timelineLaneCapForMode, type LayoutMode } from "@/domain/layoutMode";
import { loadJournal, saveJournal } from "@/repositories/activityRepository";
import styles from "../styles/page.module.scss";

const defaultActivityMinutes = 45;
const viewModeStorageKey = "workflow.viewMode";
const accentThemeStorageKey = "workflow.accentTheme";
const defaultAccentTheme: ActivityColorToken = "violet-600";

type ViewMode = "timeline" | "kanban" | "table";
type TableSortKey = "date" | "activity" | "category" | "time" | "duration" | "priority";
type TableSortDirection = "asc" | "desc";
type TableSort = {
  key: TableSortKey;
  direction: TableSortDirection;
};

const iconForCategory = (categoryId: string) => {
  if (categoryId === "deep-work") return <Zap size={13} strokeWidth={2.2} />;
  if (categoryId === "design") return <Palette size={13} strokeWidth={2.2} />;
  if (categoryId === "development" || categoryId === "code-review") return <Code2 size={13} strokeWidth={2.2} />;
  if (categoryId === "meetings") return <Users size={13} strokeWidth={2.2} />;
  if (categoryId === "break") return <Coffee size={13} strokeWidth={2.2} />;
  if (categoryId === "lunch") return <Utensils size={13} strokeWidth={2.2} />;
  if (categoryId === "research") return <Search size={13} strokeWidth={2.2} />;
  if (categoryId === "planning") return <MapIcon size={13} strokeWidth={2.2} />;
  if (categoryId === "testing") return <ListChecks size={13} strokeWidth={2.2} />;
  if (categoryId === "bug-fixing") return <Bug size={13} strokeWidth={2.2} />;
  if (categoryId === "stakeholders") return <Presentation size={13} strokeWidth={2.2} />;
  if (categoryId === "product") return <FolderKanban size={13} strokeWidth={2.2} />;
  if (categoryId === "documentation") return <BookOpen size={13} strokeWidth={2.2} />;
  return <FileText size={13} strokeWidth={2.2} />;
};

let activePreferences = defaultTimelinePreferences;
const currentPreferences = () => activePreferences;
const timelineStart = () => minutesForHour(currentPreferences().startHour);
const timelineEnd = () => minutesForHour(currentPreferences().endHour);
const currentSnapMinutes = () => currentPreferences().snapMinutes;
const currentTimezone = () => currentPreferences().timezone;
const formatTime = (value: string) => formatTimeInTimezone(value, currentTimezone());

const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum);

const newActivityId = (counter: { current: number }, prefix: string) =>
  globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${counter.current++}`;

const snapTime = (minutes: number) => {
  const start = timelineStart();
  const end = timelineEnd();
  const snap = currentSnapMinutes();
  return clamp(Math.round((minutes - start) / snap) * snap + start, start, end);
};

const minutesFromTimestamp = (value: string) => {
  return minutesFromTimestampInTimezone(value, currentTimezone());
};

const dateFromTimestamp = (value: string) => dateFromTimestampInTimezone(value, currentTimezone());

const addDays = (iso: string, amount: number) => addDaysInTimezone(iso, amount, currentTimezone());

const formatMonthLabel = (iso: string) => formatMonthLabelInTimezone(iso, currentTimezone());

const formatDateLabel = (iso: string) => formatDateLabelInTimezone(iso, currentTimezone());

const minutesFromClock = (clock: number) => minutesFromClockInTimezone(clock, currentTimezone());

const formatWallTime = (minutes: number) => {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute.toString().padStart(2, "0")} ${suffix}`;
};

const timestampForMinutes = (dateIso: string, minutes: number) =>
  timestampForWallTime(dateIso, minutes, currentTimezone());

const positionForRange = (startMinutes: number, endMinutes: number) => {
  const start = timelineStart();
  const end = timelineEnd();
  const visibleStart = clamp(startMinutes, start, end);
  const visibleEnd = clamp(endMinutes, start, end);
  return {
    left: `${((visibleStart - start) / (end - start)) * 100}%`,
    width: `${Math.max(0, ((visibleEnd - visibleStart) / (end - start)) * 100)}%`,
  };
};

type ActivityRange = {
  startMinutes: number;
  endMinutes: number;
};

type TimelineStyle = CSSProperties & {
  "--activity-color": string;
  "--hour-count"?: string;
  "--row-height"?: string;
  "--now-position"?: string;
};

type TimelineGesture = {
  kind: "create" | "move" | "resize";
  dayIso: string;
  pointerId: number;
  track: HTMLDivElement;
  activityId?: string;
  edge?: "start" | "end";
  initialStartMinutes: number;
  initialEndMinutes: number;
  durationMinutes: number;
  pointerOffsetMinutes: number;
  preserveRunning: boolean;
  previewStartMinutes: number;
  previewEndMinutes: number;
};

type ActivityDraft = {
  title: string;
  date: string;
  start: string;
  end: string;
  categoryId: string;
  colorToken: ActivityColorToken | "";
  priority: ActivityPriority;
  notes: string;
  tags: string;
  taskId: string;
};

type QuickEntryDraft = {
  title: string;
  date: string;
  start: string;
  duration: string;
  categoryId: string;
  colorToken: ActivityColorToken | "";
  taskId: string;
};

type TaskDraft = {
  id?: string;
  title: string;
  description: string;
  dueDate: string;
  status: TaskStatus;
};

type TimerRecovery = {
  activity: Activity;
  startDate: string;
  todayDate: string;
};

const viewModeOptions: Array<{ value: ViewMode; label: string }> = [
  { value: "timeline", label: "Timeline" },
  { value: "kanban", label: "Kanban" },
  { value: "table", label: "Table" },
];

const tableSortLabels: Record<TableSortKey, string> = {
  date: "Date",
  activity: "Activity",
  category: "Category",
  time: "Time",
  duration: "Duration",
  priority: "Priority",
};

const taskStatusOptions: Array<{ value: TaskStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "in-progress", label: "In progress" },
  { value: "on-hold", label: "On hold" },
  { value: "fixed", label: "Fixed" },
  { value: "closed", label: "Closed" },
  { value: "reopened", label: "Reopened" },
];

const taskStatusLabel = (status: TaskStatus) => taskStatusOptions.find((option) => option.value === status)?.label ?? status;
const taskStatusRank: Record<TaskStatus, number> = {
  open: 0,
  reopened: 1,
  "in-progress": 2,
  "on-hold": 3,
  fixed: 4,
  closed: 5,
};

const applyAccentThemeStyles = (token: ActivityColorToken, theme: "light" | "dark") => {
  if (typeof document === "undefined") return;
  const base = token.replace(/-600$/, "");
  const shades = theme === "light"
    ? { accent: "600", strong: "900", soft: "100", focus: "200", selection: "200" }
    : { accent: "1000", strong: "900", soft: "1300", focus: "700", selection: "1200" };
  const root = document.documentElement;
  Object.entries(shades).forEach(([name, shade]) => {
    root.style.setProperty(`--theme-${name}`, `var(--palette-color-${base}-${shade})`);
  });
};

type UndoEntry = {
  activities: Activity[];
  selectedActivityId: string | null;
  selectedDate: string;
  label: string;
};

const cloneActivities = (items: Activity[]) => items.map((activity) => ({ ...activity, tags: [...activity.tags] }));
const activityTimestamp = () => new Date().toISOString();

const draftForActivity = (activity: Activity, defaultPriority = "normal"): ActivityDraft => ({
  title: activity.title,
  date: dateFromTimestamp(activity.startAt),
  start: `${Math.floor(minutesFromTimestamp(activity.startAt) / 60).toString().padStart(2, "0")}:${(minutesFromTimestamp(activity.startAt) % 60).toString().padStart(2, "0")}`,
  end: activity.endAt
    ? `${Math.floor(minutesFromTimestamp(activity.endAt) / 60).toString().padStart(2, "0")}:${(minutesFromTimestamp(activity.endAt) % 60).toString().padStart(2, "0")}`
    : "",
  categoryId: activity.categoryId,
  colorToken: activity.colorToken ?? "",
  priority: activity.priority ?? (defaultPriority as ActivityPriority),
  notes: activity.notes,
  tags: activity.tags.join(", "),
  taskId: activity.taskId ?? "",
});

const activityPatchFromDraft = (draft: ActivityDraft) => {
  if (!draft.title.trim()) return { error: "Add a title before saving." } as const;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return { error: "Choose a valid date." } as const;
  const startMatch = draft.start.match(/^(\d{2}):(\d{2})$/);
  const endMatch = draft.end ? draft.end.match(/^(\d{2}):(\d{2})$/) : null;
  if (!startMatch || Number(startMatch[1]) > 23 || Number(startMatch[2]) > 59) {
    return { error: "Choose a valid start time." } as const;
  }
  if (draft.end && (!endMatch || Number(endMatch[1]) > 23 || Number(endMatch[2]) > 59)) {
    return { error: "Choose a valid end time." } as const;
  }

  const startMinutes = Number(startMatch[1]) * 60 + Number(startMatch[2]);
  const endMinutes = endMatch ? Number(endMatch[1]) * 60 + Number(endMatch[2]) : null;
  if (endMinutes !== null && endMinutes <= startMinutes) {
    return { error: "End time must be after start time on the same day." } as const;
  }

  return {
    value: {
      title: draft.title.trim(),
      startAt: timestampForMinutes(draft.date, startMinutes),
      endAt: endMinutes === null ? null : timestampForMinutes(draft.date, endMinutes),
      categoryId: draft.categoryId,
      colorToken: draft.colorToken || undefined,
      priority: draft.priority,
      notes: draft.notes,
      tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      ...(draft.taskId ? { taskId: draft.taskId } : {}),
    },
  } as const;
};

const categoryRadioGroup = (
  availableCategories: ReturnType<typeof categoriesForPreferences>,
  value: string,
  onChange: (value: string) => void,
  name: string,
) => (
  <fieldset className={styles.radioFieldset}>
    <legend className={styles.fieldLabel}>Category</legend>
    <div className={styles.radioOptions}>
      {availableCategories.map((category) => (
        <label
          className={`${styles.radioOption} ${value === category.id ? styles.radioOptionSelected : ""}`}
          key={category.id}
        >
          <input
            className={styles.radioInput}
            type="radio"
            name={name}
            value={category.id}
            checked={value === category.id}
            onChange={(event) => onChange(event.target.value)}
          />
          <span className={styles.radioOptionIcon} aria-hidden="true">{iconForCategory(category.id)}</span>
          <span>{category.name}</span>
        </label>
      ))}
    </div>
  </fieldset>
);

const priorityRadioGroup = (
  priorityOptions: ActivityPriority[],
  value: ActivityPriority,
  onChange: (value: ActivityPriority) => void,
) => (
  <fieldset className={styles.radioFieldset}>
    <legend className={styles.fieldLabel}>Priority</legend>
    <div className={styles.radioOptions}>
      {priorityOptions.map((priority) => (
        <label
          className={`${styles.radioOption} ${value === priority ? styles.radioOptionSelected : ""}`}
          key={priority}
        >
          <input
            className={styles.radioInput}
            type="radio"
            name="activity-priority"
            value={priority}
            checked={value === priority}
            onChange={(event) => onChange(event.target.value as ActivityPriority)}
          />
          <span className={`${styles.priorityDot} ${priority === "low" ? styles.priorityLow : ""} ${priority === "normal" ? styles.priorityNormal : ""} ${priority === "high" ? styles.priorityHigh : ""}`} aria-hidden="true" />
          <span>{priority.replace(/[-_]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())}</span>
        </label>
      ))}
    </div>
  </fieldset>
);

const colorRadioGroup = (
  value: ActivityColorToken | "",
  onChange: (value: ActivityColorToken | "") => void,
  name: string,
) => (
  <fieldset className={styles.radioFieldset}>
    <legend className={styles.fieldLabel}>Color</legend>
    <div className={styles.colorOptions}>
      <label className={`${styles.radioOption} ${styles.colorOption} ${value === "" ? styles.radioOptionSelected : ""}`}>
        <input
          className={styles.radioInput}
          type="radio"
          name={name}
          value=""
          checked={value === ""}
          onChange={() => onChange("")}
        />
        <span className={`${styles.colorSwatch} ${styles.colorSwatchDefault}`} aria-hidden="true" />
        <span>Category default</span>
      </label>
      {activityColorOptions.map((option) => (
        <label
          className={`${styles.radioOption} ${styles.colorOption} ${value === option.token ? styles.radioOptionSelected : ""}`}
          key={option.token}
        >
          <input
            className={styles.radioInput}
            type="radio"
            name={name}
            value={option.token}
            checked={value === option.token}
            onChange={() => onChange(option.token)}
          />
          <span
            className={styles.colorSwatch}
            style={{ "--activity-swatch": `var(--activity-color-${option.token})` } as CSSProperties & { "--activity-swatch": string }}
            aria-hidden="true"
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  </fieldset>
);

const taskPicker = (
  tasks: Task[],
  value: string,
  onChange: (value: string) => void,
  name: string,
) => (
  <label className={styles.field}>
    <span>Task <small>optional</small></span>
    <select name={name} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">No linked task</option>
      {[...tasks]
        .sort((left, right) => left.title.localeCompare(right.title))
        .map((task) => (
          <option value={task.id} key={task.id}>
            {task.title} · {taskStatusLabel(task.status)}
          </option>
        ))}
    </select>
  </label>
);

const timeInputForMinutes = (minutes: number) =>
  `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;

const defaultPriorityForCategory = (preferences: TimelinePreferences, categoryId: string): ActivityPriority =>
  preferences.categorySettings[categoryId]?.priority
  ?? (preferences.priorityOptions.includes("normal") ? "normal" : preferences.priorityOptions[0] ?? "normal");

const colorTokenForCategory = (preferences: TimelinePreferences, category: ReturnType<typeof categoriesForPreferences>[number]): ActivityColorToken =>
  preferences.categorySettings[category.id]?.colorToken ?? category.colorToken;

export default function Home() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [preferences, setPreferences] = useState<TimelinePreferences>(defaultTimelinePreferences);
  const [showRestDays, setShowRestDays] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [accentTheme, setAccentTheme] = useState<ActivityColorToken>(defaultAccentTheme);
  const [selectedDate, setSelectedDate] = useState("2026-09-18");
  const [activities, setActivities] = useState(demoActivities);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [clock, setClock] = useState(() => defaultClockTimestamp);
  const [hydrated, setHydrated] = useState(false);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [resizeMode, setResizeMode] = useState(false);
  const [gesture, setGesture] = useState<TimelineGesture | null>(null);
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const [activityDraft, setActivityDraft] = useState<ActivityDraft | null>(null);
  const [quickEntryDraft, setQuickEntryDraft] = useState<QuickEntryDraft | null>(null);
  const [quickEntryError, setQuickEntryError] = useState<string | null>(null);
  const [timerRecovery, setTimerRecovery] = useState<TimerRecovery | null>(null);
  const [compactActivityIds, setCompactActivityIds] = useState<Set<string>>(() => new Set());
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<"idle" | "saved" | "invalid">("idle");
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [undoNotice, setUndoNotice] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("desktop");
  const [tasksOpen, setTasksOpen] = useState(false);
  const [taskQuery, setTaskQuery] = useState("");
  const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatus | "all">("all");
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState("");
  const [tableCategoryFilter, setTableCategoryFilter] = useState("all");
  const [tablePriorityFilter, setTablePriorityFilter] = useState("all");
  const [tableTaskFilter, setTableTaskFilter] = useState<"all" | "linked" | "unlinked">("all");
  const [tableSort, setTableSort] = useState<TableSort>({ key: "date", direction: "desc" });
  const bootClockRef = useRef(clock);
  const gestureRef = useRef<TimelineGesture | null>(null);
  const pendingPointerX = useRef<number | null>(null);
  const gestureFrameRef = useRef<number | null>(null);
  const activityRefs = useRef(new Map<string, HTMLDivElement>());
  const startHandleRefs = useRef(new Map<string, HTMLSpanElement>());
  const activityIdCounter = useRef(0);
  const detailsDialogRef = useRef<HTMLDialogElement>(null);
  const quickEntryDialogRef = useRef<HTMLDialogElement>(null);
  const recoveryDialogRef = useRef<HTMLDialogElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const quickEntryTitleRef = useRef<HTMLInputElement>(null);
  const taskTitleInputRef = useRef<HTMLInputElement>(null);
  const detailsUndoRecordedRef = useRef(false);
  const undoNoticeTimeoutRef = useRef<number | null>(null);
  const lastClockDateRef = useRef<string | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const availableCategories = categoriesForPreferences(preferences);
  const categoryCatalog = [...categories, ...preferences.customCategories];
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);
  const timelineStartMinutes = minutesForHour(preferences.startHour);
  const timelineEndMinutes = minutesForHour(preferences.endHour);
  const snapMinutes = preferences.snapMinutes;
  const hours = hoursForRange(preferences.startHour, preferences.endHour);

  useEffect(() => {
    const updateLayoutMode = () => setLayoutMode(layoutModeForWidth(
      window.innerWidth,
      responsiveBreakpoints.tablet,
      responsiveBreakpoints.desktop,
    ));
    updateLayoutMode();
    window.addEventListener("resize", updateLayoutMode);
    return () => window.removeEventListener("resize", updateLayoutMode);
  }, []);

  useEffect(() => {
    const syncPreferences = () => {
      const nextPreferences = readTimelinePreferences();
      activePreferences = nextPreferences;
      setPreferences(nextPreferences);
    };
    syncPreferences();
    window.addEventListener("workflow-preferences-change", syncPreferences);
    return () => window.removeEventListener("workflow-preferences-change", syncPreferences);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(showRestDaysStorageKey);
    if (stored === null) return;
    const frame = window.requestAnimationFrame(() => setShowRestDays(stored !== "false"));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const recordUndo = useCallback((label: string, snapshot = activities) => {
    setUndoStack((current) => [
      ...current.slice(-19),
      {
        activities: cloneActivities(snapshot),
        selectedActivityId,
        selectedDate,
        label,
      },
    ]);
    setUndoNotice(`${label} changed`);
    if (undoNoticeTimeoutRef.current !== null) window.clearTimeout(undoNoticeTimeoutRef.current);
    undoNoticeTimeoutRef.current = window.setTimeout(() => setUndoNotice(null), 6000);
  }, [activities, selectedActivityId, selectedDate]);

  const undo = useCallback(() => {
    const entry = undoStack.at(-1);
    if (!entry) return;
    setActivities(cloneActivities(entry.activities));
    setSelectedActivityId(entry.selectedActivityId);
    setSelectedDate(entry.selectedDate);
    setResizeMode(false);
    setEditingActivityId(null);
    setActivityDraft(null);
    setUndoStack((current) => current.slice(0, -1));
    setUndoNotice(null);
    window.requestAnimationFrame(() => {
      if (entry.selectedActivityId) activityRefs.current.get(entry.selectedActivityId)?.focus();
    });
  }, [undoStack]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("workflow.theme");
    const nextTheme = storedTheme === "dark" ? "dark" : "light";
    const storedAccentTheme = window.localStorage.getItem(accentThemeStorageKey);
    const storedViewMode = window.localStorage.getItem(viewModeStorageKey);
    const storedDate = window.localStorage.getItem("workflow.selectedDate");
    const queryDate = new URLSearchParams(window.location.search).get("date");
    const currentDate = dateFromTimestamp(new Date(runtimeClock()).toISOString());
    bootClockRef.current = runtimeClock();
    setClock(bootClockRef.current);
    const frame = window.requestAnimationFrame(() => {
      setTheme(nextTheme);
      const nextAccentTheme = isActivityColorToken(storedAccentTheme) ? storedAccentTheme : defaultAccentTheme;
      setAccentTheme(nextAccentTheme);
      applyAccentThemeStyles(nextAccentTheme, nextTheme);
      if (storedViewMode === "timeline" || storedViewMode === "kanban" || storedViewMode === "table") {
        setViewMode(storedViewMode);
      }
      const nextDate = queryDate ?? (
        storedDate?.slice(0, 7) === currentDate.slice(0, 7)
          ? storedDate
          : currentDate
      );
      if (nextDate && /^\d{4}-\d{2}-\d{2}$/.test(nextDate)) setSelectedDate(nextDate);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem("workflow.selectedDate", selectedDate);
  }, [hydrated, selectedDate]);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(viewModeStorageKey, viewMode);
  }, [hydrated, viewMode]);

  useEffect(() => {
    let mounted = true;
    const readinessTimeout = window.setTimeout(() => {
      if (mounted) setHydrated(true);
    }, 1500);
    loadJournal().then((journal) => {
      if (!mounted) return;
      window.clearTimeout(readinessTimeout);
      if (journal) {
        const storedActivities = journal.activities;
        setTasks(journal.tasks);
        const storedRunning = storedActivities.filter((activity) => activity.endAt === null);
        const normalizedActivities = storedRunning.length > 1
          ? storedActivities.map((activity) => activity.endAt === null && activity.id !== storedRunning.at(-1)?.id
            ? { ...activity, endAt: new Date(bootClockRef.current).toISOString() }
            : activity)
          : storedActivities;
        setActivities(normalizedActivities);
        const running = normalizedActivities.find((activity) => activity.endAt === null);
        const today = dateFromTimestamp(new Date(bootClockRef.current).toISOString());
        if (running && dateFromTimestamp(running.startAt) !== today) {
          setTimerRecovery({
            activity: running,
            startDate: dateFromTimestamp(running.startAt),
            todayDate: today,
          });
        }
      }
      setHydrated(true);
    });
    return () => {
      mounted = false;
      window.clearTimeout(readinessTimeout);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void saveJournal({ activities, tasks });
  }, [activities, tasks, hydrated]);

  useEffect(() => {
    const dialog = detailsDialogRef.current;
    if (!editingActivityId || !dialog) return;
    if (!dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => titleInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editingActivityId]);

  useEffect(() => {
    const dialog = quickEntryDialogRef.current;
    if (!quickEntryDraft || !dialog) return;
    if (!dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => quickEntryTitleRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [quickEntryDraft]);

  useEffect(() => {
    const dialog = recoveryDialogRef.current;
    if (!timerRecovery || !dialog) return;
    if (!dialog.open) dialog.showModal();
  }, [timerRecovery]);

  useEffect(() => {
    if (!taskDraft || !tasksOpen) return;
    const frame = window.requestAnimationFrame(() => taskTitleInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [taskDraft, tasksOpen]);

  useEffect(() => {
    if (!editingActivityId || !activityDraft) return;
    const timeout = window.setTimeout(() => {
      const result = activityPatchFromDraft(activityDraft);
      if ("error" in result) {
        setDraftError(result.error ?? "Invalid activity details.");
        setDraftStatus("invalid");
        return;
      }

      const currentActivity = activities.find((activity) => activity.id === editingActivityId);
      if (!currentActivity) return;
      const nextActivity = { ...currentActivity, ...result.value };
      if (JSON.stringify(currentActivity) === JSON.stringify(nextActivity)) {
        setDraftError(null);
        setDraftStatus("saved");
        return;
      }
      if (!detailsUndoRecordedRef.current) {
        recordUndo("activity details");
        detailsUndoRecordedRef.current = true;
      }
      setActivities((current) => current.map((activity) => activity.id === editingActivityId
        ? { ...activity, ...result.value, updatedAt: activityTimestamp() }
        : activity));
      setSelectedDate(activityDraft.date);
      setDraftError(null);
      setDraftStatus("saved");
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [activityDraft, activities, editingActivityId, recordUndo]);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(runtimeClock()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    applyAccentThemeStyles(accentTheme, nextTheme);
    window.localStorage.setItem("workflow.theme", nextTheme);
    setTheme(nextTheme);
  };

  const selectAccentTheme = (token: ActivityColorToken) => {
    applyAccentThemeStyles(token, theme);
    window.localStorage.setItem(accentThemeStorageKey, token);
    setAccentTheme(token);
  };

  const openActivityDetails = useCallback((activity: Activity) => {
    setSelectedActivityId(activity.id);
    setSelectedDate(dateFromTimestamp(activity.startAt));
    setResizeMode(false);
    setDraftError(null);
    setDraftStatus("idle");
    detailsUndoRecordedRef.current = false;
    setActivityDraft(draftForActivity(activity, defaultPriorityForCategory(preferences, activity.categoryId)));
    setEditingActivityId(activity.id);
  }, [preferences]);

  const resetActivityDetails = () => {
    setEditingActivityId(null);
    setActivityDraft(null);
    setDraftError(null);
    setDraftStatus("idle");
    detailsUndoRecordedRef.current = false;
    if (selectedActivityId) {
      window.requestAnimationFrame(() => activityRefs.current.get(selectedActivityId)?.focus());
    }
  };

  const closeActivityDetails = () => {
    commitActivityDraft();
    if (detailsDialogRef.current?.open) {
      detailsDialogRef.current.close();
      return;
    }
    resetActivityDetails();
  };

  const deleteActivity = (activity: Activity) => {
    recordUndo("activity deletion");
    setActivities((current) => current.filter((item) => item.id !== activity.id));
    setSelectedActivityId((current) => current === activity.id ? null : current);
    if (editingActivityId === activity.id) {
      if (detailsDialogRef.current?.open) detailsDialogRef.current.close();
      else resetActivityDetails();
    }
  };

  const updateActivityDraft = <Key extends keyof ActivityDraft>(key: Key, value: ActivityDraft[Key]) => {
    setActivityDraft((current) => current ? { ...current, [key]: value } : current);
    setDraftError(null);
    setDraftStatus("idle");
  };

  const commitActivityDraft = () => {
    if (!editingActivityId || !activityDraft) return false;
    const result = activityPatchFromDraft(activityDraft);
    if ("error" in result) {
      setDraftError(result.error ?? "Invalid activity details.");
      setDraftStatus("invalid");
      return false;
    }
    const currentActivity = activities.find((activity) => activity.id === editingActivityId);
    if (!currentActivity) return false;
    const nextActivity = { ...currentActivity, ...result.value };
    if (JSON.stringify(currentActivity) === JSON.stringify(nextActivity)) return true;
    if (!detailsUndoRecordedRef.current) {
      recordUndo("activity details");
      detailsUndoRecordedRef.current = true;
    }
    setActivities((current) => current.map((activity) => activity.id === editingActivityId
      ? { ...activity, ...result.value, updatedAt: activityTimestamp() }
      : activity));
    setSelectedDate(activityDraft.date);
    setDraftError(null);
    setDraftStatus("saved");
    return true;
  };

  const createActivityAt = useCallback((dayIso: string, startMinutes: number, endMinutes: number, title = "New activity") => {
    const id = newActivityId(activityIdCounter, "activity-new");
    const newActivity: Activity = {
      id,
      title,
      startAt: timestampForMinutes(dayIso, startMinutes),
      endAt: timestampForMinutes(dayIso, endMinutes),
      categoryId: "deep-work",
      notes: "",
      tags: [],
      priority: defaultPriorityForCategory(preferences, "deep-work"),
      createdAt: activityTimestamp(),
      updatedAt: activityTimestamp(),
    };
    recordUndo("activity creation");
    setActivities((current) => [
      ...current,
      newActivity,
    ]);
    setSelectedDate(dayIso);
    setSelectedActivityId(id);
    openActivityDetails(newActivity);
    return id;
  }, [openActivityDetails, preferences, recordUndo]);

  const openQuickEntry = useCallback((taskId = "") => {
    const start = snapTime(minutesFromClock(clock));
    setQuickEntryError(null);
    setQuickEntryDraft({
      title: "",
      date: selectedDate,
      start: timeInputForMinutes(start),
      duration: `${defaultActivityMinutes}m`,
      categoryId: "deep-work",
      colorToken: "",
      taskId,
    });
  }, [clock, selectedDate]);

  const closeQuickEntry = () => {
    if (quickEntryDialogRef.current?.open) quickEntryDialogRef.current.close();
    setQuickEntryDraft(null);
    setQuickEntryError(null);
  };

  const commitQuickEntry = () => {
    if (!quickEntryDraft) return false;
    const startMatch = quickEntryDraft.start.match(/^(\d{2}):(\d{2})$/);
    const durationMinutes = durationMinutesFromInput(quickEntryDraft.duration);
    if (!quickEntryDraft.title.trim()) {
      setQuickEntryError("Add a title before creating the activity.");
      return false;
    }
    if (!startMatch || Number(startMatch[1]) > 23 || Number(startMatch[2]) > 59) {
      setQuickEntryError("Choose a valid start time.");
      return false;
    }
    if (!durationMinutes) {
      setQuickEntryError("Use a duration such as 45m, 1h, or 1h30.");
      return false;
    }
    const startMinutes = Number(startMatch[1]) * 60 + Number(startMatch[2]);
    const endMinutes = startMinutes + durationMinutes;
    if (endMinutes > 24 * 60) {
      setQuickEntryError("The activity must finish before midnight.");
      return false;
    }

    const newActivity: Activity = {
      id: newActivityId(activityIdCounter, "activity-quick"),
      title: quickEntryDraft.title.trim(),
      startAt: timestampForMinutes(quickEntryDraft.date, startMinutes),
      endAt: timestampForMinutes(quickEntryDraft.date, endMinutes),
      categoryId: quickEntryDraft.categoryId,
      notes: "",
      tags: [],
      priority: defaultPriorityForCategory(preferences, quickEntryDraft.categoryId),
      ...(quickEntryDraft.taskId ? { taskId: quickEntryDraft.taskId } : {}),
      ...(quickEntryDraft.colorToken ? { colorToken: quickEntryDraft.colorToken } : {}),
      createdAt: activityTimestamp(),
      updatedAt: activityTimestamp(),
    };
    recordUndo("activity creation");
    setActivities((current) => [...current, newActivity]);
    setSelectedDate(quickEntryDraft.date);
    setSelectedActivityId(newActivity.id);
    closeQuickEntry();
    window.requestAnimationFrame(() => activityRefs.current.get(newActivity.id)?.focus());
    return true;
  };

  const addActivity = () => openQuickEntry();

  const openNewTask = () => {
    setTaskError(null);
    setTaskDraft({ title: "", description: "", dueDate: "", status: "open" });
  };

  const openTaskEditor = (task: Task) => {
    setTaskError(null);
    setTaskDraft({
      id: task.id,
      title: task.title,
      description: task.description,
      dueDate: task.dueDate ?? "",
      status: task.status,
    });
  };

  const closeTaskEditor = () => {
    setTaskDraft(null);
    setTaskError(null);
  };

  const saveTaskDraft = () => {
    if (!taskDraft?.title.trim()) {
      setTaskError("Add a title before saving the task.");
      return;
    }
    const timestamp = activityTimestamp();
    if (taskDraft.id) {
      setTasks((current) => current.map((task) => task.id === taskDraft.id
        ? {
          ...task,
          title: taskDraft.title.trim(),
          description: taskDraft.description.trim(),
          dueDate: taskDraft.dueDate || null,
          status: taskDraft.status,
          updatedAt: timestamp,
        }
        : task));
    } else {
      setTasks((current) => [...current, {
        id: newActivityId(activityIdCounter, "task"),
        title: taskDraft.title.trim(),
        description: taskDraft.description.trim(),
        dueDate: taskDraft.dueDate || null,
        status: taskDraft.status,
        createdAt: timestamp,
        updatedAt: timestamp,
      }]);
    }
    closeTaskEditor();
  };

  const updateTaskStatus = (task: Task, status: TaskStatus) => {
    setTasks((current) => current.map((item) => item.id === task.id
      ? { ...item, status, updatedAt: activityTimestamp() }
      : item));
  };

  const deleteTask = (task: Task) => {
    if (!window.confirm(`Delete task "${task.title}"? Linked activities will be kept.`)) return;
    setTasks((current) => current.filter((item) => item.id !== task.id));
    setActivities((current) => current.map((activity) => {
      if (activity.taskId !== task.id) return activity;
      const withoutTask = { ...activity };
      delete withoutTask.taskId;
      return withoutTask;
    }));
    if (taskDraft?.id === task.id) closeTaskEditor();
  };

  const logActivityForTask = (task: Task) => {
    setTasksOpen(false);
    openQuickEntry(task.id);
  };

  const runningActivity = activities.find((activity) => activity.endAt === null);
  const selectedActivity = selectedActivityId
    ? activities.find((activity) => activity.id === selectedActivityId) ?? null
    : null;
  const todayIso = dateFromTimestamp(new Date(clock).toISOString());
  const dates = useMemo(() => {
    const monthStart = startOfMonth(selectedDate);
    return Array.from({ length: daysInMonth(monthStart) }, (_, offset) => {
      const iso = addDaysInTimezone(monthStart, offset, preferences.timezone);
      return {
        iso,
        day: formatDayNameInTimezone(iso, preferences.timezone),
        date: formatDateLabelInTimezone(iso, preferences.timezone),
      };
    });
  }, [preferences.timezone, selectedDate]);

  useEffect(() => {
    if (!hydrated) return;
    const frame = window.requestAnimationFrame(() => {
      const todayTrack = timelineScrollRef.current
        ?.querySelector<HTMLElement>(`[data-timeline-track="${todayIso}"]`);
      todayTrack?.scrollIntoView({ block: "center", inline: "nearest" });
      setTimelineScrollLeft(timelineScrollRef.current?.scrollLeft ?? 0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hydrated, preferences.timezone, selectedDate, todayIso]);

  const summaryForDate = (iso: string) => {
    const dayActivities = activitiesForDate(iso);
    const restDayStatus = showRestDays ? restDayStatusForDate(iso, preferences) : null;
    const totalMinutes = dayActivities.reduce((total, activity) => {
      const end = activity.endAt ? new Date(activity.endAt).getTime() : clock;
      return total + Math.max(0, Math.round((end - new Date(activity.startAt).getTime()) / 60000));
    }, 0);
    if (dayActivities.length === 0) {
      if (restDayStatus) return `— · ${restDayLabel(restDayStatus)}`;
      return iso > todayIso ? "— · Future" : showRestDays ? "— · Rest day" : "—";
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    return `${duration} · ${dayActivities.length} ${dayActivities.length === 1 ? "activity" : "activities"}`;
  };

  useEffect(() => {
    const previousDate = lastClockDateRef.current;
    lastClockDateRef.current = todayIso;
    if (!previousDate || previousDate === todayIso || timerRecovery) return;
    const running = activities.find((activity) => activity.endAt === null);
    if (!running || dateFromTimestamp(running.startAt) !== previousDate) return;

    const completed = {
      ...running,
      endAt: timestampForMinutes(todayIso, 0),
    };
    const continuation = {
      ...running,
      id: newActivityId(activityIdCounter, "activity-midnight"),
      startAt: timestampForMinutes(todayIso, 0),
      endAt: null,
    };
    setActivities((current) => current.flatMap((activity) => activity.id === running.id ? [completed, continuation] : [activity]));
    setSelectedDate(todayIso);
    setSelectedActivityId(continuation.id);
  }, [activities, timerRecovery, todayIso]);

  const toggleTimer = useCallback(() => {
    if (runningActivity) {
      recordUndo("timer stop");
      setActivities((current) => current.map((activity) => activity.endAt === null ? { ...activity, endAt: new Date(clock).toISOString() } : activity));
      return;
    }

    recordUndo("timer start");
    const timerSource = selectedActivity;
    setActivities((current) => [
      ...current,
      {
        id: newActivityId(activityIdCounter, "activity-timer"),
        title: timerSource?.title ?? "Focused work",
        startAt: new Date(clock).toISOString(),
        endAt: null,
        categoryId: timerSource?.categoryId ?? "deep-work",
        notes: timerSource?.notes ?? "",
        tags: timerSource?.tags ?? [],
        priority: timerSource?.priority ?? defaultPriorityForCategory(preferences, timerSource?.categoryId ?? "deep-work"),
        ...(timerSource?.colorToken ? { colorToken: timerSource.colorToken } : {}),
        createdAt: activityTimestamp(),
        updatedAt: activityTimestamp(),
      },
    ]);
  }, [clock, preferences, recordUndo, runningActivity, selectedActivity]);

  const resolveTimerRecovery = (continueTimer: boolean) => {
    if (!timerRecovery) return;
    const { activity, startDate, todayDate } = timerRecovery;
    if (!continueTimer) {
      const stopAt = timestampForMinutes(addDays(startDate, 1), 0);
      setActivities((current) => current.map((item) => item.id === activity.id ? { ...item, endAt: stopAt } : item));
      setSelectedDate(startDate);
      setTimerRecovery(null);
      if (recoveryDialogRef.current?.open) recoveryDialogRef.current.close();
      return;
    }

    const continuations: Activity[] = [];
    let day = startDate;
    let isFirst = true;
    while (day < todayDate) {
      continuations.push({
        ...activity,
        id: isFirst ? activity.id : newActivityId(activityIdCounter, "activity-recovery"),
        startAt: isFirst ? activity.startAt : timestampForMinutes(day, 0),
        endAt: timestampForMinutes(addDays(day, 1), 0),
      });
      day = addDays(day, 1);
      isFirst = false;
    }
    const finalActivity: Activity = {
      ...activity,
      id: isFirst ? activity.id : newActivityId(activityIdCounter, "activity-recovery"),
      startAt: timestampForMinutes(todayDate, 0),
      endAt: null,
    };
    continuations.push(finalActivity);
    setActivities((current) => current.flatMap((item) => item.id === activity.id ? continuations : [item]));
    setSelectedDate(todayDate);
    setSelectedActivityId(finalActivity.id);
    setTimerRecovery(null);
    if (recoveryDialogRef.current?.open) recoveryDialogRef.current.close();
  };

  const formatElapsed = (startAt: string) => {
    const elapsedSeconds = Math.max(0, Math.floor((clock - new Date(startAt).getTime()) / 1000));
    const hoursElapsed = Math.floor(elapsedSeconds / 3600).toString().padStart(2, "0");
    const minutesElapsed = Math.floor((elapsedSeconds % 3600) / 60).toString().padStart(2, "0");
    const secondsElapsed = (elapsedSeconds % 60).toString().padStart(2, "0");
    return `${hoursElapsed}:${minutesElapsed}:${secondsElapsed}`;
  };

  const activitiesForDate = (iso: string) => activities.filter(
    (activity) => dateFromTimestamp(activity.startAt) === iso && preferences.categoryIds.includes(activity.categoryId),
  );

  const activityRange = (activity: Activity): ActivityRange => ({
    startMinutes: minutesFromTimestamp(activity.startAt),
    endMinutes: activity.endAt ? minutesFromTimestamp(activity.endAt) : minutesFromClock(clock),
  });

  const activityTimeLabel = (activity: Activity) =>
    `${formatTime(activity.startAt)} – ${activity.endAt ? formatTime(activity.endAt) : "now"}`;

  const activityDurationMinutes = (activity: Activity) => {
    const end = activity.endAt ? new Date(activity.endAt).getTime() : clock;
    return Math.max(0, Math.round((end - new Date(activity.startAt).getTime()) / 60000));
  };

  const activityDurationLabel = (activity: Activity) =>
    activity.endAt === null ? `${formatElapsed(activity.startAt)} elapsed` : `${activityDurationMinutes(activity)} minutes`;

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const activityElements = Array.from(
      timelineScrollRef.current?.querySelectorAll<HTMLElement>("[data-activity-id]") ?? [],
    );
    const measure = () => {
      const next = new Set(
        activityElements
          .filter((element) => element.getBoundingClientRect().width < 122)
          .map((element) => element.dataset.activityId)
          .filter((id): id is string => Boolean(id)),
      );
      setCompactActivityIds((current) => {
        if (current.size === next.size && [...current].every((id) => next.has(id))) return current;
        return next;
      });
    };
    const observer = new ResizeObserver(measure);
    activityElements.forEach((element) => observer.observe(element));
    measure();
    return () => observer.disconnect();
  }, [activities, preferences.timezone, preferences.startHour, preferences.endHour, selectedDate, showRestDays]);

  useEffect(() => {
    if (!selectedActivityId) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const activityElement = activityRefs.current.get(selectedActivityId);
      const target = event.target;
      if (!activityElement || !(target instanceof Node) || activityElement.contains(target)) return;
      setSelectedActivityId(null);
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, [selectedActivityId]);

  const duplicateActivity = (activity: Activity) => {
    if (activity.endAt === null) return;
    const range = activityRange(activity);
    const duration = Math.max(snapMinutes, range.endMinutes - range.startMinutes);
    const nextStart = clamp(
      range.startMinutes + duration + snapMinutes,
      0,
      24 * 60 - duration,
    );
    const date = dateFromTimestamp(activity.startAt);
    const duplicate: Activity = {
      ...activity,
      id: newActivityId(activityIdCounter, "activity-duplicate"),
      startAt: timestampForMinutes(date, nextStart),
      endAt: timestampForMinutes(date, nextStart + duration),
      tags: [...activity.tags],
      createdAt: activityTimestamp(),
      updatedAt: activityTimestamp(),
    };
    recordUndo("activity duplication");
    setActivities((current) => [...current, duplicate]);
    setSelectedDate(date);
    setSelectedActivityId(duplicate.id);
    window.requestAnimationFrame(() => activityRefs.current.get(duplicate.id)?.focus());
  };

  const copyActivitySummary = async (activity: Activity) => {
    const category = availableCategories.find((item) => item.id === activity.categoryId)
      ?? categoryCatalog.find((item) => item.id === activity.categoryId)
      ?? categories[0];
    const range = activityRange(activity);
    const duration = activity.endAt
      ? `${Math.max(0, range.endMinutes - range.startMinutes)} minutes`
      : `${formatElapsed(activity.startAt)} elapsed`;
    const summary = `${activity.title} · ${category.name} · ${formatTime(activity.startAt)} – ${activity.endAt ? formatTime(activity.endAt) : "in progress"} · ${duration}`;
    try {
      await navigator.clipboard.writeText(summary);
      setUndoNotice("Activity summary copied");
      if (undoNoticeTimeoutRef.current !== null) window.clearTimeout(undoNoticeTimeoutRef.current);
      undoNoticeTimeoutRef.current = window.setTimeout(() => setUndoNotice(null), 3000);
    } catch {
      setUndoNotice("Could not copy the activity summary");
    }
  };

  const moveActivityToDate = (activity: Activity) => {
    openActivityDetails(activity);
    window.requestAnimationFrame(() => {
      detailsDialogRef.current?.querySelector<HTMLInputElement>('input[type="date"]')?.focus();
    });
  };

  const timelineLayoutForDate = (iso: string) => {
    const dayActivities = activitiesForDate(iso);
    const isPast = iso < todayIso;
    const isToday = iso === todayIso;
    const cutoffMinutes = isPast
      ? timelineEndMinutes
      : isToday
        ? Math.min(minutesFromClock(clock), timelineEndMinutes)
        : null;
    return buildTimelineLayout(
      dayActivities,
      activityRange,
      timelineStartMinutes,
      cutoffMinutes,
      timelineLaneCapForMode[layoutMode],
    );
  };

  const rowHeightForLaneCount = (laneCount: number) => Math.max(
    timelineLayoutConstants.minimumRowHeight,
    timelineLayoutConstants.activityTop
      + laneCount * timelineLayoutConstants.activityHeight
      + Math.max(0, laneCount - 1) * timelineLayoutConstants.laneGap
      + timelineLayoutConstants.rowPadding,
  );

  const pointerToMinutes = (clientX: number, track: HTMLDivElement) => {
    const bounds = track.getBoundingClientRect();
    const ratio = clamp((clientX - bounds.left) / Math.max(bounds.width, 1), 0, 1);
    return snapTime(timelineStartMinutes + ratio * (timelineEndMinutes - timelineStartMinutes));
  };

  const setGestureState = (nextGesture: TimelineGesture | null) => {
    gestureRef.current = nextGesture;
    setGesture(nextGesture);
  };

  const updateGestureFromPointer = (clientX: number) => {
    const currentGesture = gestureRef.current;
    if (!currentGesture) return;

    const pointerMinutes = pointerToMinutes(clientX, currentGesture.track);
    let previewStartMinutes = currentGesture.previewStartMinutes;
    let previewEndMinutes = currentGesture.previewEndMinutes;

    if (currentGesture.kind === "create") {
      previewStartMinutes = Math.min(currentGesture.initialStartMinutes, pointerMinutes);
      previewEndMinutes = Math.max(currentGesture.initialStartMinutes, pointerMinutes);
      if (previewStartMinutes === previewEndMinutes) previewEndMinutes += snapMinutes;
    } else if (currentGesture.kind === "move") {
      if (currentGesture.preserveRunning) {
        const currentMinutes = minutesFromClock(clock);
        previewStartMinutes = clamp(pointerMinutes - currentGesture.pointerOffsetMinutes, timelineStartMinutes, currentMinutes - snapMinutes);
        previewEndMinutes = currentMinutes;
      } else {
        previewStartMinutes = clamp(
          pointerMinutes - currentGesture.pointerOffsetMinutes,
          timelineStartMinutes,
          timelineEndMinutes - currentGesture.durationMinutes,
        );
        previewEndMinutes = previewStartMinutes + currentGesture.durationMinutes;
      }
    } else if (currentGesture.edge === "start") {
      previewStartMinutes = clamp(pointerMinutes, timelineStartMinutes, currentGesture.initialEndMinutes - snapMinutes);
      previewEndMinutes = currentGesture.initialEndMinutes;
    } else {
      previewStartMinutes = currentGesture.initialStartMinutes;
      previewEndMinutes = clamp(pointerMinutes, currentGesture.initialStartMinutes + snapMinutes, timelineEndMinutes);
    }

    setGestureState({
      ...currentGesture,
      previewStartMinutes,
      previewEndMinutes,
    });
  };

  const scheduleGestureUpdate = (clientX: number) => {
    pendingPointerX.current = clientX;
    if (gestureFrameRef.current !== null) return;
    gestureFrameRef.current = window.requestAnimationFrame(() => {
      gestureFrameRef.current = null;
      if (pendingPointerX.current !== null) updateGestureFromPointer(pendingPointerX.current);
    });
  };

  const finishGesture = (commit: boolean, clientX?: number) => {
    if (gestureFrameRef.current !== null) {
      window.cancelAnimationFrame(gestureFrameRef.current);
      gestureFrameRef.current = null;
    }
    if (clientX !== undefined) updateGestureFromPointer(clientX);

    const currentGesture = gestureRef.current;
    if (!currentGesture) return;

    if (commit) {
      if (currentGesture.kind === "create") {
        createActivityAt(
          currentGesture.dayIso,
          currentGesture.previewStartMinutes,
          currentGesture.previewEndMinutes,
        );
      } else if (currentGesture.activityId) {
        if (
          currentGesture.previewStartMinutes !== currentGesture.initialStartMinutes
          || currentGesture.previewEndMinutes !== currentGesture.initialEndMinutes
        ) {
          recordUndo(currentGesture.kind === "move" ? "activity move" : "activity resize");
        }
        setActivities((current) => current.map((activity) => {
          if (activity.id !== currentGesture.activityId) return activity;
          return {
            ...activity,
            startAt: timestampForMinutes(currentGesture.dayIso, currentGesture.previewStartMinutes),
            endAt: currentGesture.preserveRunning
              ? null
              : timestampForMinutes(currentGesture.dayIso, currentGesture.previewEndMinutes),
          };
        }));
      }
    }

    if (currentGesture.track.hasPointerCapture(currentGesture.pointerId)) {
      currentGesture.track.releasePointerCapture(currentGesture.pointerId);
    }
    pendingPointerX.current = null;
    setGestureState(null);
  };

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>, dayIso: string) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const startMinutes = clamp(pointerToMinutes(event.clientX, event.currentTarget), timelineStartMinutes, timelineEndMinutes - snapMinutes);
    const nextGesture: TimelineGesture = {
      kind: "create",
      dayIso,
      pointerId: event.pointerId,
      track: event.currentTarget,
      initialStartMinutes: startMinutes,
      initialEndMinutes: startMinutes + snapMinutes,
      durationMinutes: snapMinutes,
      pointerOffsetMinutes: 0,
      preserveRunning: false,
      previewStartMinutes: startMinutes,
      previewEndMinutes: startMinutes + snapMinutes,
    };
    setSelectedDate(dayIso);
    setSelectedActivityId(null);
    setResizeMode(false);
    setGestureState(nextGesture);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const startActivityGesture = (
    event: ReactPointerEvent<HTMLElement>,
    activity: Activity,
    edge?: "start" | "end",
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const track = event.currentTarget.closest("[data-timeline-track]") as HTMLDivElement | null;
    if (!track) return;

    const range = activityRange(activity);
    const preserveRunning = activity.endAt === null;
    const nextGesture: TimelineGesture = {
      kind: edge ? "resize" : "move",
      dayIso: dateFromTimestamp(activity.startAt),
      pointerId: event.pointerId,
      track,
      activityId: activity.id,
      edge,
      initialStartMinutes: range.startMinutes,
      initialEndMinutes: range.endMinutes,
      durationMinutes: Math.max(snapMinutes, range.endMinutes - range.startMinutes),
      pointerOffsetMinutes: edge ? 0 : pointerToMinutes(event.clientX, track) - range.startMinutes,
      preserveRunning,
      previewStartMinutes: range.startMinutes,
      previewEndMinutes: range.endMinutes,
    };
    setSelectedDate(dateFromTimestamp(activity.startAt));
    setSelectedActivityId(activity.id);
    setGestureState(nextGesture);
    track.setPointerCapture(event.pointerId);
  };

  const handleTrackPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    scheduleGestureUpdate(event.clientX);
  };

  const handleTrackPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    finishGesture(true, event.clientX);
  };

  const handleTrackPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    finishGesture(false);
  };

  const nudgeActivity = (activity: Activity, direction: -1 | 1) => {
    const range = activityRange(activity);
    if (activity.endAt === null) {
      const currentMinutes = minutesFromClock(clock);
      const nextStart = clamp(range.startMinutes + direction * snapMinutes, timelineStartMinutes, currentMinutes - snapMinutes);
      if (nextStart === range.startMinutes) return;
      recordUndo("activity move");
      setActivities((current) => current.map((item) => item.id === activity.id
        ? { ...item, startAt: timestampForMinutes(dateFromTimestamp(activity.startAt), nextStart) }
        : item));
      return;
    }

    const nextStart = clamp(
      range.startMinutes + direction * snapMinutes,
      timelineStartMinutes,
      timelineEndMinutes - (range.endMinutes - range.startMinutes),
    );
    if (nextStart === range.startMinutes) return;
    recordUndo("activity move");
    setActivities((current) => current.map((item) => item.id === activity.id
      ? {
        ...item,
        startAt: timestampForMinutes(dateFromTimestamp(activity.startAt), nextStart),
        endAt: timestampForMinutes(dateFromTimestamp(activity.startAt), nextStart + range.endMinutes - range.startMinutes),
      }
      : item));
  };

  const resizeActivityEnd = (activity: Activity, direction: -1 | 1) => {
    if (activity.endAt === null) return;
    const range = activityRange(activity);
    const nextEnd = clamp(range.endMinutes + direction * snapMinutes, range.startMinutes + snapMinutes, timelineEndMinutes);
    if (nextEnd === range.endMinutes) return;
    recordUndo("activity resize");
    setActivities((current) => current.map((item) => item.id === activity.id
      ? { ...item, endAt: timestampForMinutes(dateFromTimestamp(activity.startAt), nextEnd) }
      : item));
  };

  const selectAdjacentActivity = (activity: Activity, direction: -1 | 1) => {
    const sameDay = activitiesForDate(dateFromTimestamp(activity.startAt)).sort(
      (left, right) => minutesFromTimestamp(left.startAt) - minutesFromTimestamp(right.startAt),
    );
    const currentIndex = sameDay.findIndex((item) => item.id === activity.id);
    const nextActivity = sameDay[currentIndex + direction];
    if (!nextActivity) return;
    setSelectedActivityId(nextActivity.id);
    activityRefs.current.get(nextActivity.id)?.focus();
  };

  const exitResizeMode = () => {
    setResizeMode(false);
    if (selectedActivityId) activityRefs.current.get(selectedActivityId)?.focus();
  };

  const handleResizeKeyDown = (
    event: ReactKeyboardEvent<HTMLSpanElement>,
    activity: Activity,
    edge: "start" | "end",
  ) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      exitResizeMode();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    if (edge === "end") {
      resizeActivityEnd(activity, event.key === "ArrowRight" ? 1 : -1);
      return;
    }
    const range = activityRange(activity);
    const nextStart = clamp(
      range.startMinutes + (event.key === "ArrowRight" ? 1 : -1) * snapMinutes,
      timelineStartMinutes,
      range.endMinutes - snapMinutes,
    );
    if (nextStart === range.startMinutes) return;
    recordUndo("activity resize");
    setActivities((current) => current.map((item) => item.id === activity.id
      ? { ...item, startAt: timestampForMinutes(dateFromTimestamp(activity.startAt), nextStart) }
      : item));
  };

  const handleActivityKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, activity: Activity) => {
    if (event.key === "Escape") {
      if (resizeMode) {
        event.preventDefault();
        exitResizeMode();
      } else {
        setSelectedActivityId(null);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      openActivityDetails(activity);
      return;
    }
    if (event.key.toLowerCase() === "r" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      setSelectedActivityId(activity.id);
      setResizeMode(true);
      return;
    }
    if (event.altKey && event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      resizeActivityEnd(activity, event.key === "ArrowRight" ? 1 : -1);
      return;
    }
    if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      nudgeActivity(activity, event.key === "ArrowRight" ? 1 : -1);
      return;
    }
    if (!event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      selectAdjacentActivity(activity, event.key === "ArrowRight" ? 1 : -1);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteActivity(activity);
    }
  };

  useEffect(() => {
    if (!resizeMode || !selectedActivityId) return;
    const frame = window.requestAnimationFrame(() => startHandleRefs.current.get(selectedActivityId)?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [resizeMode, selectedActivityId]);

  useEffect(() => () => {
    if (gestureFrameRef.current !== null) window.cancelAnimationFrame(gestureFrameRef.current);
    if (undoNoticeTimeoutRef.current !== null) window.clearTimeout(undoNoticeTimeoutRef.current);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing = target?.matches("input, textarea, select, [contenteditable='true']");
      if (isEditing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }
      if (event.key.toLowerCase() === "t" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        toggleTimer();
        return;
      }
      if (event.key.toLowerCase() !== "n" || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      openQuickEntry();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [openQuickEntry, toggleTimer, undo]);

  const activityActionButtons = (activity: Activity) => (
    <>
      <button
        type="button"
        aria-label={`Duplicate ${activity.title}`}
        title="Duplicate"
        disabled={activity.endAt === null}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          duplicateActivity(activity);
        }}
      >
        ×2
      </button>
      <button
        type="button"
        aria-label={`Copy summary for ${activity.title}`}
        title="Copy summary"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          void copyActivitySummary(activity);
        }}
      >
        ⧉
      </button>
      <button
        type="button"
        aria-label={`Move ${activity.title} to another date`}
        title="Move to date"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          moveActivityToDate(activity);
        }}
      >
        ↗
      </button>
      <button
        className={styles.activityDeleteButton}
        type="button"
        aria-label={`Delete ${activity.title}`}
        title="Delete"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          deleteActivity(activity);
        }}
      >
        <Trash2 size={12} />
      </button>
    </>
  );

  const editingActivity = editingActivityId
    ? activities.find((activity) => activity.id === editingActivityId) ?? null
    : null;
  const currentMinutes = minutesFromClock(clock);
  const isCurrentTimeVisible = dates.some((date) => date.iso === todayIso)
    && currentMinutes >= timelineStartMinutes
    && currentMinutes <= timelineEndMinutes;
  const nowPosition = isCurrentTimeVisible
    ? `${((currentMinutes - timelineStartMinutes) / (timelineEndMinutes - timelineStartMinutes)) * 100}%`
    : "0%";
  const visibleDates = dates.filter((date) => showRestDays
    || date.iso === todayIso
    || activitiesForDate(date.iso).length > 0);
  const dateGroups = visibleDates.map((date) => ({
    date,
    activities: activitiesForDate(date.iso),
  }));
  const kanbanDateGroups = [...dateGroups].sort((left, right) => right.date.iso.localeCompare(left.date.iso));
  const tableRows = dateGroups
    .flatMap(({ date, activities: dayActivities }) => dayActivities.map((activity) => {
      const category = availableCategories.find((item) => item.id === activity.categoryId)
        ?? categoryCatalog.find((item) => item.id === activity.categoryId)
        ?? categories[0];
      const linkedTask = activity.taskId ? tasks.find((task) => task.id === activity.taskId) ?? null : null;
      const priority = activity.priority ?? defaultPriorityForCategory(preferences, category.id);
      const durationMinutes = activityDurationMinutes(activity);
      return {
        date,
        activity,
        category,
        linkedTask,
        priority,
        durationMinutes,
        searchText: [
          date.iso,
          date.date,
          activity.title,
          activity.notes,
          activity.tags.join(" "),
          category.name,
          linkedTask?.title ?? "",
          priority,
        ].join(" ").toLowerCase(),
      };
    }));
  const normalizedTableSearch = tableSearch.trim().toLowerCase();
  const filteredTableRows = tableRows.filter((row) => (
    !normalizedTableSearch || row.searchText.includes(normalizedTableSearch)
  ) && (
    tableCategoryFilter === "all" || row.category.id === tableCategoryFilter
  ) && (
    tablePriorityFilter === "all" || row.priority === tablePriorityFilter
  ) && (
    tableTaskFilter === "all"
      || (tableTaskFilter === "linked" && row.linkedTask !== null)
      || (tableTaskFilter === "unlinked" && row.linkedTask === null)
  ));
  const tableSortDirection = tableSort.direction === "asc" ? 1 : -1;
  const tableActivities = [...filteredTableRows].sort((left, right) => {
    let comparison = 0;
    if (tableSort.key === "date") comparison = left.date.iso.localeCompare(right.date.iso);
    if (tableSort.key === "activity") comparison = left.activity.title.localeCompare(right.activity.title);
    if (tableSort.key === "category") comparison = left.category.name.localeCompare(right.category.name);
    if (tableSort.key === "time") comparison = left.activity.startAt.localeCompare(right.activity.startAt);
    if (tableSort.key === "duration") comparison = left.durationMinutes - right.durationMinutes;
    if (tableSort.key === "priority") comparison = left.priority.localeCompare(right.priority);
    if (comparison !== 0) return comparison * tableSortDirection;
    return left.activity.startAt.localeCompare(right.activity.startAt) * tableSortDirection
      || left.activity.id.localeCompare(right.activity.id);
  });
  const tableFiltersActive = Boolean(
    tableSearch.trim()
      || tableCategoryFilter !== "all"
      || tablePriorityFilter !== "all"
      || tableTaskFilter !== "all",
  );
  const setTableSortKey = (key: TableSortKey) => {
    setTableSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "date" || key === "time" ? "desc" : "asc" });
  };
  const clearTableFilters = () => {
    setTableSearch("");
    setTableCategoryFilter("all");
    setTablePriorityFilter("all");
    setTableTaskFilter("all");
  };
  const tableSortButton = (key: TableSortKey) => {
    const active = tableSort.key === key;
    const direction = active ? tableSort.direction : "none";
    return (
      <button
        className={`${styles.tableSortButton} ${active ? styles.tableSortButtonActive : ""}`}
        type="button"
        aria-label={`Sort by ${tableSortLabels[key]}${active ? ` ${tableSort.direction === "asc" ? "ascending" : "descending"}` : ""}`}
        onClick={() => setTableSortKey(key)}
      >
        {tableSortLabels[key]} <span aria-hidden="true">{direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕"}</span>
      </button>
    );
  };
  const visibleTasks = tasks
    .filter((task) => taskStatusFilter === "all" || task.status === taskStatusFilter)
    .filter((task) => `${task.title} ${task.description}`.toLowerCase().includes(taskQuery.trim().toLowerCase()))
    .sort((left, right) => {
      const statusDifference = taskStatusRank[left.status] - taskStatusRank[right.status];
      if (statusDifference !== 0) return statusDifference;
      if (left.dueDate === null && right.dueDate !== null) return 1;
      if (left.dueDate !== null && right.dueDate === null) return -1;
      return (left.dueDate ?? "").localeCompare(right.dueDate ?? "") || left.title.localeCompare(right.title);
    });

  return (
    <div className={`${styles.page} ${viewMode !== "timeline" ? styles.standardPage : ""}`} data-hydrated={hydrated ? "true" : "false"}>
      <main className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/" aria-label="WorkFlow Journal home">
            <span className={styles.brandMark}>W</span>
            WorkFlow Journal
          </Link>
          <nav className={styles.nav} aria-label="Primary navigation">
            <Link aria-label="Timeline" className={`${styles.navLink} ${styles.navActive}`} href="/"><CalendarDays size={15} /><span>Timeline</span></Link>
            <Link aria-label="Search" className={styles.navLink} href="/search"><Search size={15} /><span>Search</span></Link>
            <Link aria-label="Statistics" className={styles.navLink} href="/statistics"><BarChart3 size={15} /><span>Statistics</span></Link>
            <Link aria-label="Settings" className={styles.navLink} href="/settings"><Settings size={15} /><span>Settings</span></Link>
          </nav>
          <div className={styles.headerActions}>
            <button className={styles.iconButton} type="button" aria-label="Help" title="Help"><CircleHelp size={17} /></button>
            <button className={styles.iconButton} type="button" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} title="Toggle theme" onClick={toggleTheme}>
              {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
            </button>
            <button className={styles.primaryButton} type="button" onClick={addActivity}><Plus size={15} /> New activity</button>
          </div>
        </header>

        {/*
          <section className={styles.intro} aria-labelledby="timeline-title">
            <div>
              <p className={styles.eyebrow}>{formatMonthLabel(selectedDate)}</p>
              <h1 className={styles.title} id="timeline-title">Make the day legible.</h1>
            </div>
            <p className={styles.subtitle}>A quiet record of where your attention went, one block at a time.</p>
          </section>
          */}

        <section className={`${styles.timelinePanel} ${viewMode !== "timeline" ? styles.standardView : ""}`} aria-label="Work timeline">
          <div className={styles.timelineToolbar} data-timeline-toolbar="true">
            <div className={styles.dateControls}>
              <button className={styles.iconButton} type="button" aria-label="Previous month" title="Previous month" onClick={() => setSelectedDate((current) => addMonths(current, -1))}><ChevronLeft size={17} /></button>
              <button className={styles.iconButton} type="button" aria-label="Next month" title="Next month" onClick={() => setSelectedDate((current) => addMonths(current, 1))}><ChevronRight size={17} /></button>
              <button className={styles.textButton} type="button" onClick={() => setSelectedDate(todayIso)}><Clock3 size={14} /> Today</button>
              <p className={styles.dateLabel}>{formatMonthLabel(selectedDate)}<span>{preferences.timezone}</span></p>
            </div>
            <div className={styles.toolbarActions}>
              <button
                className={`${styles.textButton} ${tasksOpen ? styles.taskToolbarButtonActive : ""}`}
                type="button"
                aria-expanded={tasksOpen}
                aria-controls="task-drawer"
                onClick={() => setTasksOpen((current) => !current)}
              >
                <ListTodo size={14} /> Tasks{tasks.length > 0 ? ` · ${tasks.length}` : ""}
              </button>
              <button
                className={`${styles.textButton} ${showRestDays ? styles.restDaysToolbarButtonActive : ""}`}
                type="button"
                aria-pressed={showRestDays}
                title="Toggle rest-day rows for this view"
                onClick={() => setShowRestDays((current) => !current)}
              >
                <CalendarDays size={14} /> Rest days · {showRestDays ? "Shown" : "Hidden"}
              </button>
              {runningActivity && <div className={styles.timer}><span className={styles.timerDot} /> In progress · {formatElapsed(runningActivity.startAt)}</div>}
              <button className={styles.textButton} type="button" onClick={toggleTimer}>{runningActivity ? <><Clock3 size={14} /> Stop timer</> : <><Play size={14} /> Start timer</>}</button>
              <div className={styles.viewSwitcher} role="group" aria-label="Activity view">
                {viewModeOptions.map((option) => (
                  <button
                    className={`${styles.viewButton} ${viewMode === option.value ? styles.viewButtonActive : ""}`}
                    type="button"
                    key={option.value}
                    aria-pressed={viewMode === option.value}
                    onClick={() => setViewMode(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <details className={styles.appearanceMenu} data-appearance-menu>
                <summary className={styles.iconButton} aria-label="Timeline appearance" title="Timeline appearance"><Palette size={16} /></summary>
                <div className={styles.appearancePopover} role="group" aria-label="Accent theme">
                  <strong className={styles.appearanceTitle}>Accent theme</strong>
                  <span className={styles.appearanceDescription}>Choose a palette color for the interface.</span>
                  <div className={styles.appearanceOptions}>
                    {activityColorOptions.map((option) => (
                      <button
                        className={`${styles.appearanceOption} ${accentTheme === option.token ? styles.appearanceOptionSelected : ""}`}
                        type="button"
                        key={option.token}
                        aria-label={`${option.label} theme`}
                        aria-pressed={accentTheme === option.token}
                        title={`${option.label} theme`}
                        onClick={() => selectAccentTheme(option.token)}
                      >
                        <span
                          className={styles.appearanceSwatch}
                          aria-hidden="true"
                          style={{ background: `var(--activity-color-${option.token})` }}
                        />
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </details>
            </div>
          </div>

          {viewMode === "timeline" && (
            <>
          <div className={styles.timeHeaderViewport} data-time-header="true">
            <div
              className={styles.timeHeader}
              style={{ transform: `translateX(-${timelineScrollLeft}px)` }}
            >
              <div className={styles.timeHeaderLabel}>Local time</div>
              <div className={styles.hours} data-time-hours="true" style={{ "--hour-count": String(hours.length) } as TimelineStyle}>{hours.map((hour) => <span key={hour}>{hour}</span>)}</div>
              {isCurrentTimeVisible && (
                <div
                  className={styles.currentTimeHeaderLine}
                  aria-hidden="true"
                  style={{ "--now-position": nowPosition } as TimelineStyle}
                />
              )}
            </div>
          </div>
          <div
            ref={timelineScrollRef}
            className={styles.timelineScroll}
            data-timeline-scroll="true"
            onScroll={(event) => setTimelineScrollLeft(event.currentTarget.scrollLeft)}
          >
            {isCurrentTimeVisible && (
              <div
                className={styles.currentTimeLine}
                data-current-time-marker="true"
                aria-label="Current time"
                style={{ "--now-position": nowPosition } as TimelineStyle}
              />
            )}
            {visibleDates.map((date, dateIndex) => {
              const dayActivities = activitiesForDate(date.iso);
              const restDayStatus = restDayStatusForDate(date.iso, preferences);
              const layout = timelineLayoutForDate(date.iso);
              const rowHeight = rowHeightForLaneCount(layout.laneCount);
              const isLastVisibleRow = dateIndex === visibleDates.length - 1;
              const earlierCount = dayActivities.filter((activity) => activityRange(activity).startMinutes < timelineStartMinutes).length;
              const laterCount = dayActivities.filter((activity) => activityRange(activity).endMinutes > timelineEndMinutes).length;
              return (
              <div
                className={`${styles.dayRow} ${date.iso === todayIso ? styles.today : ""}`}
                key={date.iso}
                style={{ "--row-height": `${rowHeight}px` } as TimelineStyle}
              >
                <div className={styles.dayMeta}>
                  <div className={styles.dayName}>
                    <span>{date.day}</span>
                    <span className={styles.dayPills}>
                      {date.iso === todayIso && <span className={styles.todayPill}>Today</span>}
                      {showRestDays && restDayStatus && (
                        <span className={styles.restDayPill}>{restDayLabel(restDayStatus)}</span>
                      )}
                    </span>
                  </div>
                  <div className={styles.dayDate}>{date.date}</div>
                  <div className={styles.daySummary}>{summaryForDate(date.iso)}</div>
                  {(earlierCount > 0 || laterCount > 0) && (
                    <div className={styles.dayOverflow} aria-label="Activities outside the visible time range">
                      {earlierCount > 0 && <span>← {earlierCount} earlier</span>}
                      {laterCount > 0 && <span>{laterCount} later →</span>}
                    </div>
                  )}
                </div>
                <div
                  className={styles.track}
                  data-timeline-track={date.iso}
                  style={{ "--hour-count": String(hours.length) } as TimelineStyle}
                  onPointerDown={(event) => handleTrackPointerDown(event, date.iso)}
                  onPointerMove={handleTrackPointerMove}
                  onPointerUp={handleTrackPointerUp}
                  onPointerCancel={handleTrackPointerCancel}
                >
                  {layout.gaps.map((gap) => (
                    <button
                      className={styles.timelineGap}
                      key={`${gap.startMinutes}-${gap.endMinutes}`}
                      type="button"
                      style={positionForRange(gap.startMinutes, gap.endMinutes)}
                      aria-label={`Create activity for ${formatWallTime(gap.startMinutes)} to ${formatWallTime(gap.endMinutes)}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => createActivityAt(date.iso, gap.startMinutes, gap.endMinutes)}
                    >
                      <span>{formatWallTime(gap.startMinutes)} – {formatWallTime(gap.endMinutes)}</span>
                      <strong>＋</strong>
                    </button>
                  ))}
                  {layout.intervals.map(({ activity, lane }) => {
                    const category = availableCategories.find((item) => item.id === activity.categoryId)
                      ?? categoryCatalog.find((item) => item.id === activity.categoryId)
                      ?? categories[0];
                    const linkedTask = activity.taskId ? tasks.find((task) => task.id === activity.taskId) : null;
                    const range = activityRange(activity);
                    const activeGesture = gesture?.activityId === activity.id ? gesture : null;
                    const renderedRange = activeGesture
                      ? { startMinutes: activeGesture.previewStartMinutes, endMinutes: activeGesture.previewEndMinutes }
                      : range;
                    const position = positionForRange(renderedRange.startMinutes, renderedRange.endMinutes);
                    const isSelected = selectedActivityId === activity.id;
                    const isDragging = activeGesture?.kind === "move";
                    const isResizing = activeGesture?.kind === "resize";
                    const isCompact = compactActivityIds.has(activity.id);
                    const durationMinutes = Math.max(0, Math.round(renderedRange.endMinutes - renderedRange.startMinutes));
                    const durationLabel = activity.endAt === null ? `${formatElapsed(activity.startAt)} elapsed` : `${durationMinutes} minutes`;
                    const popoverAbove = lane > 0 || isLastVisibleRow;
                    const popoverRight = renderedRange.startMinutes > (timelineStartMinutes + timelineEndMinutes) / 2;
                    const timeLabel = activeGesture
                      ? `${formatWallTime(renderedRange.startMinutes)} – ${activity.endAt === null ? "now" : formatWallTime(renderedRange.endMinutes)}`
                      : `${formatTime(activity.startAt)} – ${activity.endAt ? formatTime(activity.endAt) : "now"}`;
                    return (
                      <div
                        className={`${styles.activity} ${isSelected ? styles.activitySelected : ""} ${isSelected && isCompact ? styles.activityPopoverOpen : ""} ${isDragging ? styles.activityDragging : ""} ${isResizing ? styles.activityResizing : ""}`}
                        data-activity-id={activity.id}
                        data-compact={isCompact ? "true" : "false"}
                        key={activity.id}
                        ref={(node) => {
                          if (node) activityRefs.current.set(activity.id, node);
                          else activityRefs.current.delete(activity.id);
                        }}
                        style={{
                          ...position,
                          top: `${timelineLayoutConstants.activityTop + lane * (timelineLayoutConstants.activityHeight + timelineLayoutConstants.laneGap)}px`,
                          "--activity-color": activity.colorToken
                            ? `var(--activity-color-${activity.colorToken})`
                            : `var(--activity-color-${colorTokenForCategory(preferences, category)})`,
                        } as TimelineStyle}
                        role="group"
                        tabIndex={0}
                        aria-label={`${activity.title}, ${category.name}, ${timeLabel}`}
                        aria-roledescription="timeline activity"
                        onClick={() => {
                          setSelectedActivityId(activity.id);
                          setSelectedDate(date.iso);
                        }}
                        onDoubleClick={() => openActivityDetails(activity)}
                        onPointerDown={(event) => startActivityGesture(event, activity)}
                        onKeyDown={(event) => handleActivityKeyDown(event, activity)}
                      >
                        <span className={styles.activityIcon}>{iconForCategory(category.id)}</span>
                        <span className={styles.activityBody}>
                          <span className={styles.activityTitle}>{activity.title}</span>
                          <span className={styles.activityTime}>{timeLabel}</span>
                        </span>
                        {isSelected && !isCompact && (
                          <div className={styles.activityActions} role="toolbar" aria-label={`Actions for ${activity.title}`}>
                            {activityActionButtons(activity)}
                          </div>
                        )}
                        {isSelected && isCompact && (
                          <div
                            className={`${styles.activityPopover} ${popoverAbove ? styles.activityPopoverAbove : styles.activityPopoverBelow} ${popoverRight ? styles.activityPopoverRight : ""}`}
                            role="dialog"
                            aria-label={`Details for ${activity.title}`}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <div className={styles.activityPopoverHeader}>
                              <div className={styles.activityPopoverHeading}>
                                <strong>{activity.title}</strong>
                                <span>{category.name} · {timeLabel}</span>
                              </div>
                            </div>
                            <div className={styles.activityPopoverMeta}>
                              <span>{durationLabel}</span>
                              <span>{activity.priority ?? defaultPriorityForCategory(preferences, category.id)} priority</span>
                              {linkedTask && <span>Task: {linkedTask.title}</span>}
                            </div>
                            {activity.notes && <p className={styles.activityPopoverNotes}>{activity.notes}</p>}
                            {activity.tags.length > 0 && (
                              <div className={styles.activityPopoverTags}>
                                {activity.tags.map((tag) => <span key={tag}>#{tag}</span>)}
                              </div>
                            )}
                            <div className={styles.activityPopoverActions} role="toolbar" aria-label={`Actions for ${activity.title}`}>
                              {activityActionButtons(activity)}
                              <button
                                className={styles.activityPopoverClose}
                                type="button"
                                aria-label={`Close details for ${activity.title}`}
                                title="Close"
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedActivityId(null);
                                }}
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        )}
                        {isSelected && (
                          <>
                            <span
                              className={`${styles.activityHandle} ${styles.activityHandleStart}`}
                              ref={(node) => {
                                if (node) startHandleRefs.current.set(activity.id, node);
                                else startHandleRefs.current.delete(activity.id);
                              }}
                              role="button"
                              tabIndex={resizeMode ? 0 : -1}
                              aria-label={`Resize start of ${activity.title}`}
                              onPointerDown={(event) => startActivityGesture(event, activity, "start")}
                              onKeyDown={(event) => handleResizeKeyDown(event, activity, "start")}
                            />
                            {activity.endAt !== null && (
                              <span
                                className={`${styles.activityHandle} ${styles.activityHandleEnd}`}
                                role="button"
                                tabIndex={resizeMode ? 0 : -1}
                                aria-label={`Resize end of ${activity.title}`}
                                onPointerDown={(event) => startActivityGesture(event, activity, "end")}
                                onKeyDown={(event) => handleResizeKeyDown(event, activity, "end")}
                              />
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                  {layout.hiddenCount > 0 && (
                    <button
                      className={styles.moreActivities}
                      type="button"
                      onClick={() => setSelectedDate(date.iso)}
                      aria-label={`${layout.hiddenCount} more activities on ${date.date}`}
                    >
                      +{layout.hiddenCount} more
                    </button>
                  )}
                  {gesture?.kind === "create" && gesture.dayIso === date.iso && (
                    <div
                      className={styles.activityPreview}
                      style={{
                        ...positionForRange(gesture.previewStartMinutes, gesture.previewEndMinutes),
                        "--activity-color": "var(--color-accent)",
                        top: `${timelineLayoutConstants.activityTop}px`,
                      } as TimelineStyle}
                      aria-hidden="true"
                    >
                      {formatWallTime(gesture.previewStartMinutes)} – {formatWallTime(gesture.previewEndMinutes)}
                    </div>
                  )}
                  {dayActivities.length === 0 && <span className={styles.emptyDay}>Nothing recorded yet.</span>}
                </div>
              </div>
              );
            })}
          </div>
            </>
          )}

          {viewMode === "kanban" && (
            <div className={styles.kanbanScroll} data-view="kanban">
              <div className={styles.kanbanBoard}>
                {kanbanDateGroups.map(({ date, activities: dayActivities }) => (
                  <section
                    className={`${styles.kanbanColumn} ${date.iso === todayIso ? styles.kanbanColumnToday : ""}`}
                    key={date.iso}
                    aria-labelledby={`kanban-date-${date.iso}`}
                  >
                    <header className={styles.kanbanColumnHeader}>
                      <div className={styles.kanbanColumnHeading}>
                        <strong id={`kanban-date-${date.iso}`}>{date.day}</strong>
                        <span>{date.date}</span>
                      </div>
                      <span className={styles.kanbanColumnSummary}>{summaryForDate(date.iso)}</span>
                    </header>
                    <div className={styles.kanbanCards}>
                      {dayActivities.map((activity) => {
                        const category = availableCategories.find((item) => item.id === activity.categoryId)
                          ?? categoryCatalog.find((item) => item.id === activity.categoryId)
                          ?? categories[0];
                        const timeLabel = activityTimeLabel(activity);
                        return (
                          <article
                            className={styles.kanbanCard}
                            key={activity.id}
                            role="group"
                            tabIndex={0}
                            aria-label={`${activity.title}, ${category.name}, ${timeLabel}`}
                            style={{
                              "--activity-color": activity.colorToken
                                ? `var(--activity-color-${activity.colorToken})`
                                : `var(--activity-color-${colorTokenForCategory(preferences, category)})`,
                            } as TimelineStyle}
                            onClick={() => openActivityDetails(activity)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openActivityDetails(activity);
                              }
                            }}
                          >
                            <div className={styles.activityActions} role="toolbar" aria-label={`Actions for ${activity.title}`}>
                              {activityActionButtons(activity)}
                            </div>
                            <strong className={styles.kanbanCardTitle}>{activity.title}</strong>
                            <div className={styles.kanbanCardMeta}>
                              <span className={styles.kanbanCardCategory}>{category.name}</span>
                              <span>{timeLabel}</span>
                              <span>{activityDurationLabel(activity)}</span>
                            </div>
                          </article>
                        );
                      })}
                      {dayActivities.length === 0 && <p className={styles.kanbanEmpty}>No activities</p>}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}

          {viewMode === "table" && (
            <>
            <div className={styles.tableToolbar} role="search" aria-label="Search and filter activities">
              <label className={styles.tableSearchField}>
                <span>Search</span>
                <div className={styles.tableSearchInput}>
                  <Search size={14} aria-hidden="true" />
                  <input
                    type="search"
                    aria-label="Search activities"
                    placeholder="Title, tags, notes, task..."
                    value={tableSearch}
                    onChange={(event) => setTableSearch(event.currentTarget.value)}
                  />
                </div>
              </label>
              <label className={styles.tableFilterField}>
                <span>Category</span>
                <select aria-label="Filter by category" value={tableCategoryFilter} onChange={(event) => setTableCategoryFilter(event.currentTarget.value)}>
                  <option value="all">All categories</option>
                  {availableCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
              <label className={styles.tableFilterField}>
                <span>Priority</span>
                <select aria-label="Filter by priority" value={tablePriorityFilter} onChange={(event) => setTablePriorityFilter(event.currentTarget.value)}>
                  <option value="all">All priorities</option>
                  {preferences.priorityOptions.map((priority) => <option key={priority} value={priority}>{priority.replace(/[-_]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())}</option>)}
                </select>
              </label>
              <label className={styles.tableFilterField}>
                <span>Task</span>
                <select aria-label="Filter by task" value={tableTaskFilter} onChange={(event) => setTableTaskFilter(event.currentTarget.value as typeof tableTaskFilter)}>
                  <option value="all">All activities</option>
                  <option value="linked">Task linked</option>
                  <option value="unlinked">No task</option>
                </select>
              </label>
              <button className={styles.textButton} type="button" aria-label="Clear table filters" disabled={!tableFiltersActive} onClick={clearTableFilters}>Clear</button>
              <span className={styles.tableResultCount}>{tableActivities.length} of {tableRows.length}</span>
            </div>
            <div className={styles.tableScroll} data-view="table">
              <table className={styles.activityTable} aria-label={`Activities for ${formatMonthLabel(selectedDate)}`}>
                <thead>
                  <tr>
                    <th scope="col" aria-sort={tableSort.key === "date" ? (tableSort.direction === "asc" ? "ascending" : "descending") : "none"}>{tableSortButton("date")}</th>
                    <th scope="col" aria-sort={tableSort.key === "activity" ? (tableSort.direction === "asc" ? "ascending" : "descending") : "none"}>{tableSortButton("activity")}</th>
                    <th scope="col" aria-sort={tableSort.key === "category" ? (tableSort.direction === "asc" ? "ascending" : "descending") : "none"}>{tableSortButton("category")}</th>
                    <th scope="col" aria-sort={tableSort.key === "time" ? (tableSort.direction === "asc" ? "ascending" : "descending") : "none"}>{tableSortButton("time")}</th>
                    <th scope="col" aria-sort={tableSort.key === "duration" ? (tableSort.direction === "asc" ? "ascending" : "descending") : "none"}>{tableSortButton("duration")}</th>
                    <th scope="col">Task</th>
                    <th scope="col" aria-sort={tableSort.key === "priority" ? (tableSort.direction === "asc" ? "ascending" : "descending") : "none"}>{tableSortButton("priority")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tableActivities.map(({ date, activity, category, linkedTask, priority }) => {
                    const timeLabel = activityTimeLabel(activity);
                    return (
                      <tr
                        key={activity.id}
                        tabIndex={0}
                        aria-label={`${activity.title}, ${category.name}, ${timeLabel}`}
                        onClick={() => openActivityDetails(activity)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openActivityDetails(activity);
                          }
                        }}
                      >
                        <td className={styles.tableDate}><strong>{date.day}</strong><br /><span>{date.date}</span></td>
                        <td>
                          <div className={styles.tableActivity}>
                            <strong>{activity.title}</strong>
                            {activity.tags.length > 0 && <span>{activity.tags.map((tag) => `#${tag}`).join(" ")}</span>}
                          </div>
                        </td>
                        <td>
                          <span
                            className={styles.tableCategory}
                            style={{
                              "--activity-color": activity.colorToken
                                ? `var(--activity-color-${activity.colorToken})`
                                : `var(--activity-color-${colorTokenForCategory(preferences, category)})`,
                            } as TimelineStyle}
                          >
                            <span className={styles.tableColorDot} aria-hidden="true" />
                            {category.name}
                          </span>
                        </td>
                        <td className={styles.tableTime}>{timeLabel}</td>
                        <td className={styles.tableMuted}>{activityDurationLabel(activity)}</td>
                        <td className={styles.tableTask}>{linkedTask?.title ?? "—"}</td>
                        <td className={styles.tablePriority}>{priority}</td>
                      </tr>
                    );
                  })}
                  {tableActivities.length === 0 && (
                    <tr>
                      <td className={styles.tableEmpty} colSpan={7}>No activities match the current search and filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            </>
          )}
        </section>

        <aside
          className={`${styles.taskDrawer} ${tasksOpen ? styles.taskDrawerOpen : ""}`}
          id="task-drawer"
          aria-label="Task manager"
          aria-hidden={!tasksOpen}
        >
          <div className={styles.taskDrawerHeader}>
            <div>
              <p className={styles.eyebrow}>Work list</p>
              <h2 className={styles.taskDrawerTitle}>Tasks</h2>
              <p className={styles.taskDrawerDescription}>Keep future work close to the time you record.</p>
            </div>
            <button className={styles.iconButton} type="button" aria-label="Close task manager" onClick={() => setTasksOpen(false)}>×</button>
          </div>

          {taskDraft ? (
            <form
              className={styles.taskForm}
              onSubmit={(event) => {
                event.preventDefault();
                saveTaskDraft();
              }}
            >
              <div className={styles.taskFormHeading}>
                <strong>{taskDraft.id ? "Edit task" : "Add task"}</strong>
                <button className={styles.textButton} type="button" onClick={closeTaskEditor}>Cancel</button>
              </div>
              <label className={styles.field}>
                <span>Title</span>
                <input
                  ref={taskTitleInputRef}
                  value={taskDraft.title}
                  onChange={(event) => {
                    setTaskDraft((current) => current ? { ...current, title: event.target.value } : current);
                    setTaskError(null);
                  }}
                  placeholder="What needs doing?"
                  autoComplete="off"
                />
              </label>
              <label className={styles.field}>
                <span>Due date <small>optional</small></span>
                <input
                  type="date"
                  value={taskDraft.dueDate}
                  onChange={(event) => setTaskDraft((current) => current ? { ...current, dueDate: event.target.value } : current)}
                />
              </label>
              <label className={styles.field}>
                <span>Status</span>
                <select
                  value={taskDraft.status}
                  onChange={(event) => setTaskDraft((current) => current ? { ...current, status: event.target.value as TaskStatus } : current)}
                >
                  {taskStatusOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                <span>Description <small>optional</small></span>
                <textarea
                  value={taskDraft.description}
                  onChange={(event) => setTaskDraft((current) => current ? { ...current, description: event.target.value } : current)}
                  rows={4}
                  placeholder="A little context for later."
                />
              </label>
              {taskError && <p className={styles.formError} role="alert">{taskError}</p>}
              <button className={styles.primaryButton} type="submit">{taskDraft.id ? "Save task" : "Add task"}</button>
            </form>
          ) : (
            <>
              <div className={styles.taskDrawerActions}>
                <button className={styles.primaryButton} type="button" onClick={openNewTask}><Plus size={14} /> Add task</button>
                <label className={styles.taskSearch}>
                  <span className={styles.srOnly}>Search tasks</span>
                  <Search size={14} aria-hidden="true" />
                  <input value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} placeholder="Search tasks" />
                </label>
              </div>
              <label className={styles.taskFilter}>
                <span>Status</span>
                <select value={taskStatusFilter} onChange={(event) => setTaskStatusFilter(event.target.value as TaskStatus | "all")}>
                  <option value="all">All statuses</option>
                  {taskStatusOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
              <div className={styles.taskList}>
                {visibleTasks.map((task) => {
                  const overdue = task.dueDate !== null && task.dueDate < todayIso && task.status !== "closed" && task.status !== "fixed";
                  return (
                    <article className={styles.taskCard} key={task.id}>
                      <div className={styles.taskCardHeader}>
                        <button className={styles.taskTitleButton} type="button" onClick={() => openTaskEditor(task)}>{task.title}</button>
                        <span className={`${styles.taskStatusBadge} ${styles[`taskStatus${task.status.replace(/(^|-)(\w)/g, (_, separator, character) => character.toUpperCase())}`]}`}>{taskStatusLabel(task.status)}</span>
                      </div>
                      {task.description && <p className={styles.taskDescription}>{task.description}</p>}
                      <div className={`${styles.taskMeta} ${overdue ? styles.taskOverdue : ""}`}>
                        <span>{task.dueDate ? (overdue ? `Overdue · ${formatDateLabel(task.dueDate)}` : `Due ${formatDateLabel(task.dueDate)}`) : "No due date"}</span>
                      </div>
                      <div className={styles.taskCardActions}>
                        <select aria-label={`Status for ${task.title}`} value={task.status} onChange={(event) => updateTaskStatus(task, event.target.value as TaskStatus)}>
                          {taskStatusOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                        </select>
                        <button className={styles.textButton} type="button" onClick={() => logActivityForTask(task)}>Log activity</button>
                        <button className={`${styles.textButton} ${styles.dangerButton}`} type="button" onClick={() => deleteTask(task)}>Delete</button>
                      </div>
                    </article>
                  );
                })}
                {visibleTasks.length === 0 && <p className={styles.taskEmpty}>{tasks.length === 0 ? "No tasks yet. Add one for future work." : "No tasks match those filters."}</p>}
              </div>
            </>
          )}
        </aside>

        {undoNotice && (
          <div className={styles.undoToast} role="alert">
            <span>{undoNotice}</span>
            <button className={styles.textButton} type="button" onClick={undo}>Undo</button>
          </div>
        )}
        <div className={styles.footerNote}>
          <span>Drag across an empty row to paint an activity. Gaps are part of the record.</span>
          <span><kbd>N</kbd> quick entry · <kbd>⌘/Ctrl Z</kbd> undo</span>
        </div>

        <dialog
          ref={recoveryDialogRef}
          className={styles.quickEntryDialog}
          aria-labelledby="timer-recovery-title"
          onCancel={(event) => event.preventDefault()}
        >
          {timerRecovery && (
            <div className={styles.quickEntryForm}>
              <div className={styles.detailsHeader}>
                <div>
                  <p className={styles.eyebrow}>Timer recovery</p>
                  <h2 className={styles.detailsTitle} id="timer-recovery-title">A timer crossed a day boundary.</h2>
                </div>
              </div>
              <div className={styles.detailsFields}>
                <p className={styles.detailsStatus}>
                  “{timerRecovery.activity.title}” was left running on {formatDateLabel(timerRecovery.startDate)}.
                  Work is never inferred while the app was closed.
                </p>
                <p className={styles.detailsStatus}>Choose whether to stop it at the original day boundary or continue it through each crossed day.</p>
              </div>
              <div className={styles.detailsFooter}>
                <button className={styles.textButton} type="button" onClick={() => resolveTimerRecovery(false)}>Stop at midnight</button>
                <button className={styles.primaryButton} type="button" onClick={() => resolveTimerRecovery(true)}>Continue to today</button>
              </div>
            </div>
          )}
        </dialog>

        <dialog
          ref={quickEntryDialogRef}
          className={styles.quickEntryDialog}
          aria-labelledby="quick-entry-title"
          onClose={closeQuickEntry}
          onCancel={(event) => {
            event.preventDefault();
            closeQuickEntry();
          }}
        >
          <form
            className={styles.quickEntryForm}
            onSubmit={(event) => {
              event.preventDefault();
              commitQuickEntry();
            }}
          >
            <div className={styles.detailsHeader}>
              <div>
                <p className={styles.eyebrow}>Quick entry</p>
                <h2 className={styles.detailsTitle} id="quick-entry-title">Capture the block.</h2>
              </div>
              <button className={styles.iconButton} type="button" aria-label="Close quick entry" onClick={closeQuickEntry}>×</button>
            </div>

            {quickEntryDraft && (
              <div className={styles.detailsFields}>
                <label className={styles.field}>
                  <span>Title</span>
                  <input
                    ref={quickEntryTitleRef}
                    value={quickEntryDraft.title}
                    onChange={(event) => {
                      setQuickEntryDraft((current) => current ? { ...current, title: event.target.value } : current);
                      setQuickEntryError(null);
                    }}
                    list="activity-title-suggestions"
                    placeholder="What were you doing?"
                    autoComplete="off"
                  />
                  <datalist id="activity-title-suggestions">
                    {[...new Set(activities.map((activity) => activity.title))].slice(0, 8).map((title) => <option value={title} key={title} />)}
                  </datalist>
                </label>

                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>Date</span>
                    <input
                      type="date"
                      value={quickEntryDraft.date}
                      onChange={(event) => setQuickEntryDraft((current) => current ? { ...current, date: event.target.value } : current)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Start</span>
                    <input
                      type="time"
                      value={quickEntryDraft.start}
                      onChange={(event) => setQuickEntryDraft((current) => current ? { ...current, start: event.target.value } : current)}
                    />
                  </label>
                </div>

                <label className={styles.field}>
                  <span>Duration</span>
                  <input
                    value={quickEntryDraft.duration}
                    onChange={(event) => {
                      setQuickEntryDraft((current) => current ? { ...current, duration: event.target.value } : current);
                      setQuickEntryError(null);
                    }}
                    placeholder="45m"
                    inputMode="text"
                  />
                  <small>Examples: 45m, 1h, 1h30</small>
                </label>
                {taskPicker(
                  tasks,
                  quickEntryDraft.taskId,
                  (taskId) => setQuickEntryDraft((current) => current ? { ...current, taskId } : current),
                  "quick-entry-task",
                )}
                {categoryRadioGroup(
                  availableCategories,
                  quickEntryDraft.categoryId,
                  (categoryId) => setQuickEntryDraft((current) => current ? { ...current, categoryId } : current),
                  "quick-entry-category",
                )}
                {colorRadioGroup(
                  quickEntryDraft.colorToken,
                  (colorToken) => setQuickEntryDraft((current) => current ? { ...current, colorToken } : current),
                  "quick-entry-color",
                )}

                {activities.length > 0 && (
                  <div className={styles.recentEntries}>
                    <span className={styles.fieldLabel}>Recent activities</span>
                    <div className={styles.recentEntryList}>
                      {[...activities].reverse().filter((activity, index, items) => items.findIndex((item) => item.title === activity.title) === index).slice(0, 4).map((activity) => (
                        <button
                          className={styles.recentEntry}
                          type="button"
                          key={activity.id}
                          onClick={() => setQuickEntryDraft((current) => current ? { ...current, title: activity.title, categoryId: activity.categoryId } : current)}
                        >
                          {activity.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {quickEntryError && <p className={styles.formError} role="alert">{quickEntryError}</p>}
            <div className={styles.detailsFooter}>
              <p className={styles.detailsStatus}>Press Enter to create</p>
              <div className={styles.toolbarActions}>
                <button className={styles.textButton} type="button" onClick={closeQuickEntry}>Cancel</button>
                <button className={styles.primaryButton} type="submit">Create activity</button>
              </div>
            </div>
          </form>
        </dialog>

        <dialog
          ref={detailsDialogRef}
          className={styles.detailsDialog}
          aria-labelledby="activity-details-title"
          onClose={resetActivityDetails}
          onCancel={(event) => {
            event.preventDefault();
            closeActivityDetails();
          }}
        >
          <form
            className={styles.detailsForm}
            onSubmit={(event) => {
              event.preventDefault();
              if (commitActivityDraft()) closeActivityDetails();
            }}
          >
            <div className={styles.detailsHeader}>
              <div>
                <p className={styles.eyebrow}>Activity details</p>
                <h2 className={styles.detailsTitle} id="activity-details-title">
                  {editingActivity?.title || "New activity"}
                </h2>
              </div>
              <button className={styles.iconButton} type="button" aria-label="Close activity details" onClick={closeActivityDetails}>×</button>
            </div>

            {activityDraft && (
              <div className={styles.detailsFields}>
                <label className={styles.field}>
                  <span>Title</span>
                  <input
                    ref={titleInputRef}
                    value={activityDraft.title}
                    onChange={(event) => updateActivityDraft("title", event.target.value)}
                    placeholder="What were you doing?"
                    autoComplete="off"
                  />
                </label>

                <label className={styles.field}>
                  <span>Date</span>
                  <input
                    type="date"
                    value={activityDraft.date}
                    onChange={(event) => updateActivityDraft("date", event.target.value)}
                  />
                </label>

                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>Start</span>
                    <input
                      type="time"
                      value={activityDraft.start}
                      onChange={(event) => updateActivityDraft("start", event.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>End</span>
                    <input
                      type="time"
                      value={activityDraft.end}
                      onChange={(event) => updateActivityDraft("end", event.target.value)}
                    />
                  </label>
                </div>

                {categoryRadioGroup(
                  availableCategories,
                  activityDraft.categoryId,
                  (categoryId) => updateActivityDraft("categoryId", categoryId),
                  "activity-category",
                )}

                {priorityRadioGroup(
                  preferences.priorityOptions,
                  activityDraft.priority,
                  (priority) => updateActivityDraft("priority", priority),
                )}

                {taskPicker(
                  tasks,
                  activityDraft.taskId,
                  (taskId) => updateActivityDraft("taskId", taskId),
                  "activity-task",
                )}

                {colorRadioGroup(
                  activityDraft.colorToken,
                  (colorToken) => updateActivityDraft("colorToken", colorToken),
                  "activity-color",
                )}

                <label className={styles.field}>
                  <span>Notes</span>
                  <textarea
                    value={activityDraft.notes}
                    onChange={(event) => updateActivityDraft("notes", event.target.value)}
                    rows={5}
                    placeholder="A little context for your future self."
                  />
                </label>

                <label className={styles.field}>
                  <span>Tags <small>comma-separated</small></span>
                  <input
                    value={activityDraft.tags}
                    onChange={(event) => updateActivityDraft("tags", event.target.value)}
                    placeholder="research, writing"
                  />
                </label>
              </div>
            )}

            <div className={styles.detailsFooter}>
              <p className={styles.detailsStatus} aria-live="polite">
                {draftError ?? (draftStatus === "saved" ? "Saved" : "Changes save automatically.")}
              </p>
              <div className={styles.toolbarActions}>
                <button
                  className={`${styles.textButton} ${styles.dangerButton}`}
                  type="button"
                  onClick={() => {
                    if (editingActivity) deleteActivity(editingActivity);
                  }}
                >
                  Delete activity
                </button>
                <button className={styles.textButton} type="submit">Done</button>
              </div>
            </div>
          </form>
        </dialog>
      </main>
    </div>
  );
}
