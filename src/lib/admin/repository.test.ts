import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ queryDatabase: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/db", () => db);

import { postgresAdminRepository } from "./repository";

describe("管理员恢复事务仓储", () => {
  it("目标存在时先锁定空间、撤销旧码、写入新码和成功审计", async () => {
    const client = { query: vi.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [{ id: "space-1" }] })
      .mockResolvedValue({ rows: [] });
    db.withTransaction.mockImplementation(async (operation) => operation(client));

    await expect(postgresAdminRepository.resetSpaceAccessCode({
      auditId: "audit-1",
      credentialId: "credential-1",
      spaceId: "space-1",
      accessCodeHash: "hash",
    })).resolves.toBe(true);

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      "SELECT id FROM spaces WHERE id = $1 FOR UPDATE",
      expect.stringContaining("UPDATE access_credentials SET revoked_at = now()"),
      expect.stringContaining("INSERT INTO access_credentials"),
      expect.stringContaining("INSERT INTO recovery_audits"),
    ]);
  });

  it("目标不存在时只记录失败审计，不撤销任何访问码", async () => {
    const client = { query: vi.fn() };
    client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValue({ rows: [] });
    db.withTransaction.mockImplementation(async (operation) => operation(client));

    await expect(postgresAdminRepository.resetSpaceAccessCode({
      auditId: "audit-1",
      credentialId: "credential-1",
      spaceId: "missing",
      accessCodeHash: "hash",
    })).resolves.toBe(false);
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[1][0]).toContain("space_not_found");
  });
});
