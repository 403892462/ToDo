import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalTaskRepository } from "../repository";
import { TaskApp } from "./task-app";

describe("natural-language task creation", () => {
  beforeEach(() => localStorage.clear());

  function submit(text: string) {
    fireEvent.change(screen.getByLabelText("闪念收集箱"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
  }

  function acceptConsent() {
    const dialog = screen.getByRole("dialog", { name: "AI 数据提示" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认并继续" }));
  }

  function repository() {
    return new LocalTaskRepository(localStorage);
  }

  it("rejects blank input without calling AI", async () => {
    const parseTask = vi.fn();
    render(<TaskApp repository={repository()} parseTask={parseTask} />);
    await screen.findByText("还没有任务");
    submit("   ");
    expect(screen.getByRole("alert")).toHaveTextContent("请输入任务内容");
    expect(parseTask).not.toHaveBeenCalled();
  });

  it("does not send or create when consent is refused", async () => {
    const parseTask = vi.fn();
    render(<TaskApp repository={repository()} parseTask={parseTask} />);
    await screen.findByText("还没有任务");
    submit("整理书桌");
    const dialog = screen.getByRole("dialog", { name: "AI 数据提示" });
    fireEvent.click(within(dialog).getByRole("button", { name: "拒绝" }));
    expect(parseTask).not.toHaveBeenCalled();
    expect(screen.getByText("还没有任务")).toBeInTheDocument();
  });

  it("creates a structured task after consent", async () => {
    const parseTask = vi.fn().mockResolvedValue({
      status: "parsed",
      tasks: [{ title: "跟老张对齐代码", dueAt: "明天 15:00", labels: ["工作"], priority: "high" }],
      partial: false,
      truncated: false,
    });
    render(<TaskApp repository={repository()} parseTask={parseTask} />);
    await screen.findByText("还没有任务");
    submit("明天下午3点提醒我跟老张对齐代码 #工作 !重要");
    expect(screen.getByText("输入会发送给第三方大模型，请勿输入敏感数据。")).toBeInTheDocument();
    acceptConsent();
    expect(await screen.findByText("跟老张对齐代码")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已创建 1 条任务");
  });

  it("creates failed fragments from their original text", async () => {
    localStorage.setItem("todo.ai-consent.v1", "accepted");
    const parseTask = vi.fn().mockResolvedValue({ status: "parsed", tasks: [{ title: "不确定的任务描述", labels: [] }], partial: true, truncated: false });
    render(<TaskApp repository={repository()} parseTask={parseTask} />);
    await screen.findByText("还没有任务");
    submit("不确定的任务描述");
    expect(await screen.findByText("不确定的任务描述")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("部分任务未识别");
  });

  it("creates multiple tasks and reports truncation", async () => {
    localStorage.setItem("todo.ai-consent.v1", "accepted");
    const tasks = Array.from({ length: 10 }, (_, index) => ({ title: `任务${index + 1}`, labels: [] }));
    const parseTask = vi.fn().mockResolvedValue({ status: "parsed", tasks, partial: false, truncated: true });
    render(<TaskApp repository={repository()} parseTask={parseTask} />);
    await screen.findByText("还没有任务");
    submit("十一条任务");
    expect(await screen.findByText("任务10")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已创建前 10 条任务，其余任务未创建");
  });

  it.each([
    ["error response", vi.fn().mockResolvedValue({ status: "error", error: "AI_PARSE_FAILED" })],
    ["network rejection", vi.fn().mockRejectedValue(new Error("offline"))],
  ])("creates the original text after %s", async (_, parseTask) => {
    localStorage.setItem("todo.ai-consent.v1", "accepted");
    render(<TaskApp repository={repository()} parseTask={parseTask} />);
    await screen.findByText("还没有任务");
    submit("保留原文任务");
    expect(await screen.findByText("保留原文任务")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("AI 解析失败");
    await waitFor(() => expect(parseTask).toHaveBeenCalledTimes(1));
  });

  it("服务端保存失败时保留输入且不显示虚假成功", async () => {
    localStorage.setItem("todo.ai-consent.v1", "accepted");
    const baseRepository = repository();
    const failingRepository = {
      list: () => [],
      createMany: vi.fn().mockRejectedValue(new Error("database offline")),
      create: baseRepository.create.bind(baseRepository),
      update: baseRepository.update.bind(baseRepository),
      setCompleted: baseRepository.setCompleted.bind(baseRepository),
      delete: baseRepository.delete.bind(baseRepository),
    };
    const parseTask = vi.fn().mockResolvedValue({
      status: "parsed",
      tasks: [{ title: "不应虚假创建", labels: [] }],
      partial: false,
      truncated: false,
    });
    render(<TaskApp repository={failingRepository} parseTask={parseTask} />);
    await screen.findByText("还没有任务");
    submit("数据库失败时保留输入");

    expect(await screen.findByRole("alert")).toHaveTextContent("任务保存失败，请稍后重试");
    expect(screen.getByLabelText("闪念收集箱")).toHaveValue("数据库失败时保留输入");
    expect(screen.queryByText("不应虚假创建")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
