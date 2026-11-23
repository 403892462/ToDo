import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdminApp } from "./admin-app";

describe("管理员恢复界面", () => {
  it("未验证时只显示三要素登录", async () => {
    render(<AdminApp checkSession={vi.fn().mockResolvedValue(false)} />);
    expect(await screen.findByRole("heading", { name: "管理员验证" })).toBeInTheDocument();
    expect(screen.getByLabelText("用户名")).toBeInTheDocument();
    expect(screen.getByLabelText("强密码")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("动态验证码")).toBeInTheDocument();
    expect(screen.queryByText("访问码恢复")).not.toBeInTheDocument();
  });

  it("三要素成功后进入恢复管理", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    render(<AdminApp checkSession={vi.fn().mockResolvedValue(false)} login={login} />);
    fireEvent.change(await screen.findByLabelText("用户名"), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("强密码"), { target: { value: "strong-password" } });
    fireEvent.change(screen.getByLabelText("动态验证码"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "进入恢复管理" }));
    expect(await screen.findByRole("heading", { name: "访问码恢复" })).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith({ username: "admin", password: "strong-password", totp: "123456" });
  });

  it("重置前二次确认，成功后只展示一次新码", async () => {
    const reset = vi.fn().mockResolvedValue("TD-new-one-time-code");
    render(<AdminApp checkSession={vi.fn().mockResolvedValue(true)} reset={reset} loadAudits={vi.fn().mockResolvedValue([])} />);
    const input = await screen.findByLabelText("个人空间 ID");
    fireEvent.change(input, { target: { value: "11111111-1111-4111-8111-111111111111" } });
    fireEvent.click(screen.getByRole("button", { name: "重置访问码" }));
    const dialog = screen.getByRole("dialog", { name: "确认重置访问码" });
    expect(within(dialog).getByText(/旧访问码立即失效/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "确认重置" }));
    expect(await screen.findByText("TD-new-one-time-code")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "我已保存并关闭" }));
    await waitFor(() => expect(screen.queryByText("TD-new-one-time-code")).not.toBeInTheDocument());
  });

  it("无审计记录时显示空状态，失败时保留旧码提示", async () => {
    render(<AdminApp checkSession={vi.fn().mockResolvedValue(true)} reset={vi.fn().mockRejectedValue(new Error("访问码重置失败，旧访问码保持有效"))} />);
    expect(await screen.findByText("暂无恢复记录")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("个人空间 ID"), { target: { value: "11111111-1111-4111-8111-111111111111" } });
    fireEvent.click(screen.getByRole("button", { name: "重置访问码" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认重置访问码" })).getByRole("button", { name: "确认重置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("旧访问码保持有效");
  });
});
