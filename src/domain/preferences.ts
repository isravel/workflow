import { categories } from "@/data/fixtures";
import { isActivityColorToken, type ActivityColorToken } from "@/domain/activityColors";
import type { ActivityPriority, Category } from "@/domain/types";

export const preferencesStorageKey = "workflow.preferences";
export const showRestDaysStorageKey = "workflow.showRestDays";
export const defaultTimezone = "Asia/Kolkata";
export const timezoneOptions = [
  "Asia/Kolkata",
  "UTC",
  "America/New_York",
  "Europe/London",
  "Asia/Tokyo",
] as const;

export type TimezoneOption = (typeof timezoneOptions)[number];
export type SnapMinutes = 15 | 30 | 60;
export type WeeklyHolidayDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type RestDayKind = "public-holiday" | "leave";
export type RestDayStatus = "weekly-holiday" | RestDayKind;
export type CategorySetting = {
  colorToken: ActivityColorToken;
  priority: ActivityPriority;
};

export type TimelinePreferences = {
  startHour: string;
  endHour: string;
  snapMinutes: SnapMinutes;
  timezone: TimezoneOption;
  categoryIds: string[];
  customCategories: Category[];
  removedCategoryIds: string[];
  priorityOptions: ActivityPriority[];
  categorySettings: Record<string, CategorySetting>;
  weeklyHolidayDays: WeeklyHolidayDay[];
  restDayOverrides: Record<string, RestDayKind>;
};

export const weeklyHolidayOptions: Array<{ value: WeeklyHolidayDay; label: string }> = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const defaultCategorySettings = categories.reduce<Record<string, CategorySetting>>((settings, category) => {
  settings[category.id] = { colorToken: category.colorToken, priority: "normal" };
  return settings;
}, {});

export const defaultTimelinePreferences: TimelinePreferences = {
  startHour: "08:00",
  endHour: "20:00",
  snapMinutes: 15,
  timezone: defaultTimezone,
  categoryIds: categories.map((category) => category.id),
  customCategories: [],
  removedCategoryIds: [],
  priorityOptions: ["low", "normal", "high"],
  categorySettings: defaultCategorySettings,
  weeklyHolidayDays: [],
  restDayOverrides: {},
};

const isTime = (value: unknown): value is string => typeof value === "string" && /^\d{2}:\d{2}$/.test(value);
const isTimezone = (value: unknown): value is TimezoneOption =>
  typeof value === "string" && timezoneOptions.includes(value as TimezoneOption);
const isSnapMinutes = (value: unknown): value is SnapMinutes => value === 15 || value === 30 || value === 60;
const isWeeklyHolidayDay = (value: unknown): value is WeeklyHolidayDay =>
  value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6;
const isRestDayKind = (value: unknown): value is RestDayKind => value === "public-holiday" || value === "leave";
const isDateIso = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isActivityPriority = (value: unknown): value is ActivityPriority =>
  typeof value === "string" && value.trim() !== "";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCategoryKind = (value: unknown): value is Category["kind"] =>
  value === null || value === "focus" || value === "meeting" || value === "break";
const isCategory = (value: unknown): value is Category =>
  isRecord(value)
  && typeof value.id === "string"
  && value.id.trim() !== ""
  && typeof value.name === "string"
  && value.name.trim() !== ""
  && isCategoryKind(value.kind)
  && isActivityColorToken(value.colorToken)
  && typeof value.icon === "string"
  && value.icon.trim() !== "";

export const categoriesForPreferences = (
  preferences: Pick<TimelinePreferences, "customCategories" | "removedCategoryIds">,
) => {
  const removed = new Set(preferences.removedCategoryIds);
  return [...categories, ...preferences.customCategories].filter((category) => !removed.has(category.id));
};

