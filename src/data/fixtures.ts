import type { Activity, Category } from "@/domain/types";
import { timestampForWallTime } from "@/domain/time";

export const categories: Category[] = [
  { id: "deep-work", name: "Deep Work", kind: "focus", colorToken: "violet-600", icon: "focus" },
  { id: "design", name: "Design", kind: "focus", colorToken: "ngrey-600", icon: "design" },
  { id: "development", name: "Development", kind: "focus", colorToken: "red-600", icon: "development" },
  { id: "code-review", name: "Code Review", kind: "focus", colorToken: "orange-600", icon: "code-review" },
  { id: "meetings", name: "Meetings", kind: "meeting", colorToken: "yellow-600", icon: "meeting" },
  { id: "break", name: "Break", kind: "break", colorToken: "lime-600", icon: "break" },
  { id: "lunch", name: "Lunch", kind: "break", colorToken: "green-600", icon: "lunch" },
  { id: "research", name: "Research", kind: "focus", colorToken: "cyan-600", icon: "research" },
  { id: "planning", name: "Planning", kind: "focus", colorToken: "blue-600", icon: "planning" },
  { id: "testing", name: "Testing & QA", kind: "focus", colorToken: "indigo-600", icon: "testing" },
  { id: "bug-fixing", name: "Bug Fixing", kind: "focus", colorToken: "amber-600", icon: "bug-fixing" },
  { id: "stakeholders", name: "Stakeholders", kind: "meeting", colorToken: "pink-600", icon: "stakeholders" },
  { id: "product", name: "Product", kind: null, colorToken: "jade-600", icon: "product" },
  { id: "documentation", name: "Documentation", kind: null, colorToken: "cherry-600", icon: "documentation" },
  { id: "admin", name: "Admin", kind: null, colorToken: "grey-600", icon: "admin" },
];

const activity = (
  id: string,
  title: string,
  start: string,
  end: string | null,
  categoryId: string,
  tags: string[] = [],
): Activity => ({
  id,
  title,
  startAt: `2026-09-18T${start}:00+05:30`,
  endAt: end ? `2026-09-18T${end}:00+05:30` : null,
  categoryId,
  notes: "",
  tags,
});

export const demoActivities: Activity[] = [
  activity("activity-1", "Timeline interaction prototype", "08:45", "10:30", "deep-work", ["prototype"]),
  activity("activity-2", "Customer onboarding review", "10:45", "11:30", "meetings"),
  activity("activity-3", "Product discovery session", "12:15", "13:30", "product", ["research"]),
  activity("activity-4", "Focused coding session", "14:00", "15:45", "deep-work", ["build"]),
  activity("activity-5", "Documentation", "16:15", "17:00", "admin"),
  activity("activity-6", "Release planning", "11:17", null, "product", ["planning"]),
];

const minutesFromTimestamp = (timestamp: string) => {
  const [hour, minute] = timestamp.slice(11, 16).split(":").map(Number);
  return hour * 60 + minute;
};

export const demoActivitiesForDate = (date: string, timezone: string): Activity[] =>
  demoActivities.map((demo) => ({
    ...demo,
    id: `sample-${demo.id}`,
    startAt: timestampForWallTime(date, minutesFromTimestamp(demo.startAt), timezone),
    endAt: timestampForWallTime(
      date,
      demo.endAt ? minutesFromTimestamp(demo.endAt) : 12 * 60,
      timezone,
    ),
    isSample: true,
  }));
