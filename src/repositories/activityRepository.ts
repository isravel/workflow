import type { Activity, ActivityPriority, Task, TaskStatus } from "@/domain/types";
import { isActivityColorToken } from "@/domain/activityColors";
import { demoActivities, demoActivitiesForDate } from "@/data/fixtures";
import { readTimelinePreferences } from "@/domain/preferences";
import { dateFromTimestamp, runtimeClock } from "@/domain/time";

const databaseName = "workflow-journal";
const activityStoreName = "activities";
const activityStorageKey = "workflow.activities";
const legacyActivityStorageVersion = 1;
const journalStorageVersion = 2;
const backupFormat = "workflow-journal";
const legacyBackupFormat = "workflow-journal-activities";
const backupVersion = 2;
const legacyBackupVersion = 1;
const taskStatuses: TaskStatus[] = ["open", "in-progress", "on-hold", "fixed", "closed", "reopened"];
const sampleDataStates: SampleDataState[] = ["pending", "shown", "cleared"];
const activityApiUrl = () => process.env.NEXT_PUBLIC_ACTIVITY_API_URL?.trim().replace(/\/+$/, "") || null;
const activityApiToken = () => process.env.NEXT_PUBLIC_ACTIVITY_API_TOKEN?.trim() || null;

export type SampleDataState = "pending" | "shown" | "cleared";

export type JournalData = {
  activities: Activity[];
  tasks: Task[];
  sampleDataState?: SampleDataState;
};

export type JournalBackup = {
  format: typeof backupFormat;
  version: typeof backupVersion;
  exportedAt: string;
  activities: Activity[];
  tasks: Task[];
  sampleDataState: SampleDataState;
};

export type ActivityBackup = {
  format: typeof legacyBackupFormat;
  version: typeof legacyBackupVersion;
  exportedAt: string;
  activities: Activity[];
};

export type ActivitySaveResult = {
  saved: boolean;
  storage: "local" | "remote";
  remoteError?: unknown;
  error?: unknown;
};

type StoredJournal = JournalData & {
  version: typeof journalStorageVersion;
};

const storageError = (message: string) => new Error(message);
const legacyDemoActivitiesById = new Map(demoActivities.map((activity) => [activity.id, activity]));

const readLegacyIndexedDbActivities = (): Promise<Activity[] | null> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }

    const request = indexedDB.open(databaseName);
    request.onupgradeneeded = () => {
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(activityStoreName)) {
        database.close();
        resolve(null);
        return;
      }

      const read = database.transaction(activityStoreName, "readonly").objectStore(activityStoreName).getAll();
      read.onsuccess = () => {
        database.close();
        resolve(read.result as Activity[]);
      };
      read.onerror = () => {
        database.close();
        reject(read.error ?? storageError("Could not read legacy activity storage."));
      };
    };
    request.onblocked = () => resolve(null);
    request.onerror = () => resolve(null);
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isValidTimestamp = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const isValidDate = (value: unknown) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const isUnchangedLegacyDemo = (activity: Activity) => {
  const demo = legacyDemoActivitiesById.get(activity.id);
  return Boolean(demo
    && activity.title === demo.title
    && activity.startAt === demo.startAt
    && activity.endAt === demo.endAt
    && activity.categoryId === demo.categoryId
    && activity.notes === demo.notes
    && JSON.stringify(activity.tags) === JSON.stringify(demo.tags)
    && activity.colorToken === undefined
    && activity.priority === undefined
    && activity.taskId === undefined
    && activity.createdAt === undefined
    && activity.updatedAt === undefined);
};

