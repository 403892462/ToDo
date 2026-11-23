import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { LocalTaskRepository } from "../repository";
import { TaskApp } from "./task-app";

describe("TaskApp", () => {
  beforeEach(() => localStorage.clear());

  function seed() {
    const repo = new LocalTaskRepository(localStorage, () => "2026-11-04T08:00:00.000Z", () => "task-1");
    repo.create({ title: "跟老张对齐代码", labels: ["工作"], priority: "high" });
    return repo;
  }

  function repository() {
    return new LocalTaskRepository(localStorage);
  }

  it("shows the empty state", async () => {
    render(<TaskApp repository={repository()} />);
    expect(await screen.findByText("还没有任务")).toBeInTheDocument();
  });

  it("shows tasks and filters by label", async () => {
    seed();
    render(<TaskApp repository={repository()} />);

    expect(await screen.findByText("跟老张对齐代码")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "工作" }));
    expect(screen.getByText("跟老张对齐代码")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
  });

  it("edits approved task fields", async () => {
    seed();
    render(<TaskApp repository={repository()} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    const dialog = screen.getByRole("dialog", { name: "编辑任务" });
    fireEvent.change(within(dialog).getByLabelText("任务名"), { target: { value: "更新后的任务" } });
    fireEvent.change(within(dialog).getByLabelText("时间"), { target: { value: "明天 15:00" } });
    fireEvent.change(within(dialog).getByLabelText("标签（逗号分隔）"), { target: { value: "工作, 重要" } });
    fireEvent.change(within(dialog).getByLabelText("优先级"), { target: { value: "medium" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(await screen.findByText("更新后的任务")).toBeInTheDocument();
    expect(screen.getByText("明天 15:00")).toBeInTheDocument();
    expect(screen.getByText("#重要")).toBeInTheDocument();
    expect(screen.getByText("优先级：中")).toBeInTheDocument();
  });

  it("completes and restores a task", async () => {
    seed();
    render(<TaskApp repository={repository()} />);
    const checkbox = await screen.findByRole("checkbox", { name: /切换.*完成状态/ });
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toBeChecked());
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).not.toBeChecked());
  });

  it("cancels and confirms permanent deletion", async () => {
    seed();
    render(<TaskApp repository={repository()} />);
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    let dialog = screen.getByRole("dialog", { name: "确认删除" });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.getByText("跟老张对齐代码")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    dialog = screen.getByRole("dialog", { name: "确认删除" });
    fireEvent.click(within(dialog).getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(screen.queryByText("跟老张对齐代码")).not.toBeInTheDocument());
    expect(screen.getByText("还没有任务")).toBeInTheDocument();
  });

  it("closes dialogs with Escape and restores focus", async () => {
    seed();
    render(<TaskApp repository={repository()} />);
    const trigger = await screen.findByRole("button", { name: "编辑" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "编辑任务" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "编辑任务" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows an empty result when the selected label no longer matches", async () => {
    seed();
    render(<TaskApp repository={repository()} />);
    fireEvent.click(await screen.findByRole("button", { name: "工作" }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认删除" })).getByRole("button", { name: "永久删除" }));
    expect(await screen.findByText("没有匹配任务")).toBeInTheDocument();
  });
});
