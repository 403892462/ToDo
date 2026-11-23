import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  isAdminRequest: vi.fn(),
  resetSpaceAccessCode: vi.fn(),
  listRecoveryAudits: vi.fn(),
}));

vi.mock("@/lib/admin", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/admin")>();
  return {
    ...original,
    authenticateAdmin: mocks.authenticateAdmin,
    isAdminRequest: mocks.isAdminRequest,
    resetSpaceAccessCode: mocks.resetSpaceAccessCode,
    listRecoveryAudits: mocks.listRecoveryAudits,
  };
});

import { POST as login } from "./session/route";
import { POST as reset } from "./access-codes/reset/route";
import { GET as audits } from "./audits/route";

function jsonRequest(path: string, body: unknown) {
  return new NextRequest(`https://todo.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "198.51.100.8" },
    body: JSON.stringify(body),
  });
}

describe("管理员 API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("三要素验证成功后设置 HttpOnly 管理会话", async () => {
    mocks.authenticateAdmin.mockResolvedValue({ token: "admin-session-secret", expiresAt: new Date() });
    const response = await login(jsonRequest("/api/admin/session", {
      username: "admin",
      password: "strong-password",
      totp: "123456",
    }));

    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("todo_admin_session=admin-session-secret");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=strict");
  });

  it("未验证管理会话不能重置访问码", async () => {
    mocks.isAdminRequest.mockResolvedValue(false);
    const response = await reset(jsonRequest("/api/admin/access-codes/reset", {
      spaceId: "11111111-1111-4111-8111-111111111111",
      confirmed: true,
    }));
    expect(response.status).toBe(401);
    expect(mocks.resetSpaceAccessCode).not.toHaveBeenCalled();
  });

  it("确认后重置并仅返回一次新访问码", async () => {
    mocks.isAdminRequest.mockResolvedValue(true);
    mocks.resetSpaceAccessCode.mockResolvedValue("TD-new-code");
    const response = await reset(jsonRequest("/api/admin/access-codes/reset", {
      spaceId: "11111111-1111-4111-8111-111111111111",
      confirmed: true,
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accessCode: "TD-new-code" });
  });

  it("审计接口只返回允许字段且要求管理会话", async () => {
    mocks.isAdminRequest.mockResolvedValue(true);
    mocks.listRecoveryAudits.mockResolvedValue([{
      id: "audit-1",
      targetSpaceId: "space-1",
      attemptedSpaceId: "space-1",
      result: "succeeded",
      occurredAt: "2026-11-09T00:00:00.000Z",
    }]);
    const response = await audits(new NextRequest("https://todo.example/api/admin/audits"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body[0]).toEqual(expect.objectContaining({ result: "succeeded", attemptedSpaceId: "space-1" }));
    expect(JSON.stringify(body)).not.toMatch(/password|totp|secret|accessCode/i);
  });
});
