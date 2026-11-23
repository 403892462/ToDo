import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  queryDatabase: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock("@/lib/db", () => databaseMocks);

import { PostgresTaskRepository } from "./server-repository";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "空间任务",
  scheduled_at: null,
  duration_minutes: null,
  parent_id: null,
  tags: ["工作"],
  priority: "high",
  completed: false,
  created_at: "2026-11-09T00:00:00Z",
  updated_at: "2026-11-09T00:00:00Z",
};

describe("PostgresTaskRepository 空间隔离", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("列表查询始终按服务端空间过滤", async () => {
    databaseMocks.queryDatabase.mockResolvedValue({ rows: [row], rowCount: 1 });
    const result = await new PostgresTaskRepository().list("space-a");

    expect(result[0]).toEqual(expect.objectContaining({ title: "空间任务", labels: ["工作"] }));
    expect(databaseMocks.queryDatabase).toHaveBeenCalledWith(
      expect.stringContaining("WHERE space_id = $1"),
      ["space-a"],
    );
  });

  it("更新和删除同时匹配任务 ID 与空间 ID", async () => {
    databaseMocks.queryDatabase
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const repository = new PostgresTaskRepository();

    await repository.update("space-a", row.id, { completed: true });
    await repository.delete("space-a", row.id);

    expect(databaseMocks.queryDatabase.mock.calls[0]).toEqual([
      expect.stringContaining("WHERE id = $1 AND space_id = $2"),
      [row.id, "space-a", true],
    ]);
    expect(databaseMocks.queryDatabase.mock.calls[1]).toEqual([
      "DELETE FROM tasks WHERE id = $1 AND space_id = $2",
      [row.id, "space-a"],
    ]);
  });

  it("批量创建在一个事务内并限制父任务属于同一空间", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [row] }) };
    databaseMocks.withTransaction.mockImplementation(async (operation) => operation(client));
    const parentId = "22222222-2222-4222-8222-222222222222";

    await new PostgresTaskRepository().createMany("space-a", [
      { title: "子任务", parentId },
      { title: "第二项" },
    ]);

    expect(databaseMocks.withTransaction).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[0][0]).toContain("SELECT id FROM tasks WHERE id = $5 AND space_id = $1");
    expect(client.query.mock.calls[0][1][0]).toBe("space-a");
  });
});
