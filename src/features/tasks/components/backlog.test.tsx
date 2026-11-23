import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LocalTaskRepository } from "../repository";
import { TaskApp } from "./task-app";

describe("任务池", () => {
  beforeEach(() => localStorage.clear());

  it("收纳无时间任务并可安排到今天", async () => {
    new LocalTaskRepository(localStorage, () => "2026-11-05T08:00:00.000Z", () => "task-1").create({ title: "整理照片" });
    render(<TaskApp repository={new LocalTaskRepository(localStorage)} />);
    await screen.findByRole("button", { name: "打开任务池，共 1 项" });
    fireEvent.click(screen.getByRole("button", { name: "打开任务池，共 1 项" }));
    const dialog = screen.getByRole("dialog", { name: "任务池" });
    expect(within(dialog).getByText("整理照片")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "安排到今天" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已将“整理照片”安排到今天");
    await waitFor(() => expect(new LocalTaskRepository(localStorage).list()[0].dueAt).toBeTruthy());
  });
});
