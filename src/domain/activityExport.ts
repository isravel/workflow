import { activityColorOptions } from "@/domain/activityColors";
import { weeklyHolidayOptions, type TimelinePreferences } from "@/domain/preferences";
import type { Activity, Category, Task } from "@/domain/types";
import { addDays, addMonths, dateFromTimestamp, formatTime } from "@/domain/time";

export const activityExportRanges = [
  { value: "all", label: "All dates" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this-week", label: "This week" },
  { value: "last-week", label: "Last week" },
  { value: "last-7-days", label: "Last 7 days" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "last-30-days", label: "Last 30 days" },
  { value: "custom", label: "Custom dates" },
] as const;

export type ActivityExportRange = (typeof activityExportRanges)[number]["value"];

export type ActivityDateRange = {
  from: string | null;
  to: string | null;
};

export type ActivityExportRow = {
  date: string;
  start: string;
  end: string;
  durationMinutes: number;
  title: string;
  category: string;
  priority: string;
  task: string;
  tags: string;
  notes: string;
};

export type ActivityExportSettingRow = {
  section: string;
  option: string;
  value: string;
};

const formatPriority = (priority: string) => priority
  .replace(/[-_]/g, " ")
  .replace(/\b\w/g, (character) => character.toUpperCase());

export const buildActivityExportSettings = (
  preferences: TimelinePreferences,
  configuredCategories: Category[],
  theme: "light" | "dark",
  showRestDays: boolean,
  viewMode: "timeline" | "kanban" | "table",
): ActivityExportSettingRow[] => {
  const rows: ActivityExportSettingRow[] = [
    { section: "Timeline", option: "Visible hours", value: `${preferences.startHour} to ${preferences.endHour}` },
    { section: "Timeline", option: "Snap interval", value: `${preferences.snapMinutes} minutes` },
    { section: "Timeline", option: "Timezone", value: preferences.timezone },
    { section: "Rest days", option: "Display", value: showRestDays ? "Shown" : "Hidden" },
    {
      section: "Rest days",
      option: "Weekly holidays",
      value: preferences.weeklyHolidayDays.length
        ? weeklyHolidayOptions.filter((day) => preferences.weeklyHolidayDays.includes(day.value)).map((day) => day.label).join(", ")
        : "None",
    },
    { section: "Priorities", option: "Available options", value: preferences.priorityOptions.map(formatPriority).join(", ") },
    { section: "Appearance", option: "Theme", value: formatPriority(theme) },
    {
      section: "Appearance",
      option: "Activity view",
      value: viewMode === "kanban" ? "Kanban" : viewMode === "table" ? "Table" : "Timeline",
    },
  ];

  const colorNameByToken = new Map(activityColorOptions.map((color) => [color.token, color.label]));
  const removedCategoryIds = new Set(preferences.removedCategoryIds);
  for (const category of configuredCategories) {
    const setting = preferences.categorySettings[category.id] ?? {
      colorToken: category.colorToken,
      priority: preferences.priorityOptions[0] ?? "normal",
    };
    const visibility = removedCategoryIds.has(category.id)
      ? "Removed"
      : preferences.categoryIds.includes(category.id) ? "Visible" : "Hidden";
    const section = `Category: ${category.name}`;
    rows.push(
      { section, option: "Status", value: visibility },
      { section, option: "Color", value: colorNameByToken.get(setting.colorToken) ?? setting.colorToken },
      { section, option: "Default priority", value: formatPriority(setting.priority) },
    );
  }

  const restDayOverrides = Object.entries(preferences.restDayOverrides).sort(([left], [right]) => left.localeCompare(right));
  if (restDayOverrides.length === 0) {
    rows.push({ section: "Rest days", option: "Date overrides", value: "None" });
  } else {
    for (const [date, kind] of restDayOverrides) {
      rows.push({ section: "Rest days", option: `Date override · ${date}`, value: kind === "public-holiday" ? "Public holiday" : "Leave" });
    }
  }

  return rows;
};

export const resolveActivityDateRange = (
  preset: ActivityExportRange,
  today: string,
  timezone: string,
  customFrom: string,
  customTo: string,
): ActivityDateRange | null => {
  const currentMonthStart = `${today.slice(0, 7)}-01`;
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const currentWeekStart = addDays(today, -((weekday + 6) % 7), timezone);

  switch (preset) {
    case "all":
      return { from: null, to: null };
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const yesterday = addDays(today, -1, timezone);
      return { from: yesterday, to: yesterday };
    }
    case "this-week":
      return { from: currentWeekStart, to: today };
    case "last-week": {
      const lastWeekStart = addDays(currentWeekStart, -7, timezone);
      return { from: lastWeekStart, to: addDays(lastWeekStart, 6, timezone) };
    }
    case "last-7-days":
      return { from: addDays(today, -6, timezone), to: today };
    case "this-month":
      return { from: currentMonthStart, to: today };
    case "last-month": {
      const lastMonthStart = addMonths(currentMonthStart, -1);
      return { from: lastMonthStart, to: addDays(currentMonthStart, -1, timezone) };
    }
    case "last-30-days":
      return { from: addDays(today, -29, timezone), to: today };
    case "custom":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(customFrom)
        || !/^\d{4}-\d{2}-\d{2}$/.test(customTo)
        || customFrom > customTo) return null;
      return { from: customFrom, to: customTo };
  }
};

