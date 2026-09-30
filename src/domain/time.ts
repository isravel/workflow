export const testClockStorageKey = "workflow.testClock";
export const defaultClockTimestamp = Date.parse("2026-09-18T12:00:00+05:30");

export const runtimeClock = () => {
  if (typeof window === "undefined") return defaultClockTimestamp;
  const testClock = Number(window.localStorage.getItem(testClockStorageKey));
  return Number.isFinite(testClock) && testClock > 0 ? testClock : Date.now();
};

const partsFor = (value: string | number, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).formatToParts(new Date(value));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
};

const offsetMinutesAt = (value: number, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(value));
  const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  if (offset === "GMT") return 0;
  const match = offset.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "+" ? minutes : -minutes;
};

export const timestampForWallTime = (dateIso: string, minutes: number, timezone: string) => {
  const hour = Math.floor(minutes / 60).toString().padStart(2, "0");
  const minute = (minutes % 60).toString().padStart(2, "0");
  const wallTime = Date.UTC(
    Number(dateIso.slice(0, 4)),
    Number(dateIso.slice(5, 7)) - 1,
    Number(dateIso.slice(8, 10)),
    Number(hour),
    Number(minute),
  );
  let timestamp = wallTime - offsetMinutesAt(wallTime, timezone) * 60_000;
  timestamp = wallTime - offsetMinutesAt(timestamp, timezone) * 60_000;
  return new Date(timestamp).toISOString();
};

export const dateFromTimestamp = (value: string, timezone: string) => {
  const parts = partsFor(value, timezone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
};

export const minutesFromTimestamp = (value: string, timezone: string) => {
  const parts = partsFor(value, timezone);
  return parts.hour * 60 + parts.minute;
};

export const minutesFromClock = (clock: number, timezone: string) => {
  const parts = partsFor(clock, timezone);
  return parts.hour * 60 + parts.minute;
};

export const formatTime = (value: string, timezone: string) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));

export const formatDateLabel = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: timezone,
  }).format(new Date(timestampForWallTime(iso, 12 * 60, timezone)));

export const formatMonthLabel = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(timestampForWallTime(iso, 12 * 60, timezone)));

export const formatDayName = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: timezone,
  }).format(new Date(timestampForWallTime(iso, 12 * 60, timezone)));

export const startOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`;

export const daysInMonth = (iso: string) => {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

export const addMonths = (iso: string, amount: number) => {
  const date = new Date(Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1 + amount,
    1,
  ));
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1).toString().padStart(2, "0")}-01`;
};

export const addDays = (iso: string, amount: number, timezone: string) => {
  const date = new Date(timestampForWallTime(iso, 12 * 60, timezone));
  date.setUTCDate(date.getUTCDate() + amount);
  return dateFromTimestamp(date.toISOString(), timezone);
};
