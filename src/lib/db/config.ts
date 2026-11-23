import { z } from "zod";

const databaseEnvironmentSchema = z.object({
  DATABASE_HOST: z.string().trim().min(1),
  DATABASE_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DATABASE_NAME: z.string().trim().min(1),
  DATABASE_USER: z.string().trim().min(1),
  DATABASE_PASSWORD: z.string().min(1),
  DATABASE_SSL: z.enum(["true", "false"]).default("false"),
});

export type DatabaseConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: false | { rejectUnauthorized: true };
};

export function readDatabaseConfig(
  environment: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  const parsed = databaseEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new DatabaseConfigurationError();
  }

  return {
    host: parsed.data.DATABASE_HOST,
    port: parsed.data.DATABASE_PORT,
    database: parsed.data.DATABASE_NAME,
    user: parsed.data.DATABASE_USER,
    password: parsed.data.DATABASE_PASSWORD,
    ssl: parsed.data.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : false,
  };
}

export class DatabaseConfigurationError extends Error {
  constructor() {
    super("数据库服务端配置不完整");
    this.name = "DatabaseConfigurationError";
  }
}
