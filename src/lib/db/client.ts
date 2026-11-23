import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import { readDatabaseConfig } from "./config";

type PoolFactory = () => Pool;

const globalDatabase = globalThis as typeof globalThis & {
  todoDatabasePool?: Pool;
};

function createPool(): Pool {
  return new Pool({
    ...readDatabaseConfig(),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "todo-mobile",
  });
}

export function getDatabasePool(factory: PoolFactory = createPool): Pool {
  if (!globalDatabase.todoDatabasePool) {
    globalDatabase.todoDatabasePool = factory();
  }
  return globalDatabase.todoDatabasePool;
}

export class DatabaseOperationError extends Error {
  readonly code = "DATABASE_OPERATION_FAILED";

  constructor() {
    super("数据库操作失败，请稍后重试");
    this.name = "DatabaseOperationError";
  }
}

export async function queryDatabase<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<QueryResult<Row>> {
  try {
    return await getDatabasePool().query<Row>(text, [...values]);
  } catch {
    throw new DatabaseOperationError();
  }
}

export async function withTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  let client: PoolClient | undefined;
  try {
    client = await getDatabasePool().connect();
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the safe, caller-facing database error below.
      }
    }
    throw new DatabaseOperationError();
  } finally {
    client?.release();
  }
}

export async function closeDatabasePool(): Promise<void> {
  if (globalDatabase.todoDatabasePool) {
    await globalDatabase.todoDatabasePool.end();
    delete globalDatabase.todoDatabasePool;
  }
}