const validateActivity = (value: unknown, index: number): Activity => {
  if (!isRecord(value)) throw storageError(`Backup activity ${index + 1} is not an object.`);
  if (typeof value.id !== "string" || value.id.trim() === "") throw storageError(`Backup activity ${index + 1} has an invalid id.`);
  if (typeof value.title !== "string" || value.title.trim() === "") throw storageError(`Backup activity ${index + 1} has an invalid title.`);
  if (!isValidTimestamp(value.startAt)) throw storageError(`Backup activity ${index + 1} has an invalid start time.`);
  if (value.endAt !== null && !isValidTimestamp(value.endAt)) throw storageError(`Backup activity ${index + 1} has an invalid end time.`);
  if (value.endAt !== null && Date.parse(value.endAt as string) < Date.parse(value.startAt as string)) {
    throw storageError(`Backup activity ${index + 1} ends before it starts.`);
  }
  if (typeof value.categoryId !== "string" || value.categoryId.trim() === "") throw storageError(`Backup activity ${index + 1} has an invalid category.`);
  if (value.colorToken !== undefined && !isActivityColorToken(value.colorToken)) throw storageError(`Backup activity ${index + 1} has an invalid color.`);
  if (value.isSample !== undefined && typeof value.isSample !== "boolean") throw storageError(`Backup activity ${index + 1} has an invalid sample marker.`);
  if (typeof value.notes !== "string") throw storageError(`Backup activity ${index + 1} has invalid notes.`);
  if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string")) throw storageError(`Backup activity ${index + 1} has invalid tags.`);
  if (value.priority !== undefined && (typeof value.priority !== "string" || value.priority.trim() === "")) {
    throw storageError(`Backup activity ${index + 1} has an invalid priority.`);
  }
  if (value.taskId !== undefined && (typeof value.taskId !== "string" || value.taskId.trim() === "")) {
    throw storageError(`Backup activity ${index + 1} has an invalid task link.`);
  }
  if (value.createdAt !== undefined && !isValidTimestamp(value.createdAt)) throw storageError(`Backup activity ${index + 1} has an invalid created time.`);
  if (value.updatedAt !== undefined && !isValidTimestamp(value.updatedAt)) throw storageError(`Backup activity ${index + 1} has an invalid updated time.`);
  const legacyDemo = value.isSample === undefined && isUnchangedLegacyDemo(value as Activity);
  const sampleMarker = value.isSample === undefined ? legacyDemo ? true : undefined : value.isSample as boolean;

  return {
    id: value.id as string,
    title: value.title as string,
    startAt: value.startAt as string,
    endAt: legacyDemo && value.endAt === null
      ? new Date(Date.parse(value.startAt as string) + 43 * 60_000).toISOString()
      : value.endAt as string | null,
    categoryId: value.categoryId as string,
    ...(value.colorToken === undefined ? {} : { colorToken: value.colorToken }),
    notes: value.notes as string,
    tags: [...(value.tags as string[])],
    ...(value.priority === undefined ? {} : { priority: value.priority as ActivityPriority }),
    ...(value.taskId === undefined ? {} : { taskId: value.taskId as string }),
    ...(value.createdAt === undefined ? {} : { createdAt: value.createdAt as string }),
    ...(value.updatedAt === undefined ? {} : { updatedAt: value.updatedAt as string }),
    ...(sampleMarker === undefined ? {} : { isSample: sampleMarker }),
  };
};

const validateActivities = (values: unknown): Activity[] => {
  if (!Array.isArray(values)) throw storageError("Stored activity history is invalid.");
  const activities = values.map(validateActivity);
  const ids = new Set<string>();
  activities.forEach((activity) => {
    if (ids.has(activity.id)) throw storageError(`Stored activity history contains duplicate activity id "${activity.id}".`);
    ids.add(activity.id);
  });
  return activities;
};

const validateTask = (value: unknown, index: number): Task => {
  if (!isRecord(value)) throw storageError(`Task ${index + 1} is not an object.`);
  if (typeof value.id !== "string" || value.id.trim() === "") throw storageError(`Task ${index + 1} has an invalid id.`);
  if (typeof value.title !== "string" || value.title.trim() === "") throw storageError(`Task ${index + 1} has an invalid title.`);
  if (typeof value.description !== "string") throw storageError(`Task ${index + 1} has invalid description.`);
  if (value.dueDate !== null && !isValidDate(value.dueDate)) throw storageError(`Task ${index + 1} has an invalid due date.`);
  if (!taskStatuses.includes(value.status as TaskStatus)) throw storageError(`Task ${index + 1} has an invalid status.`);
  if (!isValidTimestamp(value.createdAt) || !isValidTimestamp(value.updatedAt)) throw storageError(`Task ${index + 1} has invalid timestamps.`);
  return {
    id: value.id as string,
    title: value.title as string,
    description: value.description as string,
    dueDate: value.dueDate as string | null,
    status: value.status as TaskStatus,
    createdAt: value.createdAt as string,
    updatedAt: value.updatedAt as string,
  };
};

const validateTasks = (values: unknown): Task[] => {
  if (!Array.isArray(values)) throw storageError("Stored task list is invalid.");
  const tasks = values.map(validateTask);
  const ids = new Set<string>();
  tasks.forEach((task) => {
    if (ids.has(task.id)) throw storageError(`Stored task list contains duplicate task id "${task.id}".`);
    ids.add(task.id);
  });
  return tasks;
};

const normalizeSampleDataState = (
  value: unknown,
  activities: Activity[],
  tasks: Task[],
): SampleDataState => activities.length > 0 || tasks.length > 0
  ? value === "cleared" ? "cleared" : "shown"
  : sampleDataStates.includes(value as SampleDataState) ? value as SampleDataState : "pending";

