import type { Activity } from "./types";

export type TimelineInterval = {
  activity: Activity;
  startMinutes: number;
  endMinutes: number;
  lane: number;
};

export type TimelineGap = {
  startMinutes: number;
  endMinutes: number;
};

export type TimelineLayout = {
  intervals: TimelineInterval[];
  gaps: TimelineGap[];
  laneCount: number;
  hiddenCount: number;
};

type LayoutActivity = {
  activity: Activity;
  startMinutes: number;
  endMinutes: number;
};

export const timelineLayoutConstants = {
  gapThresholdMinutes: 15,
  maxDesktopLanes: 6,
  activityHeight: 48,
  activityTop: 35,
  laneGap: 8,
  rowPadding: 35,
  minimumRowHeight: 100,
} as const;

const addGap = (gaps: TimelineGap[], startMinutes: number, endMinutes: number) => {
  if (endMinutes - startMinutes >= timelineLayoutConstants.gapThresholdMinutes) {
    gaps.push({ startMinutes, endMinutes });
  }
};

export const buildTimelineLayout = (
  activities: Activity[],
  getRange: (activity: Activity) => { startMinutes: number; endMinutes: number },
  visibleStartMinutes: number,
  cutoffMinutes: number | null,
  maxLanes: number = timelineLayoutConstants.maxDesktopLanes,
): TimelineLayout => {
  const sorted = activities
    .map((activity): LayoutActivity => {
      const range = getRange(activity);
      return {
        activity,
        startMinutes: Math.max(0, range.startMinutes),
        endMinutes: Math.max(range.endMinutes, range.startMinutes),
      };
    })
    .sort((left, right) =>
      left.startMinutes - right.startMinutes
      || left.endMinutes - right.endMinutes
      || left.activity.id.localeCompare(right.activity.id));

  const laneEnds: number[] = [];
  const intervals = sorted.map((item): TimelineInterval => {
    let lane = laneEnds.findIndex((endMinutes) => item.startMinutes >= endMinutes);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMinutes);
    } else {
      laneEnds[lane] = item.endMinutes;
    }
    return { ...item, lane };
  });

  const visibleLaneCount = Math.min(
    Math.max(laneEnds.length, intervals.length ? 1 : 0),
    maxLanes,
  );
  const visibleIntervals = intervals.filter(
    (interval) => interval.lane < maxLanes,
  );

  const gaps: TimelineGap[] = [];
  if (sorted.length > 0 && cutoffMinutes !== null) {
    const visibleEnd = Math.max(visibleStartMinutes, cutoffMinutes);
    let cursor = visibleStartMinutes;
    sorted.forEach((item) => {
      const start = Math.max(visibleStartMinutes, Math.min(item.startMinutes, visibleEnd));
      const end = Math.max(start, Math.min(item.endMinutes, visibleEnd));
      if (start > cursor) addGap(gaps, cursor, start);
      cursor = Math.max(cursor, end);
    });
    if (cursor < visibleEnd) addGap(gaps, cursor, visibleEnd);
  }

  return {
    intervals: visibleIntervals,
    gaps,
    laneCount: visibleLaneCount,
    hiddenCount: Math.max(0, intervals.length - visibleIntervals.length),
  };
};
