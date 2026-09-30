import { describe, expect, it } from "vitest";
import { createJournalBackup, parseJournalBackup } from "@/repositories/activityRepository";
import type { Activity, Task } from "@/domain/types";

const activity: Activity = {
  id: "activity-1",
  title: "Write release notes",
  startAt: "2026-09-18T09:00:00.000Z",
  endAt: "2026-09-18T09:30:00.000Z",
  categoryId: "deep-work",
  notes: "",
  tags: [],
};

const task: Task = {
  id: "task-1",
  title: "Prepare release notes",
  description: "Collect the changes.",
  dueDate: "2026-09-25",
  status: "open",
  createdAt: "2026-09-18T08:00:00.000Z",
  updatedAt: "2026-09-18T08:00:00.000Z",
};

describe("task journal persistence", () => {
  it("round-trips tasks and activity links through the backup format", () => {
    const source = {
      activities: [{ ...activity, taskId: task.id }],
      tasks: [task],
    };

    expect(parseJournalBackup(createJournalBackup(source))).toEqual(source);
  });

  it("imports legacy activity-only backups with no tasks", () => {
    const legacy = JSON.stringify({
      format: "workflow-journal-activities",
      version: 1,
      exportedAt: "2026-09-18T08:00:00.000Z",
      activities: [activity],
    });

    expect(parseJournalBackup(legacy)).toEqual({ activities: [activity], tasks: [] });
  });

  it("clears links to tasks that are not present in the backup", () => {
    const backup = JSON.stringify({
      format: "workflow-journal",
      version: 2,
      exportedAt: "2026-09-18T08:00:00.000Z",
      activities: [{ ...activity, taskId: "missing-task" }],
      tasks: [],
    });

    expect(parseJournalBackup(backup).activities[0]).not.toHaveProperty("taskId");
  });
});
