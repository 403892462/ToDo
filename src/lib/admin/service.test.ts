import { describe, expect, it, vi } from "vitest";

import { hashAdminPassword, generateTotp } from "./crypto";
import {
  AdminAuthenticationError,
  authenticateAdmin,
  hasAdminSession,
  resetSpaceAccessCode,
} from "./service";
import type { AdminRepository } from "./types";

function repository(overrides: Partial<AdminRepository> = {}): AdminRepository {
  return {
    getLockedUntil: vi.fn().mockResolvedValue(null),
    recordLoginFailure: vi.fn().mockResolvedValue(undefined),
    clearLoginFailures: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue(undefined),
    hasValidSession: vi.fn().mockResolvedValue(false),
    resetSpaceAccessCode: vi.fn().mockResolvedValue(true),
    recordDatabaseFailure: vi.fn().mockResolvedValue(undefined),
    listAudits: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

const pepper = "test-pepper-with-at-least-32-characters";
const totpSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const now = new Date(59_000);

async function config() {
  return { username: "admin", passwordHash: await hashAdminPassword("Strong!Password123"), totpSecret };
}

describe("管理员服务", () => {
  it("三要素全部正确才建立哈希会话", async () => {
    const repo = repository();
    const result = await authenticateAdmin({
      username: "admin",
      password: "Strong!Password123",
      totp: generateTotp(totpSecret, now.getTime()),
      attemptSubject: "198.51.100.8|browser",
      repository: repo,
      config: await config(),
      pepper,
      now,
    });

    expect(result.token).toBeTruthy();
    expect(repo.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    );
    expect(JSON.stringify(vi.mocked(repo.createSession).mock.calls[0][0])).not.toContain(result.token);
    expect(repo.clearLoginFailures).toHaveBeenCalledOnce();
  });

  it.each([
    ["错误用户名", "other", "Strong!Password123", generateTotp(totpSecret, now.getTime())],
    ["错误密码", "admin", "wrong", generateTotp(totpSecret, now.getTime())],
    ["错误动态码", "admin", "Strong!Password123", "000000"],
  ])("%s 时拒绝并记录失败", async (_, username, password, totp) => {
    const repo = repository();
    await expect(authenticateAdmin({ username, password, totp, attemptSubject: "source", repository: repo, config: await config(), pepper, now }))
      .rejects.toBeInstanceOf(AdminAuthenticationError);
    expect(repo.createSession).not.toHaveBeenCalled();
    expect(repo.recordLoginFailure).toHaveBeenCalledOnce();
  });

  it("锁定期间不再校验三要素", async () => {
    const repo = repository({ getLockedUntil: vi.fn().mockResolvedValue(new Date(120_000)) });
    await expect(authenticateAdmin({ username: "admin", password: "x", totp: "000000", attemptSubject: "source", repository: repo, config: await config(), pepper, now }))
      .rejects.toMatchObject({ rateLimited: true });
    expect(repo.recordLoginFailure).not.toHaveBeenCalled();
  });

  it("管理会话解析只向仓储提交令牌哈希", async () => {
    const repo = repository({ hasValidSession: vi.fn().mockResolvedValue(true) });
    await expect(hasAdminSession("raw-admin-token", repo)).resolves.toBe(true);
    expect(repo.hasValidSession).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(repo.hasValidSession).not.toHaveBeenCalledWith("raw-admin-token");
  });

  it("成功重置仅返回新访问码并向仓储提交哈希", async () => {
    const repo = repository();
    const accessCode = await resetSpaceAccessCode({ spaceId: "space-1", repository: repo, pepper });
    expect(accessCode).toMatch(/^TD-/);
    const stored = vi.mocked(repo.resetSpaceAccessCode).mock.calls[0][0];
    expect(stored.accessCodeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(accessCode ?? "missing");
  });

  it("目标空间不存在时不返回新访问码", async () => {
    const repo = repository({ resetSpaceAccessCode: vi.fn().mockResolvedValue(false) });
    await expect(resetSpaceAccessCode({ spaceId: "missing", repository: repo, pepper })).resolves.toBeNull();
  });

  it("数据库事务失败时尝试记录失败审计并继续抛错", async () => {
    const repo = repository({ resetSpaceAccessCode: vi.fn().mockRejectedValue(new Error("database failed")) });
    await expect(resetSpaceAccessCode({ spaceId: "space-1", repository: repo, pepper })).rejects.toThrow();
    expect(repo.recordDatabaseFailure).toHaveBeenCalledWith(expect.any(String), "space-1");
  });
});