export const activityMatchesDateRange = (
  activity: Activity,
  range: ActivityDateRange,
  timezone: string,
) => {
  const date = dateFromTimestamp(activity.startAt, timezone);
  return (!range.from || date >= range.from) && (!range.to || date <= range.to);
};

export const buildActivityExportRows = (
  activities: Activity[],
  categories: Category[],
  tasks: Task[],
  timezone: string,
  clock: number,
): ActivityExportRow[] => {
  const categoryById = new Map(categories.map((category) => [category.id, category.name]));
  const taskById = new Map(tasks.map((task) => [task.id, task.title]));

  return [...activities]
    .sort((left, right) => left.startAt.localeCompare(right.startAt))
    .map((activity) => {
      const endAt = activity.endAt ?? new Date(clock).toISOString();
      const durationMinutes = Math.max(0, Math.round((Date.parse(endAt) - Date.parse(activity.startAt)) / 60_000));
      return {
        date: dateFromTimestamp(activity.startAt, timezone),
        start: formatTime(activity.startAt, timezone),
        end: activity.endAt ? formatTime(activity.endAt, timezone) : "In progress",
        durationMinutes,
        title: activity.title,
        category: categoryById.get(activity.categoryId) ?? activity.categoryId,
        priority: (activity.priority ?? "").replace(/[-_]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()),
        task: activity.taskId ? taskById.get(activity.taskId) ?? "" : "",
        tags: activity.tags.join(", "),
        notes: activity.notes,
      };
    });
};

const exportColumns: Array<{ key: keyof ActivityExportRow; label: string }> = [
  { key: "date", label: "Date" },
  { key: "start", label: "Start" },
  { key: "end", label: "End" },
  { key: "durationMinutes", label: "Duration (minutes)" },
  { key: "title", label: "Activity" },
  { key: "category", label: "Category" },
  { key: "priority", label: "Priority" },
  { key: "task", label: "Task" },
  { key: "tags", label: "Tags" },
  { key: "notes", label: "Notes" },
];

const csvCell = (value: string | number) => {
  const text = String(value);
  const safeText = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
};

export const createActivityCsv = (rows: ActivityExportRow[], settings: ActivityExportSettingRow[] = []) => {
  const heading = exportColumns.map(({ label }) => csvCell(label)).join(",");
  const body = rows.map((row) => exportColumns.map(({ key }) => csvCell(row[key])).join(","));
  const settingsSection = settings.length ? [
    "",
    csvCell("Journal settings"),
    [csvCell("Section"), csvCell("Option"), csvCell("Value")].join(","),
    ...settings.map((row) => [row.section, row.option, row.value].map(csvCell).join(",")),
  ] : [];
  return `\uFEFF${[heading, ...body, ...settingsSection].join("\r\n")}`;
};

