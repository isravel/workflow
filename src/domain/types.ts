import type { ActivityColorToken } from "./activityColors";

export type CategoryKind = "focus" | "meeting" | "break" | null;

export type Category = {
  id: string;
  name: string;
  kind: CategoryKind;
  colorToken: ActivityColorToken;
  icon: string;
};

export type ActivityPriority = string;

export type TaskStatus = "open" | "in-progress" | "on-hold" | "fixed" | "closed" | "reopened";

export type Task = {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
};

export type Activity = {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  categoryId: string;
  colorToken?: ActivityColorToken;
  notes: string;
  tags: string[];
  priority?: ActivityPriority;
  taskId?: string;
  createdAt?: string;
  updatedAt?: string;
};
