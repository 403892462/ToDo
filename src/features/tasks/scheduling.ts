import { DEFAULT_TASK_DURATION_MINUTES, type Task } from "./model";

export interface TaskInterval {
  taskId: string;
  start: Date;
  end: Date;
}

export function getTaskInterval(task: Pick<Task, "id" | "dueAt" | "durationMinutes">): TaskInterval | null {
  if (!task.dueAt) return null;
  const start = new Date(task.dueAt);
  if (Number.isNaN(start.getTime())) return null;
  const duration = task.durationMinutes ?? DEFAULT_TASK_DURATION_MINUTES;
  return { taskId: task.id, start, end: new Date(start.getTime() + duration * 60_000) };
}

export function intervalsOverlap(left: TaskInterval, right: TaskInterval) {
  return left.start < right.end && right.start < left.end;
}

export function findConflictingTaskIds(tasks: Task[]) {
  const intervals = tasks.map(getTaskInterval).filter((item): item is TaskInterval => item !== null);
  const conflicting = new Set<string>();
  for (let left = 0; left < intervals.length; left += 1) {
    for (let right = left + 1; right < intervals.length; right += 1) {
      if (intervalsOverlap(intervals[left], intervals[right])) {
        conflicting.add(intervals[left].taskId);
        conflicting.add(intervals[right].taskId);
      }
    }
  }
  return conflicting;
}

export function calculateLockedMinutes(tasks: Task[], dayStart: Date) {
  const startMs = dayStart.getTime();
  const endMs = startMs + 24 * 60 * 60_000;
  const intervals = tasks
    .map(getTaskInterval)
    .filter((item): item is TaskInterval => item !== null)
    .map((item) => ({ start: Math.max(startMs, item.start.getTime()), end: Math.min(endMs, item.end.getTime()) }))
    .filter((item) => item.start < item.end)
    .sort((left, right) => left.start - right.start);

  let total = 0;
  let cursorStart = -1;
  let cursorEnd = -1;
  for (const interval of intervals) {
    if (interval.start > cursorEnd) {
      if (cursorStart >= 0) total += cursorEnd - cursorStart;
      cursorStart = interval.start;
      cursorEnd = interval.end;
    } else {
      cursorEnd = Math.max(cursorEnd, interval.end);
    }
  }
  if (cursorStart >= 0) total += cursorEnd - cursorStart;
  return total / 60_000;
}

export function findEarliestAvailableSlot(tasks: Task[], dayStart: Date, durationMinutes = DEFAULT_TASK_DURATION_MINUTES) {
  const duration = durationMinutes * 60_000;
  const startMs = dayStart.getTime();
  const endMs = startMs + 24 * 60 * 60_000;
  const intervals = tasks
    .map(getTaskInterval)
    .filter((item): item is TaskInterval => item !== null)
    .map((item) => ({ start: Math.max(startMs, item.start.getTime()), end: Math.min(endMs, item.end.getTime()) }))
    .filter((item) => item.start < item.end)
    .sort((left, right) => left.start - right.start);

  let candidate = startMs;
  for (const interval of intervals) {
    if (candidate + duration <= interval.start) return new Date(candidate);
    candidate = Math.max(candidate, interval.end);
  }
  return candidate + duration <= endMs ? new Date(candidate) : null;
}
