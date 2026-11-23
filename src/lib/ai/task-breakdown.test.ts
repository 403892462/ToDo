import { describe, expect, it, vi } from "vitest";
import { breakDownTask } from "./task-breakdown";

describe("breakDownTask", () => {
  it("清理模型返回的子任务", async () => {
    await expect(breakDownTask("发布版本", vi.fn().mockResolvedValue({ subtasks: [" 准备变更记录 ", "执行部署"] }))).resolves.toEqual({ subtasks: ["准备变更记录", "执行部署"] });
  });
  it("拒绝空任务", async () => { await expect(breakDownTask("  ")).rejects.toThrow("Task title is required"); });
});
