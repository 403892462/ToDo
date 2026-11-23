import {
  normalizeTaskDuration,
  normalizeTaskTitle,
  type Task,
  type TaskChanges,
  type TaskDraft,
} from "./model";

export interface TaskStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface TaskRepository {
  list(): Task[];
  createMany(drafts: TaskDraft[]): Task[];
  create(draft: TaskDraft): Task;
  update(id: string, changes: TaskChanges): Task | null;
  setCompleted(id: string, completed: boolean): Task | null;
  delete(id: string): boolean;
  filterByLabel(label: string): Task[];
}

const STORAGE_KEY = "todo.tasks.v1";

export class LocalTaskRepository implements TaskRepository {
  constructor(
    private readonly storage: TaskStorage,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  list(): Task[] {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Task[]) : [];
  }

  create(draft: TaskDraft): Task {
    const timestamp = this.now();
    const task: Task = {
      id: this.createId(),
      title: normalizeTaskTitle(draft.title),
      dueAt: draft.dueAt,
      durationMinutes: normalizeTaskDuration(draft.durationMinutes),
      parentId: draft.parentId,
      labels: [...(draft.labels ?? [])],
      priority: draft.priority,
      completed: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.save([...this.list(), task]);
    return task;
  }

  createMany(drafts: TaskDraft[]): Task[] {
    return drafts.map((draft) => this.create(draft));
  }

  update(id: string, changes: TaskChanges): Task | null {
    const tasks = this.list();
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) return null;
    const current = tasks[index];
    const updated: Task = {
      ...current,
      ...changes,
      title: changes.title === undefined ? current.title : normalizeTaskTitle(changes.title),
      durationMinutes:
        changes.durationMinutes === undefined
          ? current.durationMinutes
          : normalizeTaskDuration(changes.durationMinutes),
      labels: changes.labels === undefined ? current.labels : [...changes.labels],
      updatedAt: this.now(),
    };
    const next = [...tasks];
    next[index] = updated;
    this.save(next);
    return updated;
  }

  setCompleted(id: string, completed: boolean): Task | null {
    const tasks = this.list();
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) return null;
    const updated = { ...tasks[index], completed, updatedAt: this.now() };
    const next = [...tasks];
    next[index] = updated;
    this.save(next);
    return updated;
  }

  delete(id: string): boolean {
    const tasks = this.list();
    const next = tasks.filter((task) => task.id !== id);
    if (next.length === tasks.length) return false;
    this.save(next);
    return true;
  }

  filterByLabel(label: string): Task[] {
    return this.list().filter((task) => task.labels.includes(label));
  }

  private save(tasks: Task[]) {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }
}
