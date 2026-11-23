import { describe, expect, it } from "vitest";

import { DatabaseConfigurationError, readDatabaseConfig } from "./config";

describe("readDatabaseConfig", () => {
  it("读取 PostgreSQL 17 用户名密码连接配置", () => {
    expect(
      readDatabaseConfig({
        DATABASE_HOST: "127.0.0.1",
        DATABASE_PORT: "5432",
        DATABASE_NAME: "todo",
        DATABASE_USER: "todo_app",
        DATABASE_PASSWORD: "not-logged-secret",
        DATABASE_SSL: "false",
      }),
    ).toEqual({
      host: "127.0.0.1",
      port: 5432,
      database: "todo",
      user: "todo_app",
      password: "not-logged-secret",
      ssl: false,
    });
  });

  it("缺少密码时只返回不含配置值的安全错误", () => {
    expect(() =>
      readDatabaseConfig({
        DATABASE_HOST: "127.0.0.1",
        DATABASE_NAME: "todo",
        DATABASE_USER: "todo_app",
      }),
    ).toThrow(DatabaseConfigurationError);

    try {
      readDatabaseConfig({ DATABASE_PASSWORD: "sensitive-value" });
    } catch (error) {
      expect(String(error)).not.toContain("sensitive-value");
    }
  });
});
