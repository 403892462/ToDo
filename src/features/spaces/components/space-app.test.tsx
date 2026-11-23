import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalTaskRepository } from "@/features/tasks/repository";

import { SpaceApp } from "./space-app";

describe("个人空间入口", () => {
  beforeEach(() => localStorage.clear());

  it("未授权时显示创建和恢复入口且不导入旧任务", async () => {
    localStorage.setItem("todo.tasks.v1", JSON.stringify([{ id: "legacy", title: "旧本机任务" }]));
    render(
      <SpaceApp
        checkSpace={vi.fn().mockResolvedValue(null)}
        taskRepository={new LocalTaskRepository(localStorage)}
      />,
    );

    expect(await screen.findByRole("heading", { name: "随时记录，跨设备继续" })).toBeInTheDocument();
    expect(screen.getByText(/旧任务不会自动导入/)).toBeInTheDocument();
    expect(screen.queryByText("旧本机任务")).not.toBeInTheDocument();
  });

  it("创建成功后只展示一次凭证并要求确认保存", async () => {
    const createSpace = vi.fn().mockResolvedValue({ spaceId: "space-1", accessCode: "TD-one-time-code" });
    const repository = new LocalTaskRepository(localStorage);
    render(
      <SpaceApp
        checkSpace={vi.fn().mockResolvedValue(null)}
        createSpace={createSpace}
        taskRepository={repository}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "创建个人空间" }));
    expect(await screen.findByRole("heading", { name: "请保存个人空间访问码" })).toBeInTheDocument();
    expect(screen.getByText("TD-one-time-code")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "今天" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "我已保存，进入任务首页" }));
    expect(await screen.findByRole("heading", { name: "今天" })).toBeInTheDocument();
    expect(screen.queryByText("TD-one-time-code")).not.toBeInTheDocument();
  });

  it("有效访问码恢复后进入同一任务空间", async () => {
    const repository = new LocalTaskRepository(localStorage, undefined, () => "task-1");
    repository.create({ title: "跨设备任务" });
    const recoverSpace = vi.fn().mockResolvedValue({ spaceId: "space-1" });
    render(
      <SpaceApp
        checkSpace={vi.fn().mockResolvedValue(null)}
        recoverSpace={recoverSpace}
        taskRepository={repository}
      />,
    );

    fireEvent.change(await screen.findByLabelText("访问码"), { target: { value: "TD-valid-code" } });
    fireEvent.click(screen.getByRole("button", { name: "使用访问码恢复" }));
    expect(await screen.findByText("跨设备任务")).toBeInTheDocument();
    expect(recoverSpace).toHaveBeenCalledWith("TD-valid-code");
  });

  it("恢复失败时保留入口并显示统一错误", async () => {
    render(
      <SpaceApp
        checkSpace={vi.fn().mockResolvedValue(null)}
        recoverSpace={vi.fn().mockRejectedValue(new Error("无法恢复个人空间"))}
        taskRepository={new LocalTaskRepository(localStorage)}
      />,
    );

    fireEvent.change(await screen.findByLabelText("访问码"), { target: { value: "TD-wrong-code" } });
    fireEvent.click(screen.getByRole("button", { name: "使用访问码恢复" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法恢复个人空间");
    expect(screen.getByRole("button", { name: "创建个人空间" })).toBeInTheDocument();
  });

  it("已有授权时直接加载任务首页", async () => {
    render(
      <SpaceApp
        checkSpace={vi.fn().mockResolvedValue({ spaceId: "space-1" })}
        taskRepository={new LocalTaskRepository(localStorage)}
      />,
    );
    await waitFor(() => expect(screen.getByRole("heading", { name: "今天" })).toBeInTheDocument());
  });
});
