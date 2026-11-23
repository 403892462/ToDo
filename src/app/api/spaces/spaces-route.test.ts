import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  createPersonalSpace: vi.fn(),
  restorePersonalSpace: vi.fn(),
  resolvePersonalSpace: vi.fn(),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...original,
    createPersonalSpace: authMocks.createPersonalSpace,
    restorePersonalSpace: authMocks.restorePersonalSpace,
    resolvePersonalSpace: authMocks.resolvePersonalSpace,
  };
});

import { GET as getSpace, POST as createSpace } from "./route";
import { POST as recoverSpace } from "./recover/route";
import { SpaceRestoreRateLimitedError } from "@/lib/auth";

describe("个人空间 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("只在服务端会话有效时返回当前空间", async () => {
    authMocks.resolvePersonalSpace.mockResolvedValue("space-1");
    const request = new NextRequest("https://todo.example/api/spaces", {
      headers: { cookie: "todo_space_session=session-secret" },
    });
    const response = await getSpace(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ spaceId: "space-1" });
    expect(authMocks.resolvePersonalSpace).toHaveBeenCalledWith("session-secret");
  });

  it("无有效会话时返回未授权", async () => {
    authMocks.resolvePersonalSpace.mockResolvedValue(null);
    const response = await getSpace(new NextRequest("https://todo.example/api/spaces"));
    expect(response.status).toBe(401);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("创建空间后只在响应体展示一次访问码并设置安全会话 Cookie", async () => {
    authMocks.createPersonalSpace.mockResolvedValue({
      spaceId: "space-1",
      accessCode: "TD-one-time-code",
      sessionToken: "session-secret",
      sessionExpiresAt: new Date("2026-12-09T00:00:00Z"),
    });

    const response = await createSpace();
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ spaceId: "space-1", accessCode: "TD-one-time-code" });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("todo_space_session=session-secret");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=strict");
    expect(cookie).not.toContain("TD-one-time-code");
  });

  it("创建失败时不设置 Cookie 且不返回访问码", async () => {
    authMocks.createPersonalSpace.mockRejectedValue(new Error("database secret"));
    const response = await createSpace();
    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(JSON.stringify(await response.json())).not.toContain("database secret");
  });

  it("生产环境会话 Cookie 强制使用 Secure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    authMocks.createPersonalSpace.mockResolvedValue({
      spaceId: "space-1",
      accessCode: "TD-one-time-code",
      sessionToken: "session-secret",
      sessionExpiresAt: new Date("2026-12-09T00:00:00Z"),
    });

    const response = await createSpace();
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("恢复成功后设置当前空间会话", async () => {
    authMocks.restorePersonalSpace.mockResolvedValue({
      spaceId: "space-1",
      sessionToken: "restored-session",
      sessionExpiresAt: new Date("2026-12-09T00:00:00Z"),
    });
    const request = new NextRequest("https://todo.example/api/spaces/recover", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "198.51.100.8", "user-agent": "mobile" },
      body: JSON.stringify({ accessCode: "TD-valid-access-code-value-123456789" }),
    });

    const response = await recoverSpace(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("todo_space_session=restored-session");
    expect(authMocks.restorePersonalSpace).toHaveBeenCalledWith({
      accessCode: "TD-valid-access-code-value-123456789",
      attemptSubject: "198.51.100.8|mobile",
    });
  });

  it("格式错误的访问码使用统一失败响应", async () => {
    const request = new NextRequest("https://todo.example/api/spaces/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessCode: "short" }),
    });
    const response = await recoverSpace(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "无法恢复个人空间" });
    expect(authMocks.restorePersonalSpace).not.toHaveBeenCalled();
  });

  it("恢复尝试被锁定时返回 429", async () => {
    authMocks.restorePersonalSpace.mockRejectedValue(new SpaceRestoreRateLimitedError());
    const request = new NextRequest("https://todo.example/api/spaces/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessCode: "TD-valid-access-code-value-123456789" }),
    });

    const response = await recoverSpace(request);
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "尝试次数过多，请稍后重试" });
  });
});
