import { describe, expect, it } from "vitest";
import type { Task } from "./model";
import { calculateLockedMinutes, findConflictingTaskIds, findEarliestAvailableSlot, getTaskInterval } from "./scheduling";

const baseTask: Omit<Task, "id" | "title"> = {
  labels: [], completed: false, createdAt: "2026-11-05T00:00:00.000Z", updatedAt: "2026-11-05T00:00:00.000Z",
};
const task = (id: string, dueAt: string, durationMinutes?: number): Task => ({ ...baseTask, id, title: id, dueAt, durationMinutes });

describe("scheduling", () => {
  it("uses a 60 minute default when only a start time exists", () => {
    const interval = getTaskInterval(task("one", "2026-11-05T09:00:00.000Z"));
    expect(interval?.end.toISOString()).toBe("2026-11-05T10:00:00.000Z");
  });

  it("keeps both overlapping tasks and identifies each conflict", () => {
    const tasks = [task("one", "2026-11-05T09:00:00.000Z"), task("two", "2026-11-05T09:30:00.000Z")];
    expect([...findConflictingTaskIds(tasks)].sort()).toEqual(["one", "two"]);
  });

  it("counts overlapping locked time only once", () => {
    const tasks = [task("one", "2026-11-05T09:00:00.000Z"), task("two", "2026-11-05T09:30:00.000Z")];
    expect(calculateLockedMinutes(tasks, new Date("2026-11-05T00:00:00.000Z"))).toBe(90);
  });

  it("finds the earliest 60 minute free slot in the day", () => {
    const tasks = [task("one", "2026-11-05T00:00:00.000Z", 60), task("two", "2026-11-05T02:00:00.000Z", 60)];
    expect(findEarliestAvailableSlot(tasks, new Date("2026-11-05T00:00:00.000Z"))?.toISOString()).toBe("2026-11-05T01:00:00.000Z");
  });

  it("returns null when no full slot remains", () => {
    const tasks = [task("full", "2026-11-05T00:00:00.000Z", 24 * 60)];
    expect(findEarliestAvailableSlot(tasks, new Date("2026-11-05T00:00:00.000Z"))).toBeNull();
  });
});
