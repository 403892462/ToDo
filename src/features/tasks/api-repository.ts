import type { Task, TaskChanges, TaskDraft } from "./model";

export interface TaskDataRepository {
  list(): Task[] | Promise<Task[]>;
  createMany(drafts: TaskDraft[]): Task[] | Promise<Task[]>;
  create(draft: TaskDraft): Task | Promise<Task>;
  update(id: string, changes: TaskChanges & { completed?: boolean }): Task | null | Promise<Task | null>;
  setCompleted(id: string, completed: boolean): Task | null | Promise<Task | null>;
  delete(id: string): boolean | void | Promise<boolean | void>;
}

export class TaskPersistenceError extends Error {
  constructor() {
    super("任务保存失败，请稍后重试");
    this.name = "TaskPersistenceError";
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new TaskPersistenceError();
  return response.json() as Promise<T>;
}

export class ApiTaskRepository implements TaskDataRepository {
  constructor(
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async list(): Promise<Task[]> {
    const response = await this.fetcher("/api/tasks", { cache: "no-store" });
    return readJson<Task[]>(response);
  }

  async createMany(drafts: TaskDraft[]): Promise<Task[]> {
    const response = await this.fetcher("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tasks: drafts }),
    });
    return readJson<Task[]>(response);
  }

  async create(draft: TaskDraft): Promise<Task> {
    return (await this.createMany([draft]))[0];
  }

  async update(id: string, changes: TaskChanges & { completed?: boolean }): Promise<Task> {
    const response = await this.fetcher(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(changes),
    });
    return readJson<Task>(response);
  }

  async setCompleted(id: string, completed: boolean): Promise<Task> {
    return this.update(id, { completed });
  }

  async delete(id: string): Promise<void> {
    const response = await this.fetcher(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) throw new TaskPersistenceError();
  }
}
