import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolvePersonalSpace: vi.fn(),
  list: vi.fn(),
  createMany: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth")>();
  return { ...original, resolvePersonalSpace: mocks.resolvePersonalSpace };
});

vi.mock("@/features/tasks/server-repository", () => ({
  postgresTaskRepository: {
    list: mocks.list,
    createMany: mocks.createMany,
    update: mocks.update,
    delete: mocks.delete,
  },
}));

import { GET, POST } from "./route";
import { DELETE, PATCH } from "./[id]/route";

const taskId = "11111111-1111-4111-8111-111111111111";
const task = {
  id: taskId,
  title: "任务",
  labels: [],
  completed: false,
  createdAt: "2026-11-09T00:00:00Z",
  updatedAt: "2026-11-09T00:00:00Z",
};

function request(
  path = "/api/tasks",
  init: { method?: string; headers?: HeadersInit; body?: BodyInit } = {},
) {
  const headers = new Headers(init.headers);
  headers.set("cookie", "todo_space_session=browser-token");
  return new NextRequest(`https://todo.example${path}`, {
    method: init.method,
    headers,
    body: init.body,
  });
}

describe("任务 API 空间授权", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePersonalSpace.mockResolvedValue("space-a");
  });

  it("从 HttpOnly 会话解析空间并读取该空间任务", async () => {
    mocks.list.mockResolvedValue([task]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.resolvePersonalSpace).toHaveBeenCalledWith("browser-token");
    expect(mocks.list).toHaveBeenCalledWith("space-a");
  });

  it("未授权时不访问任务仓储", async () => {
    mocks.resolvePersonalSpace.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("批量创建只使用会话空间且最多接受十条", async () => {
    mocks.createMany.mockResolvedValue([task]);
    const response = await POST(
      request("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tasks: [{ title: "任务" }] }),
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.createMany).toHaveBeenCalledWith("space-a", [{ title: "任务" }]);
  });

  it("不能通过任务 ID 修改另一空间任务", async () => {
    mocks.update.mockResolvedValue(null);
    const response = await PATCH(
      request(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "越权修改" }),
      }),
      { params: Promise.resolve({ id: taskId }) },
    );
    expect(response.status).toBe(404);
    expect(mocks.update).toHaveBeenCalledWith("space-a", taskId, { title: "越权修改" });
  });

  it("删除只作用于会话空间", async () => {
    mocks.delete.mockResolvedValue(true);
    const response = await DELETE(request(`/api/tasks/${taskId}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: taskId }),
    });
    expect(response.status).toBe(204);
    expect(mocks.delete).toHaveBeenCalledWith("space-a", taskId);
  });
});
