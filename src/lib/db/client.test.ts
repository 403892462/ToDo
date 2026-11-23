import type { Pool, PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeDatabasePool,
  DatabaseOperationError,
  getDatabasePool,
  withTransaction,
} from "./client";

afterEach(async () => {
  await closeDatabasePool();
});

describe("database client", () => {
  it("在服务端运行期间复用连接池", () => {
    const pool = { end: vi.fn() } as unknown as Pool;
    const factory = vi.fn(() => pool);

    expect(getDatabasePool(factory)).toBe(pool);
    expect(getDatabasePool(factory)).toBe(pool);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("事务成功时提交并释放连接", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const release = vi.fn();
    const client = { query, release } as unknown as PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(client), end: vi.fn() } as unknown as Pool;
    getDatabasePool(() => pool);

    await expect(withTransaction(async () => "saved")).resolves.toBe("saved");
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "COMMIT"]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("事务失败时回滚并隐藏底层连接错误", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const release = vi.fn();
    const client = { query, release } as unknown as PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(client), end: vi.fn() } as unknown as Pool;
    getDatabasePool(() => pool);

    await expect(
      withTransaction(async () => {
        throw new Error("password=must-not-leak");
      }),
    ).rejects.toEqual(new DatabaseOperationError());
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "ROLLBACK"]);
    expect(release).toHaveBeenCalledOnce();
  });
});