const xmlEscape = (value: string | number) => String(value)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

export const createActivityXls = (rows: ActivityExportRow[], settings: ActivityExportSettingRow[] = []) => {
  const headerRow = `<Row ss:StyleID="Header">${exportColumns.map(({ label }) => `<Cell><Data ss:Type="String">${xmlEscape(label)}</Data></Cell>`).join("")}</Row>`;
  const activityRows = rows.map((row) => `<Row>${exportColumns.map(({ key }) => {
    const value = row[key];
    const type = key === "durationMinutes" ? "Number" : "String";
    return `<Cell><Data ss:Type="${type}">${xmlEscape(value)}</Data></Cell>`;
  }).join("")}</Row>`).join("");
  const settingsHeader = `<Row ss:StyleID="Header"><Cell><Data ss:Type="String">Section</Data></Cell><Cell><Data ss:Type="String">Option</Data></Cell><Cell><Data ss:Type="String">Value</Data></Cell></Row>`;
  const settingsRows = settings.map((row) => `<Row>${[row.section, row.option, row.value].map((value) => `<Cell><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`).join("")}</Row>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#EEE9FA" ss:Pattern="Solid"/></Style></Styles>
  <Worksheet ss:Name="Activities"><Table>${headerRow}${activityRows}</Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions>
  </Worksheet>
  <Worksheet ss:Name="Settings"><Table>${settingsHeader}${settingsRows}</Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions>
  </Worksheet>
</Workbook>`;
};

const htmlEscape = (value: string | number) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const formatTotalDuration = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

export const createActivityPrintDocument = (
  rows: ActivityExportRow[],
  rangeLabel: string,
  timezone: string,
  settings: ActivityExportSettingRow[] = [],
) => {
  const totalMinutes = rows.reduce((sum, row) => sum + row.durationMinutes, 0);
  const header = exportColumns.map(({ label }) => `<th>${htmlEscape(label)}</th>`).join("");
  const body = rows.map((row) => `<tr>${exportColumns.map(({ key }) => `<td>${htmlEscape(row[key])}</td>`).join("")}</tr>`).join("");
  const settingsBody = settings.map((row) => `<tr><td>${htmlEscape(row.section)}</td><td>${htmlEscape(row.option)}</td><td>${htmlEscape(row.value)}</td></tr>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WorkFlow Journal activity report</title>
<style>
@page { size: A4 landscape; margin: 12mm; }
* { box-sizing: border-box; }
body { color: #24212d; font-family: Arial, sans-serif; font-size: 10px; margin: 0; }
h1 { font-size: 21px; margin: 0 0 5px; }
.meta { color: #625d6d; margin: 0 0 14px; }
.summary { display: flex; gap: 28px; margin: 0 0 14px; }
.summary strong { display: block; font-size: 13px; margin-top: 3px; }
table { border-collapse: collapse; table-layout: fixed; width: 100%; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th, td { border: 1px solid #dedbe4; overflow-wrap: anywhere; padding: 5px; text-align: left; vertical-align: top; }
th { background: #eee9fa; font-size: 9px; }
td:nth-child(4) { text-align: right; }
.settings { break-before: page; page-break-before: always; }
.settings h2 { font-size: 16px; margin: 0 0 10px; }
.settings table { table-layout: auto; }
.settings td:first-child { width: 27%; }
@media screen { body { margin: 24px auto; max-width: 1200px; padding: 0 20px; } }
</style></head><body>
<h1>WorkFlow Journal</h1><p class="meta">Activity report · ${htmlEscape(rangeLabel)} · ${htmlEscape(timezone)}</p>
<div class="summary"><div>Activities<strong>${rows.length}</strong></div><div>Tracked time<strong>${htmlEscape(formatTotalDuration(totalMinutes))}</strong></div></div>
<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>
<section class="settings"><h2>Journal settings</h2><table><thead><tr><th>Section</th><th>Option</th><th>Value</th></tr></thead><tbody>${settingsBody}</tbody></table></section>
</body></html>`;
};