export const normalizeTimelinePreferences = (value: Partial<TimelinePreferences>): TimelinePreferences => {
  const startHour = isTime(value.startHour) ? value.startHour : defaultTimelinePreferences.startHour;
  const endHour = isTime(value.endHour) ? value.endHour : defaultTimelinePreferences.endHour;
  const startMinutes = Number(startHour.slice(0, 2)) * 60 + Number(startHour.slice(3));
  const endMinutes = Number(endHour.slice(0, 2)) * 60 + Number(endHour.slice(3));
  const validRange = startMinutes < endMinutes && endMinutes <= 24 * 60;
  const customCategories = Array.isArray(value.customCategories)
    ? value.customCategories.filter(isCategory).filter((category, index, values) =>
      !categories.some((builtIn) => builtIn.id === category.id)
      && values.findIndex((candidate) => candidate.id === category.id) === index)
    : defaultTimelinePreferences.customCategories;
  const categoryCatalog = [...categories, ...customCategories];
  const removedCategoryIds = Array.isArray(value.removedCategoryIds)
    ? [...new Set(value.removedCategoryIds.filter((id): id is string =>
      typeof id === "string" && categoryCatalog.some((category) => category.id === id)))]
    : defaultTimelinePreferences.removedCategoryIds;
  const activeCategoryIds = categoryCatalog
    .filter((category) => !removedCategoryIds.includes(category.id))
    .map((category) => category.id);
  const categoryIds = Array.isArray(value.categoryIds)
    ? [...new Set(value.categoryIds.filter((id): id is string => typeof id === "string" && activeCategoryIds.includes(id)))]
    : activeCategoryIds;
  const priorityOptions = Array.isArray(value.priorityOptions)
    ? [...new Set(value.priorityOptions.filter(isActivityPriority))]
    : defaultTimelinePreferences.priorityOptions;
  const normalizedPriorityOptions = priorityOptions.length > 0 ? priorityOptions : defaultTimelinePreferences.priorityOptions;
  const defaultPriority = normalizedPriorityOptions.includes("normal") ? "normal" : normalizedPriorityOptions[0];
  const storedCategorySettings = isRecord(value.categorySettings)
    ? value.categorySettings as Record<string, Partial<CategorySetting> | undefined>
    : {};
  const categorySettings = categoryCatalog.reduce<Record<string, CategorySetting>>((settings, category) => {
    const stored = storedCategorySettings[category.id];
    settings[category.id] = {
      colorToken: isActivityColorToken(stored?.colorToken) ? stored.colorToken : category.colorToken,
      priority: isActivityPriority(stored?.priority) && normalizedPriorityOptions.includes(stored.priority)
        ? stored.priority
        : defaultPriority,
    };
    return settings;
  }, {});
  const weeklyHolidayDays = Array.isArray(value.weeklyHolidayDays)
    ? [...new Set(value.weeklyHolidayDays.filter(isWeeklyHolidayDay))]
    : defaultTimelinePreferences.weeklyHolidayDays;
  const restDayOverrides = isRecord(value.restDayOverrides)
    ? Object.fromEntries(
      Object.entries(value.restDayOverrides).filter(([date, kind]) => isDateIso(date) && isRestDayKind(kind)),
    ) as Record<string, RestDayKind>
    : defaultTimelinePreferences.restDayOverrides;

  return {
    startHour: validRange ? startHour : defaultTimelinePreferences.startHour,
    endHour: validRange ? endHour : defaultTimelinePreferences.endHour,
    snapMinutes: isSnapMinutes(value.snapMinutes) ? value.snapMinutes : defaultTimelinePreferences.snapMinutes,
    timezone: isTimezone(value.timezone) ? value.timezone : defaultTimelinePreferences.timezone,
    categoryIds,
    customCategories,
    removedCategoryIds,
    priorityOptions: normalizedPriorityOptions,
    categorySettings,
    weeklyHolidayDays,
    restDayOverrides,
  };
};

const weekdayForIso = (iso: string): WeeklyHolidayDay =>
  new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))).getUTCDay() as WeeklyHolidayDay;

export const restDayStatusForDate = (iso: string, preferences: Pick<TimelinePreferences, "weeklyHolidayDays" | "restDayOverrides">): RestDayStatus | null =>
  preferences.restDayOverrides[iso] ?? (preferences.weeklyHolidayDays.includes(weekdayForIso(iso)) ? "weekly-holiday" : null);

export const restDayLabel = (status: RestDayStatus): string => {
  if (status === "public-holiday") return "Public holiday";
  if (status === "leave") return "Leave";
  return "Weekly holiday";
};

export const readTimelinePreferences = (): TimelinePreferences => {
  if (typeof window === "undefined") return defaultTimelinePreferences;
  try {
    const stored = window.localStorage.getItem(preferencesStorageKey);
    return stored ? normalizeTimelinePreferences(JSON.parse(stored) as Partial<TimelinePreferences>) : defaultTimelinePreferences;
  } catch {
    return defaultTimelinePreferences;
  }
};

export const saveTimelinePreferences = (preferences: TimelinePreferences) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(preferencesStorageKey, JSON.stringify(normalizeTimelinePreferences(preferences)));
  window.dispatchEvent(new Event("workflow-preferences-change"));
};

export const minutesForHour = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

export const hoursForRange = (startHour: string, endHour: string) => {
  const hours: string[] = [];
  for (let minutes = minutesForHour(startHour); minutes < minutesForHour(endHour); minutes += 60) {
    hours.push(`${Math.floor(minutes / 60).toString().padStart(2, "0")}:00`);
  }
  return hours;
};
