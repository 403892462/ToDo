import type { PoolClient } from "pg";

import { queryDatabase, withTransaction } from "@/lib/db";

import {
  normalizeTaskDuration,
  normalizeTaskTitle,
  type Task,
  type TaskChanges,
  type TaskDraft,
} from "./model";

type TaskMutation = TaskChanges & { completed?: boolean };

type TaskRow = {
  id: string;
  title: string;
  scheduled_at: Date | string | null;
  duration_minutes: number | null;
  parent_id: string | null;
  tags: unknown;
  priority: Task["priority"] | null;
  completed: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    dueAt: row.scheduled_at ? toIso(row.scheduled_at) : undefined,
    durationMinutes: row.duration_minutes ?? undefined,
    parentId: row.parent_id ?? undefined,
    labels: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
    priority: row.priority ?? undefined,
    completed: row.completed,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const taskColumns = `id, title, scheduled_at, duration_minutes, parent_id, tags,
  priority, completed, created_at, updated_at`;

export class PostgresTaskRepository {
  async list(spaceId: string): Promise<Task[]> {
    const result = await queryDatabase<TaskRow>(
      `SELECT ${taskColumns}
         FROM tasks
        WHERE space_id = $1
        ORDER BY created_at ASC, id ASC`,
      [spaceId],
    );
    return result.rows.map(mapTask);
  }

  async createMany(spaceId: string, drafts: TaskDraft[]): Promise<Task[]> {
    return withTransaction(async (client) => {
      const tasks: Task[] = [];
      for (const draft of drafts) {
        tasks.push(await this.insert(client, spaceId, draft));
      }
      return tasks;
    });
  }

  async update(spaceId: string, taskId: string, changes: TaskMutation): Promise<Task | null> {
    const assignments: string[] = [];
    const values: unknown[] = [taskId, spaceId];
    const add = (column: string, value: unknown) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    if (changes.title !== undefined) add("title", normalizeTaskTitle(changes.title));
    if (changes.dueAt !== undefined) add("scheduled_at", changes.dueAt || null);
    if (changes.durationMinutes !== undefined) {
      add("duration_minutes", normalizeTaskDuration(changes.durationMinutes));
    }
    if (changes.labels !== undefined) add("tags", JSON.stringify(changes.labels));
    if (changes.priority !== undefined) add("priority", changes.priority || null);
    if (changes.completed !== undefined) add("completed", changes.completed);
    if (changes.parentId !== undefined) {
      values.push(changes.parentId || null);
      assignments.push(
        `parent_id = CASE WHEN $${values.length}::uuid IS NULL THEN NULL ELSE
          (SELECT id FROM tasks WHERE id = $${values.length} AND space_id = $2) END`,
      );
    }
    if (assignments.length === 0) return null;
    assignments.push("updated_at = now()");

    const result = await queryDatabase<TaskRow>(
      `UPDATE tasks
          SET ${assignments.join(", ")}
        WHERE id = $1 AND space_id = $2
        RETURNING ${taskColumns}`,
      values,
    );
    return result.rows[0] ? mapTask(result.rows[0]) : null;
  }

  async delete(spaceId: string, taskId: string): Promise<boolean> {
    const result = await queryDatabase(
      "DELETE FROM tasks WHERE id = $1 AND space_id = $2",
      [taskId, spaceId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async insert(client: PoolClient, spaceId: string, draft: TaskDraft): Promise<Task> {
    const result = await client.query<TaskRow>(
      `INSERT INTO tasks
         (id, space_id, title, scheduled_at, duration_minutes, parent_id, tags, priority)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4,
          CASE WHEN $5::uuid IS NULL THEN NULL ELSE
            (SELECT id FROM tasks WHERE id = $5 AND space_id = $1) END,
          $6::jsonb, $7)
       RETURNING ${taskColumns}`,
      [
        spaceId,
        normalizeTaskTitle(draft.title),
        draft.dueAt ?? null,
        normalizeTaskDuration(draft.durationMinutes) ?? null,
        draft.parentId ?? null,
        JSON.stringify(draft.labels ?? []),
        draft.priority ?? null,
      ],
    );
    return mapTask(result.rows[0]);
  }
}

export const postgresTaskRepository = new PostgresTaskRepository();
