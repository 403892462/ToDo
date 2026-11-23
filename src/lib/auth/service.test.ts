import { describe, expect, it, vi } from "vitest";

import {
  createPersonalSpace,
  resolvePersonalSpace,
  restorePersonalSpace,
  SpaceRestoreRateLimitedError,
  SpaceRestoreRejectedError,
} from "./service";
import type { SpaceAuthRepository } from "./types";

function createRepository(overrides: Partial<SpaceAuthRepository> = {}): SpaceAuthRepository {
  return {
    createSpace: vi.fn().mockResolvedValue(undefined),
    findSpaceIdByAccessCodeHash: vi.fn().mockResolvedValue(null),
    createSpaceSession: vi.fn().mockResolvedValue(undefined),
    findSpaceIdBySessionTokenHash: vi.fn().mockResolvedValue(null),
    getLockedUntil: vi.fn().mockResolvedValue(null),
    recordRestoreFailure: vi.fn().mockResolvedValue(undefined),
    clearRestoreFailures: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const pepper = "test-pepper-with-at-least-32-characters";

describe("个人空间授权服务", () => {
  it("创建空间时只把访问码校验值和会话哈希交给仓储", async () => {
    const repository = createRepository();
    const result = await createPersonalSpace({ repository, pepper, now: new Date("2026-11-09T00:00:00Z") });

    expect(result.accessCode).toMatch(/^TD-[A-Za-z0-9_-]{32}$/);
    expect(result.spaceId).toMatch(/^[0-9a-f-]{36}$/);
    const stored = vi.mocked(repository.createSpace).mock.calls[0][0];
    expect(stored.accessCodeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.sessionTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(result.accessCode);
    expect(JSON.stringify(stored)).not.toContain(result.sessionToken);
  });

  it("访问码有效时创建新浏览器会话并清除失败状态", async () => {
    const repository = createRepository({
      findSpaceIdByAccessCodeHash: vi.fn().mockResolvedValue("space-1"),
    });
    const result = await restorePersonalSpace({
      accessCode: "TD-valid-access-code-value-123456789",
      attemptSubject: "198.51.100.8|mobile",
      repository,
      pepper,
      now: new Date("2026-11-09T00:00:00Z"),
    });

    expect(result.spaceId).toBe("space-1");
    expect(repository.createSpaceSession).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "space-1", sessionTokenHash: expect.any(String) }),
    );
    expect(repository.clearRestoreFailures).toHaveBeenCalledOnce();
  });

  it("访问码无效时记录失败并返回统一错误", async () => {
    const repository = createRepository();

    await expect(
      restorePersonalSpace({
        accessCode: "TD-invalid-access-code-value-1234567",
        attemptSubject: "198.51.100.8|mobile",
        repository,
        pepper,
      }),
    ).rejects.toBeInstanceOf(SpaceRestoreRejectedError);
    expect(repository.recordRestoreFailure).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(repository.createSpaceSession).not.toHaveBeenCalled();
  });

  it("锁定期间不再验证访问码", async () => {
    const repository = createRepository({
      getLockedUntil: vi.fn().mockResolvedValue(new Date("2026-11-09T00:10:00Z")),
    });

    await expect(
      restorePersonalSpace({
        accessCode: "TD-any-access-code-value-1234567890",
        attemptSubject: "198.51.100.8|mobile",
        repository,
        pepper,
        now: new Date("2026-11-09T00:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(SpaceRestoreRateLimitedError);
    expect(repository.findSpaceIdByAccessCodeHash).not.toHaveBeenCalled();
  });

  it("只用会话令牌哈希解析当前空间", async () => {
    const repository = createRepository({
      findSpaceIdBySessionTokenHash: vi.fn().mockResolvedValue("space-2"),
    });
    await expect(resolvePersonalSpace("raw-session-token", repository)).resolves.toBe("space-2");
    expect(repository.findSpaceIdBySessionTokenHash).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(repository.findSpaceIdBySessionTokenHash).not.toHaveBeenCalledWith("raw-session-token");
  });
});