const validateJournal = (activityValues: unknown, taskValues: unknown = [], sampleState?: unknown): JournalData => {
  const tasks = validateTasks(taskValues);
  const taskIds = new Set(tasks.map((task) => task.id));
  const activities = validateActivities(activityValues).map((activity) => {
    if (!activity.taskId || taskIds.has(activity.taskId)) return activity;
    const withoutTask = { ...activity };
    delete withoutTask.taskId;
    return withoutTask;
  });
  return { activities, tasks, sampleDataState: normalizeSampleDataState(sampleState, activities, tasks) };
};

const hasJournalData = (journal: JournalData | null): journal is JournalData =>
  Boolean(journal && (
    journal.activities.length > 0
    || journal.tasks.length > 0
    || journal.sampleDataState !== "pending"
  ));

const readStoredJournal = (contents: string): JournalData => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw storageError("Stored activity history is not valid JSON.");
  }

  if (!isRecord(parsed)) throw storageError("Stored activity history has an incompatible version.");
  const sampleState = parsed.sampleDataState ?? (
    Array.isArray(parsed.activities)
    && parsed.activities.length === 0
    && (parsed.version === legacyActivityStorageVersion || (Array.isArray(parsed.tasks) && parsed.tasks.length === 0))
      ? "cleared"
      : undefined
  );
  if (parsed.version === legacyActivityStorageVersion) return validateJournal(parsed.activities, [], sampleState);
  if (parsed.version !== journalStorageVersion) throw storageError("Stored activity history has an incompatible version.");
  return validateJournal(parsed.activities, parsed.tasks, sampleState);
};

const writeStoredJournal = (journal: JournalData) => {
  if (typeof window === "undefined") throw storageError("Browser storage is unavailable.");
  const stored: StoredJournal = {
    version: journalStorageVersion,
    activities: journal.activities,
    tasks: journal.tasks,
    sampleDataState: normalizeSampleDataState(journal.sampleDataState, journal.activities, journal.tasks),
  };
  window.localStorage.setItem(activityStorageKey, JSON.stringify(stored));
};

const readBrowserJournal = async (): Promise<JournalData | null> => {
  if (typeof window === "undefined") throw storageError("Browser storage is unavailable.");

  const stored = window.localStorage.getItem(activityStorageKey);
  if (stored !== null) {
    const journal = readStoredJournal(stored);
    if (hasJournalData(journal)) writeStoredJournal(journal);
    return hasJournalData(journal) ? journal : null;
  }

  const legacyActivities = await readLegacyIndexedDbActivities();
  if (!legacyActivities || legacyActivities.length === 0) return null;
  const journal = validateJournal(legacyActivities, []);
  writeStoredJournal(journal);
  return journal;
};

const apiHeaders = () => {
  const token = activityApiToken();
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
};

const remoteResponseMessage = async (response: Response) => {
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && typeof payload.error === "string") return payload.error;
  } catch {
    // Use the HTTP status when the data service does not return JSON.
  }
  return `HTTP ${response.status}`;
};

const readRemoteJournal = async (): Promise<JournalData> => {
  const baseUrl = activityApiUrl();
  if (!baseUrl) throw storageError("Activity data service is not configured.");

  const response = await fetch(`${baseUrl}/activities`, { headers: apiHeaders(), cache: "no-store" });
  if (!response.ok) throw storageError(`Activity data service returned ${await remoteResponseMessage(response)}.`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw storageError("Activity data service returned invalid JSON.");
  }
  if (!isRecord(payload) || (payload.version !== legacyActivityStorageVersion && payload.version !== journalStorageVersion)) {
    throw storageError("Activity data service returned an incompatible version.");
  }
  return validateJournal(
    payload.activities,
    payload.version === journalStorageVersion ? payload.tasks : [],
    payload.sampleDataState,
  );
};

const writeRemoteJournal = async (journal: JournalData) => {
  const baseUrl = activityApiUrl();
  if (!baseUrl) throw storageError("Activity data service is not configured.");

  const response = await fetch(`${baseUrl}/activities`, {
    method: "PUT",
    headers: apiHeaders(),
    body: JSON.stringify({
      version: journalStorageVersion,
      activities: journal.activities,
      tasks: journal.tasks,
      sampleDataState: normalizeSampleDataState(journal.sampleDataState, journal.activities, journal.tasks),
    }),
  });
  if (!response.ok) throw storageError(`Activity data service returned ${await remoteResponseMessage(response)}.`);
};

