import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home", () => {
  it("未授权浏览器显示个人空间入口", async () => {
    render(<Home />);

    expect(await screen.findByRole("heading", { name: "随时记录，跨设备继续" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建个人空间" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "使用访问码恢复" })).toBeInTheDocument();
    expect(screen.getByText(/旧任务不会自动导入/)).toBeInTheDocument();
  });
});
