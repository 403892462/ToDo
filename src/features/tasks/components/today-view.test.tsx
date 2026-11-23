import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "../model";
import { TodayView } from "./today-view";

const task = (id: string, dueAt: string): Task => ({ id, title: id, dueAt, labels: [], completed: false, createdAt: dueAt, updatedAt: dueAt });

describe("TodayView", () => {
  it("shows time assets and scheduled tasks in time order", () => {
    render(<TodayView now={new Date(2026, 10, 5, 8)} tasks={[task("写周报", "2026-11-05T15:00:00+08:00"), task("敲代码", "2026-11-05T09:00:00+08:00")]} onOpenTask={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "今天" })).toBeInTheDocument();
    expect(screen.getByLabelText("已锁定 2 小时，空闲 22 小时")).toBeInTheDocument();
    expect(screen.getAllByRole("article").map((node) => node.textContent)).toEqual([expect.stringContaining("敲代码"), expect.stringContaining("写周报")]);
  });

  it("keeps overlapping tasks and marks both as conflicts", () => {
    render(<TodayView now={new Date(2026, 10, 5)} tasks={[task("任务一", "2026-11-05T09:00:00+08:00"), task("任务二", "2026-11-05T09:30:00+08:00")]} onOpenTask={vi.fn()} />);
    expect(screen.getAllByText("时间冲突")).toHaveLength(2);
    expect(screen.getByLabelText("已锁定 1.5 小时，空闲 22.5 小时")).toBeInTheDocument();
  });

  it("opens the selected task from its timeline card", async () => {
    const onOpenTask = vi.fn();
    render(<TodayView now={new Date(2026, 10, 5)} tasks={[task("敲代码", "2026-11-05T09:00:00+08:00")]} onOpenTask={onOpenTask} />);
    screen.getByRole("button", { name: "打开任务：敲代码" }).click();
    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ title: "敲代码" }));
  });

  it("starts focus after a right swipe", () => {
    const onStartFocus = vi.fn();
    render(<TodayView now={new Date(2026, 10, 5)} tasks={[task("敲代码", "2026-11-05T09:00:00+08:00")]} onOpenTask={vi.fn()} onStartFocus={onStartFocus} />);
    const card = screen.getByRole("button", { name: "打开任务：敲代码" });
    card.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 10 }));
    card.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 100 }));
    expect(onStartFocus).toHaveBeenCalledWith(expect.objectContaining({ title: "敲代码" }));
  });
});
