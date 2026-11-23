import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiTaskRepository, TaskPersistenceError } from "./api-repository";

describe("ApiTaskRepository", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("默认浏览器 fetch 不会被当作仓储对象的方法调用", async () => {
    const fetcher = vi.fn(function (this: unknown) {
      if (this !== undefined) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(new ApiTaskRepository().list()).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledWith("/api/tasks", { cache: "no-store" });
  });

  it("只读取服务端任务，不迁移浏览器旧任务", async () => {
    localStorage.setItem("todo.tasks.v1", JSON.stringify([{ id: "legacy", title: "旧任务" }]));
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await expect(new ApiTaskRepository(fetcher).list()).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledWith("/api/tasks", { cache: "no-store" });
    expect(localStorage.getItem("todo.tasks.v1")).toContain("旧任务");
  });

  it("批量创建通过单次服务端请求保存", async () => {
    const tasks = [{ id: "task-1", title: "任务", labels: [], completed: false }];
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(tasks), { status: 201 }));

    await new ApiTaskRepository(fetcher).createMany([{ title: "任务" }]);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/tasks",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ tasks: [{ title: "任务" }] }) }),
    );
  });

  it("服务端写入失败时拒绝操作而不返回虚假任务", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "失败" }), { status: 503 }));
    await expect(new ApiTaskRepository(fetcher).create({ title: "不应保存" })).rejects.toBeInstanceOf(
      TaskPersistenceError,
    );
  });
});
