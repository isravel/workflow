import { describe, expect, it } from "vitest";
import { categories } from "@/data/fixtures";
import { durationMinutesFromInput } from "@/domain/parsing";
import { layoutModeForWidth, timelineLaneCapForMode } from "@/domain/layoutMode";
import { buildTimelineLayout } from "@/domain/timelineLayout";
import {
  categoriesForPreferences,
  defaultTimelinePreferences,
  normalizeTimelinePreferences,
  restDayStatusForDate,
} from "@/domain/preferences";
import {
  addDays,
  addMonths,
  dateFromTimestamp,
  daysInMonth,
  formatMonthLabel,
  minutesFromTimestamp,
  timestampForWallTime,
} from "@/domain/time";
import type { Activity } from "@/domain/types";

const activity = (id: string, startAt: string, endAt: string | null = null): Activity => ({
  id,
  title: id,
  startAt,
  endAt,
  categoryId: "deep-work",
  notes: "",
  tags: [],
});

describe("activity categories", () => {
  it("includes break and lunch categories with distinct palette colors", () => {
    expect(categories.map((category) => category.name)).toEqual(expect.arrayContaining(["Break", "Lunch"]));
    expect(new Set(categories.map((category) => category.colorToken)).size).toBe(categories.length);
  });

  it("normalizes managed categories and custom priorities", () => {
    const customCategory = {
      id: "custom-client-work",
      name: "Client work",
      kind: null,
      colorToken: "red-600" as const,
      icon: "FileText",
    };
    const preferences = normalizeTimelinePreferences({
      ...defaultTimelinePreferences,
      customCategories: [customCategory],
      removedCategoryIds: ["deep-work"],
      categoryIds: ["custom-client-work"],
      priorityOptions: ["normal", "urgent", "urgent"],
      categorySettings: {
        ...defaultTimelinePreferences.categorySettings,
        [customCategory.id]: { colorToken: customCategory.colorToken, priority: "urgent" },
      },
    });

    expect(categoriesForPreferences(preferences).map((category) => category.id)).toContain("custom-client-work");
    expect(categoriesForPreferences(preferences).map((category) => category.id)).not.toContain("deep-work");
    expect(preferences.priorityOptions).toEqual(["normal", "urgent"]);
    expect(preferences.categorySettings[customCategory.id].priority).toBe("urgent");
  });

  it("normalizes weekly holidays and one-off rest day markers", () => {
    const preferences = normalizeTimelinePreferences({
      ...defaultTimelinePreferences,
      weeklyHolidayDays: [0, 6, 6, 9] as unknown as Array<0 | 1 | 2 | 3 | 4 | 5 | 6>,
      restDayOverrides: {
        "2026-09-18": "leave",
        "2026-09-19": "public-holiday",
        invalid: "leave",
      },
    });

    expect(preferences.weeklyHolidayDays).toEqual([0, 6]);
    expect(restDayStatusForDate("2026-09-19", preferences)).toBe("public-holiday");
    expect(restDayStatusForDate("2026-09-20", preferences)).toBe("weekly-holiday");
    expect(restDayStatusForDate("2026-09-18", preferences)).toBe("leave");
  });
});

describe("duration parsing", () => {
  it.each([
    ["45m", 45],
    ["1h", 60],
    ["1h30", 90],
    ["2h 15m", 135],
  ])("parses %s", (input, expected) => {
    expect(durationMinutesFromInput(input)).toBe(expected);
  });

  it.each(["", "0m", "1x", "h30"])("rejects %s", (input) => {
    expect(durationMinutesFromInput(input)).toBeNull();
  });
});

describe("timezone conversion", () => {
  it("converts a UTC timestamp to the configured local date and minutes", () => {
    const timestamp = "2026-09-18T18:30:00.000Z";
    expect(dateFromTimestamp(timestamp, "Asia/Kolkata")).toBe("2026-09-19");
    expect(minutesFromTimestamp(timestamp, "Asia/Kolkata")).toBe(0);
  });

  it("handles daylight-saving offsets when creating wall-clock timestamps", () => {
    expect(timestampForWallTime("2026-01-15", 9 * 60, "America/New_York")).toBe("2026-01-15T14:00:00.000Z");
    expect(timestampForWallTime("2026-07-15", 9 * 60, "America/New_York")).toBe("2026-07-15T13:00:00.000Z");
  });

  it("advances a local date across a daylight-saving boundary", () => {
    expect(addDays("2026-03-08", 1, "America/New_York")).toBe("2026-03-09");
  });

  it("navigates month boundaries and counts local calendar days", () => {
    expect(addMonths("2026-01-18", -1)).toBe("2025-12-01");
    expect(addMonths("2026-12-18", 1)).toBe("2027-01-01");
    expect(daysInMonth("2026-02-18")).toBe(28);
    expect(daysInMonth("2028-02-18")).toBe(29);
    expect(formatMonthLabel("2026-09-18", "Asia/Kolkata")).toBe("September 2026");
  });
});

describe("timeline layout", () => {
  const getRange = (item: Activity) => {
    const start = Number(item.startAt);
    const end = Number(item.endAt);
    return { startMinutes: start, endMinutes: end };
  };

  it("allocates overlapping activities to separate lanes and derives gaps", () => {
    const layout = buildTimelineLayout(
      [
        activity("first", "0", "60"),
        activity("overlap", "30", "90"),
      ],
      getRange,
      0,
      120,
    );
    expect(layout.intervals.map((item) => item.lane)).toEqual([0, 1]);
    expect(layout.gaps).toEqual([{ startMinutes: 90, endMinutes: 120 }]);
  });

  it("hides activities beyond the desktop lane cap without remapping them", () => {
    const activities = Array.from({ length: 7 }, (_, index) => activity(`activity-${index}`, "0", "60"));
    const layout = buildTimelineLayout(activities, getRange, 0, null);
    expect(layout.intervals).toHaveLength(6);
    expect(layout.hiddenCount).toBe(1);
    expect(layout.intervals.map((item) => item.lane)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it.each([
    [719, "mobile", 3],
    [720, "tablet", 4],
    [1099, "tablet", 4],
    [1100, "desktop", 6],
  ] as const)("resolves responsive lane caps at %s pixels", (width, mode, cap) => {
    expect(layoutModeForWidth(width)).toBe(mode);
    expect(timelineLaneCapForMode[mode]).toBe(cap);
  });

  it("keeps non-overlapping short activities in the same lane", () => {
    const layout = buildTimelineLayout(
      [
        activity("earlier", "285", "300"),
        activity("new-running", "343", "390"),
      ],
      getRange,
      0,
      480,
    );
    expect(layout.intervals.map((item) => item.lane)).toEqual([0, 0]);
  });
});
