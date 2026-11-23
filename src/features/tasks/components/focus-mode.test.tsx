import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LocalTaskRepository } from "../repository";
import { TaskApp } from "./task-app";

describe("专注模式", () => {
  beforeEach(() => localStorage.clear());

  it("可通过点击菜单启动、暂停并完成任务", async () => {
    const dueAt = new Date();
    dueAt.setHours(9, 0, 0, 0);
    new LocalTaskRepository(localStorage, () => "2026-11-05T08:00:00.000Z", () => "task-1").create({ title: "敲代码", dueAt: dueAt.toISOString() });
    render(<TaskApp repository={new LocalTaskRepository(localStorage)} />);
    fireEvent.click(await screen.findByRole("button", { name: "打开任务：敲代码" }));
    const actions = screen.getByRole("dialog", { name: "任务快捷操作" });
    fireEvent.click(within(actions).getByRole("button", { name: "开始专注 25:00" }));
    const focus = screen.getByRole("dialog", { name: "专注模式" });
    expect(within(focus).getByText("25:00")).toBeInTheDocument();
    fireEvent.click(within(focus).getByRole("button", { name: "暂停" }));
    expect(within(focus).getByRole("button", { name: "继续" })).toBeInTheDocument();
    fireEvent.click(within(focus).getByRole("button", { name: "完成任务" }));
    expect(new LocalTaskRepository(localStorage).list()[0].completed).toBe(true);
  });
});