export const parseJournalBackup = (contents: string): JournalData => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw storageError("The selected backup is not valid JSON.");
  }

  if (!isRecord(parsed)) throw storageError("The selected backup is not a compatible WorkFlow Journal backup.");
  if (parsed.format === legacyBackupFormat && parsed.version === legacyBackupVersion && Array.isArray(parsed.activities)) {
    return validateJournal(parsed.activities, [], parsed.sampleDataState);
  }
  if (parsed.format !== backupFormat || parsed.version !== backupVersion || !Array.isArray(parsed.activities) || !Array.isArray(parsed.tasks)) {
    throw storageError("The selected backup is not a compatible WorkFlow Journal backup.");
  }
  return validateJournal(parsed.activities, parsed.tasks, parsed.sampleDataState);
};

export const createJournalBackup = (journal: JournalData): string =>
  JSON.stringify({
    format: backupFormat,
    version: backupVersion,
    exportedAt: new Date().toISOString(),
    activities: journal.activities,
    tasks: journal.tasks,
    sampleDataState: normalizeSampleDataState(journal.sampleDataState, journal.activities, journal.tasks),
  } satisfies JournalBackup, null, 2);

export const loadJournal = async (onError?: (error: unknown) => void): Promise<JournalData | null> => {
  let journal: JournalData | null = null;
  try {
    const configuredApi = activityApiUrl();
    if (!configuredApi) {
      journal = await readBrowserJournal();
    } else {
      try {
        const remoteJournal = await readRemoteJournal();
        if (hasJournalData(remoteJournal)) {
          writeStoredJournal(remoteJournal);
          journal = remoteJournal;
        } else {
          const localJournal = await readBrowserJournal();
          if (localJournal) {
            await writeRemoteJournal(localJournal);
            journal = localJournal;
          } else {
            journal = remoteJournal;
          }
        }
      } catch (remoteError) {
        journal = await readBrowserJournal();
        if (!journal) onError?.(remoteError);
      }
    }
  } catch (error) {
    onError?.(error);
  }

  if (journal && journal.sampleDataState !== "pending") return journal;

  const preferences = readTimelinePreferences();
  const now = new Date(runtimeClock()).toISOString();
  const today = dateFromTimestamp(now, preferences.timezone);
  const initialJournal: JournalData = {
    activities: demoActivitiesForDate(today, preferences.timezone),
    tasks: [],
    sampleDataState: "shown",
  };
  await saveJournal(initialJournal, onError);
  return initialJournal;
};

export const saveJournal = async (
  journal: JournalData,
  onError?: (error: unknown) => void,
): Promise<ActivitySaveResult> => {
  let validatedJournal: JournalData;
  try {
    validatedJournal = validateJournal(journal.activities, journal.tasks, journal.sampleDataState);
    writeStoredJournal(validatedJournal);
  } catch (error) {
    onError?.(error);
    const result: ActivitySaveResult = { saved: false, storage: "local", error };
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("workflow-persistence-status", { detail: result }));
    return result;
  }

  if (!activityApiUrl()) {
    const result: ActivitySaveResult = { saved: true, storage: "local" };
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("workflow-persistence-status", { detail: result }));
    return result;
  }

  try {
    await writeRemoteJournal(validatedJournal);
    const result: ActivitySaveResult = { saved: true, storage: "remote" };
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("workflow-persistence-status", { detail: result }));
    return result;
  } catch (remoteError) {
    const result: ActivitySaveResult = { saved: true, storage: "local", remoteError };
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("workflow-persistence-status", { detail: result }));
    return result;
  }
};

export const importJournalBackup = async (
  contents: string,
  onError?: (error: unknown) => void,
): Promise<JournalData | null> => {
  const parsedJournal = parseJournalBackup(contents);
  const journal = parsedJournal.activities.length === 0 && parsedJournal.tasks.length === 0
    && parsedJournal.sampleDataState === "pending"
    ? { ...parsedJournal, sampleDataState: "cleared" as const }
    : parsedJournal;
  const result = await saveJournal(journal, onError);
  return result.saved ? journal : null;
};

// Compatibility helpers for callers that only need the activity collection.
export const loadActivities = async (onError?: (error: unknown) => void): Promise<Activity[] | null> =>
  (await loadJournal(onError))?.activities ?? null;

export const saveActivities = async (
  activities: Activity[],
  onError?: (error: unknown) => void,
): Promise<ActivitySaveResult> => saveJournal({ activities, tasks: [] }, onError);

export const parseActivityBackup = (contents: string): Activity[] => parseJournalBackup(contents).activities;

export const createActivityBackup = (activities: Activity[]): string => JSON.stringify({
  format: legacyBackupFormat,
  version: legacyBackupVersion,
  exportedAt: new Date().toISOString(),
  activities,
} satisfies ActivityBackup, null, 2);

export const importActivityBackup = async (
  contents: string,
  onError?: (error: unknown) => void,
): Promise<Activity[] | null> => (await importJournalBackup(contents, onError))?.activities ?? null;
