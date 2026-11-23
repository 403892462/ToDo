import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schemaPath = resolve(process.cwd(), "db/001_initial.sql");

describe("PostgreSQL 初始化脚本", () => {
  it("使用事务并为 v1.3 所需表提供幂等创建语句", async () => {
    const sql = await readFile(schemaPath, "utf8");
    const requiredTables = [
      "spaces",
      "access_credentials",
      "space_sessions",
      "tasks",
      "admin_sessions",
      "authentication_attempts",
      "recovery_audits",
    ];

    expect(sql).toMatch(/^BEGIN;/);
    expect(sql).toMatch(/COMMIT;\s*$/);
    for (const table of requiredTables) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it("通过空间外键和唯一活动凭证约束支持数据隔离", async () => {
    const sql = await readFile(schemaPath, "utf8");

    expect(sql).toContain("space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE");
    expect(sql).toContain("access_credentials_one_active_per_space");
    expect(sql).toContain("WHERE revoked_at IS NULL");
  });

  it("为所有表和字段提供中文备注", async () => {
    const sql = await readFile(schemaPath, "utf8");
    const tableColumns = {
      spaces: ["id", "created_at"],
      access_credentials: ["id", "space_id", "secret_hash", "created_at", "revoked_at"],
      space_sessions: ["id", "space_id", "token_hash", "created_at", "expires_at", "revoked_at"],
      tasks: [
        "id",
        "space_id",
        "title",
        "scheduled_at",
        "duration_minutes",
        "parent_id",
        "priority",
        "tags",
        "completed",
        "created_at",
        "updated_at",
      ],
      admin_sessions: ["id", "token_hash", "created_at", "expires_at", "revoked_at"],
      authentication_attempts: [
        "scope",
        "subject_hash",
        "failure_count",
        "window_started_at",
        "locked_until",
      ],
      recovery_audits: ["id", "target_space_id", "attempted_space_id", "result", "occurred_at"],
    } as const;

    for (const [table, columns] of Object.entries(tableColumns)) {
      expect(sql).toMatch(new RegExp(`COMMENT ON TABLE ${table} IS '[^']*[\\u4e00-\\u9fff][^']*';`));
      for (const column of columns) {
        expect(sql).toMatch(
          new RegExp(`COMMENT ON COLUMN ${table}\\.${column} IS '[^']*[\\u4e00-\\u9fff][^']*';`),
        );
      }
    }
  });
});
