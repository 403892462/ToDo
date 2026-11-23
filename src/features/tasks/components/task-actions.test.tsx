import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalTaskRepository } from "../repository";
import { TaskApp } from "./task-app";

describe("任务快捷操作", () => {
  beforeEach(() => localStorage.clear());
  function seed() {
    const dueAt = new Date();
    dueAt.setHours(9, 0, 0, 0);
    new LocalTaskRepository(localStorage, () => "2026-11-05T08:00:00.000Z", () => "parent").create({ title: "发布版本", dueAt: dueAt.toISOString() });
    return dueAt;
  }

  it("顺延一小时并可推迟到明天", async () => {
    const dueAt = seed(); render(<TaskApp repository={new LocalTaskRepository(localStorage)} />);
    fireEvent.click(await screen.findByRole("button", { name: "打开任务：发布版本" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "任务快捷操作" })).getByRole("button", { name: "顺延 1 小时" }));
    const shifted = new Date(dueAt); shifted.setHours(shifted.getHours() + 1);
    await waitFor(() => expect(new LocalTaskRepository(localStorage).list()[0].dueAt).toBe(shifted.toISOString()));
    fireEvent.click(screen.getByRole("button", { name: "打开任务：发布版本" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "任务快捷操作" })).getByRole("button", { name: "推迟到明天" }));
    shifted.setDate(shifted.getDate() + 1);
    await waitFor(() => expect(new LocalTaskRepository(localStorage).list()[0].dueAt).toBe(shifted.toISOString()));
  });

  it("预览确认后保留父任务并创建子任务", async () => {
    seed(); const breakdown = vi.fn().mockResolvedValue(["准备变更记录", "执行部署"]); render(<TaskApp repository={new LocalTaskRepository(localStorage)} breakDownTask={breakdown} />);
    fireEvent.click(await screen.findByRole("button", { name: "打开任务：发布版本" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "任务快捷操作" })).getByRole("button", { name: "AI 拆解" }));
    const preview = await screen.findByRole("dialog", { name: "AI 拆解预览" });
    expect(within(preview).getByText("准备变更记录")).toBeInTheDocument();
    fireEvent.click(within(preview).getByRole("button", { name: "确认创建" }));
    await waitFor(() => expect(new LocalTaskRepository(localStorage).list()).toHaveLength(3));
    const tasks = new LocalTaskRepository(localStorage).list();
    expect(tasks.slice(1).every((task) => task.parentId === "parent")).toBe(true);
  });

  it("取消或失败时不创建子任务", async () => {
    seed(); render(<TaskApp repository={new LocalTaskRepository(localStorage)} breakDownTask={vi.fn().mockRejectedValue(new Error("offline"))} />);
    fireEvent.click(await screen.findByRole("button", { name: "打开任务：发布版本" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "任务快捷操作" })).getByRole("button", { name: "AI 拆解" }));
    expect(await screen.findByRole("status")).toHaveTextContent("AI 拆解失败");
    expect(new LocalTaskRepository(localStorage).list()).toHaveLength(1);
  });
});
