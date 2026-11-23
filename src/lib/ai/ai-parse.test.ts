import { describe, expect, it, vi } from "vitest";
import { buildTaskPrompt, parseTaskText } from "./task-parser";

const item = (title: string) => ({ sourceText: title, certain: true, title, dueAt: null, durationMinutes: null, labels: [], priority: null });

describe("parseTaskText", () => {
  it("向模型提供批量、上海时间和时间范围规则", () => {
    const prompt = buildTaskPrompt("今天19:00～20:00讨论；20:30～21:00聚餐", new Date("2026-11-05T10:00:00.000Z"));
    expect(prompt).toContain("一个或多个独立个人任务");
    expect(prompt).toContain("最多返回前 10 个任务");
    expect(prompt).toContain("durationMinutes");
    expect(prompt).toContain("Asia/Shanghai（UTC+08:00）");
  });

  it("映射多个任务和时间范围时长", async () => {
    const generate = vi.fn().mockResolvedValue({ truncated: false, tasks: [
      { ...item("与团队讨论AD域登录问题"), sourceText: "今天19:00～20:00 与团队讨论AD域登录问题", dueAt: "2026-11-06T19:00:00+08:00", durationMinutes: 60 },
      { ...item("与团队一起去Happy"), sourceText: "20:30～21:00 与团队一起去Happy", dueAt: "2026-11-06T20:30:00+08:00", durationMinutes: 30 },
    ] });
    const result = await parseTaskText("两条任务", generate);
    expect(result.tasks.map(({ title, durationMinutes }) => ({ title, durationMinutes }))).toEqual([
      { title: "与团队讨论AD域登录问题", durationMinutes: 60 },
      { title: "与团队一起去Happy", durationMinutes: 30 },
    ]);
    expect(result).toMatchObject({ status: "parsed", partial: false, truncated: false });
  });

  it("局部失败时保留片段原文", async () => {
    const generate = vi.fn().mockResolvedValue({ truncated: false, tasks: [
      item("整理书桌"),
      { sourceText: "???", certain: false, title: null, dueAt: null, durationMinutes: null, labels: [], priority: null },
    ] });
    const result = await parseTaskText("整理书桌；???", generate);
    expect(result.partial).toBe(true);
    expect(result.tasks[1]).toEqual({ title: "???", labels: [] });
  });

  it("最多保留前十条并标记截断", async () => {
    const tasks = Array.from({ length: 11 }, (_, index) => item(`任务${index + 1}`));
    const result = await parseTaskText("十一条任务", vi.fn().mockResolvedValue({ tasks, truncated: false }));
    expect(result.tasks).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it("拒绝空输入并透传提供器失败", async () => {
    const generate = vi.fn();
    await expect(parseTaskText("  ", generate)).rejects.toThrow("Task text is required");
    await expect(parseTaskText("任务", vi.fn().mockRejectedValue(new Error("timeout")))).rejects.toThrow("timeout");
  });
});
