import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import nextEnvironment from "@next/env";
import pg from "pg";

const { loadEnvConfig } = nextEnvironment;
loadEnvConfig(process.cwd());

const { Pool } = pg;
const required = ["DATABASE_HOST", "DATABASE_NAME", "DATABASE_USER", "DATABASE_PASSWORD"];
if (required.some((name) => !process.env[name])) {
  throw new Error("数据库服务端配置不完整");
}

const migrationPath = fileURLToPath(new URL("../db/001_initial.sql", import.meta.url));
const sql = await readFile(migrationPath, "utf8");
const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT || 5432),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : false,
  application_name: "todo-mobile-migration",
});

try {
  await pool.query(sql);
  console.log("PostgreSQL 初始化完成");
} catch (error) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "UNKNOWN";
  const message = error instanceof Error ? error.message : "未知错误";
  throw new Error(`PostgreSQL 初始化失败（${code}）：${message}`);
} finally {
  await pool.end();
}
