import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalTaskRepository } from "./repository";

const firstTime = "2026-11-04T08:00:00.000Z";
const secondTime = "2026-11-04T09:00:00.000Z";

describe("LocalTaskRepository", () => {
  beforeEach(() => localStorage.clear());

  function repository() {
    const now = vi.fn().mockReturnValueOnce(firstTime).mockReturnValue(secondTime);
    return new LocalTaskRepository(localStorage, now, () => "task-1");
  }

  it("shows an empty collection when no tasks exist", () => {
    expect(repository().list()).toEqual([]);
  });

  it("creates and reloads a structured task from local storage", () => {
    const repo = repository();
    repo.create({
      title: " 跟老张对齐代码 ",
      dueAt: "2026-11-05T15:00:00+08:00",
      labels: ["工作"],
      priority: "high",
      durationMinutes: 90,
      parentId: "parent-1",
    });

    const reloaded = new LocalTaskRepository(localStorage).list();
    expect(reloaded).toEqual([
      expect.objectContaining({
        id: "task-1",
        title: "跟老张对齐代码",
        labels: ["工作"],
        priority: "high",
        durationMinutes: 90,
        parentId: "parent-1",
        completed: false,
      }),
    ]);
  });

  it("edits every approved field without changing untouched state", () => {
    const repo = repository();
    const task = repo.create({ title: "旧任务", labels: ["生活"] });
    const updated = repo.update(task.id, {
      title: "新任务",
      dueAt: "2026-11-06T10:00:00+08:00",
      labels: ["工作"],
      priority: "medium",
    });

    expect(updated).toEqual(
      expect.objectContaining({
        title: "新任务",
        dueAt: "2026-11-06T10:00:00+08:00",
        labels: ["工作"],
        priority: "medium",
        completed: false,
      }),
    );
  });

  it("marks a task complete and restores it to incomplete", () => {
    const repo = repository();
    const task = repo.create({ title: "完成测试" });

    expect(repo.setCompleted(task.id, true)?.completed).toBe(true);
    expect(repo.setCompleted(task.id, false)?.completed).toBe(false);
    expect(new LocalTaskRepository(localStorage).list()[0].completed).toBe(false);
  });

  it("permanently deletes only the selected task", () => {
    const repo = repository();
    const task = repo.create({ title: "删除测试" });

    expect(repo.delete(task.id)).toBe(true);
    expect(repo.list()).toEqual([]);
    expect(repo.delete("missing")).toBe(false);
  });

  it("filters tasks by an exact label and returns an empty result", () => {
    const repo = repository();
    repo.create({ title: "工作任务", labels: ["工作"] });
    const secondRepo = new LocalTaskRepository(localStorage, () => secondTime, () => "task-2");
    secondRepo.create({ title: "生活任务", labels: ["生活"] });

    expect(secondRepo.filterByLabel("工作").map((task) => task.title)).toEqual(["工作任务"]);
    expect(secondRepo.filterByLabel("不存在")).toEqual([]);
  });

  it("does not replace stored data when persistence fails", () => {
    const repo = repository();
    const task = repo.create({ title: "原任务" });
    const failingStorage = {
      getItem: localStorage.getItem.bind(localStorage),
      setItem: vi.fn(() => {
        throw new Error("quota exceeded");
      }),
    };
    const failingRepo = new LocalTaskRepository(failingStorage, () => secondTime, () => "task-2");

    expect(() => failingRepo.update(task.id, { title: "不应保存" })).toThrow("quota exceeded");
    expect(repo.list()[0].title).toBe("原任务");
  });

  it("keeps legacy v1 tasks readable when scheduling fields are absent", () => {
    localStorage.setItem("todo.tasks.v1", JSON.stringify([{ id: "legacy", title: "旧任务", labels: [], completed: false, createdAt: firstTime, updatedAt: firstTime }]));
    expect(repository().list()[0]).toEqual(expect.objectContaining({ id: "legacy", title: "旧任务" }));
  });

  it("rejects invalid task durations without overwriting stored tasks", () => {
    const repo = repository();
    repo.create({ title: "原任务" });
    expect(() => repo.create({ title: "错误时长", durationMinutes: 0 })).toThrow("Task duration");
    expect(repo.list()).toHaveLength(1);
  });
});
