export type TaskPriority = "low" | "medium" | "high";

export interface Task {
  id: string;
  title: string;
  dueAt?: string;
  durationMinutes?: number;
  parentId?: string;
  labels: string[];
  priority?: TaskPriority;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDraft {
  title: string;
  dueAt?: string;
  durationMinutes?: number;
  parentId?: string;
  labels?: string[];
  priority?: TaskPriority;
}

export type TaskChanges = Partial<
  Pick<Task, "title" | "dueAt" | "durationMinutes" | "parentId" | "labels" | "priority">
>;

export const DEFAULT_TASK_DURATION_MINUTES = 60;

export function normalizeTaskDuration(durationMinutes?: number) {
  if (durationMinutes === undefined) return undefined;
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 24 * 60) {
    throw new Error("Task duration must be an integer between 1 and 1440 minutes");
  }
  return durationMinutes;
}

export function normalizeTaskTitle(title: string) {
  const normalized = title.trim();
  if (!normalized) throw new Error("Task title is required");
  return normalized;
}
