"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ApiTaskRepository, type TaskDataRepository } from "../api-repository";
import type { Task, TaskPriority } from "../model";
import { requestTaskParse, type ClientParseResult } from "../task-parse-client";
import { requestTaskBreakdown } from "../task-breakdown-client";
import { findEarliestAvailableSlot, getTaskInterval } from "../scheduling";
import { TodayView } from "./today-view";

const inputClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100";

const CONSENT_KEY = "todo.ai-consent.v1";

const priorityLabels: Record<TaskPriority, string> = { low: "低", medium: "中", high: "高" };

function Modal({ label, onClose, children, className = "z-20 grid place-items-center p-4" }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("keydown", closeOnEscape); previous?.focus(); };
  }, []);
  return <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className={`fixed inset-0 bg-black/30 outline-none ${className}`}>{children}</div>;
}

export function TaskApp({
  parseTask = requestTaskParse,
  breakDownTask = requestTaskBreakdown,
  repository: providedRepository,
}: {
  parseTask?: (text: string) => Promise<ClientParseResult>;
  breakDownTask?: (title: string) => Promise<string[]>;
  repository?: TaskDataRepository;
}) {
  const repository = useRef<TaskDataRepository>(providedRepository ?? new ApiTaskRepository());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);
  const [actionTask, setActionTask] = useState<Task | null>(null);
  const [focusTask, setFocusTask] = useState<Task | null>(null);
  const [focusSeconds, setFocusSeconds] = useState(25 * 60);
  const [focusRunning, setFocusRunning] = useState(false);
  const [breakdownPreview, setBreakdownPreview] = useState<{ parent: Task; titles: string[] } | null>(null);

  useEffect(() => {
    let active = true;
    Promise.resolve(repository.current.list())
      .then((loadedTasks) => {
        if (active) setTasks(loadedTasks);
      })
      .catch(() => {
        if (active) setError("任务读取失败，请稍后重试");
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!focusTask || !focusRunning) return;
    const timer = window.setInterval(() => setFocusSeconds((value) => value > 0 ? value - 1 : 0), 1000);
    return () => window.clearInterval(timer);
  }, [focusTask, focusRunning]);

  const labels = useMemo(
    () => [...new Set(tasks.flatMap((task) => task.labels))].sort((a, b) => a.localeCompare(b)),
    [tasks],
  );
  const visibleTasks = selectedLabel
    ? tasks.filter((task) => task.labels.includes(selectedLabel))
    : tasks;
  const backlogTasks = tasks.filter((task) => getTaskInterval(task) === null);

  async function toggleTask(task: Task) {
    setNotice(null);
    setError(null);
    try {
      const updated = await repository.current.setCompleted(task.id, !task.completed);
      if (updated) setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch {
      setError("保存失败，任务状态未被修改");
    }
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    try {
      setNotice(null);
      const updated = await repository.current.update(editing.id, {
        title: String(form.get("title") ?? ""),
        dueAt: String(form.get("dueAt") ?? "").trim(),
        labels: String(form.get("labels") ?? "")
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean),
        priority: (String(form.get("priority") ?? "") || undefined) as TaskPriority | undefined,
      });
      if (!updated) throw new Error("task not found");
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditing(null);
      setError(null);
    } catch {
      setError("保存失败，原任务未被修改");
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await repository.current.delete(deleting.id);
      setTasks((current) => current.filter((task) => task.id !== deleting.id));
      setNotice(null);
      setDeleting(null);
      setError(null);
    } catch {
      setError("删除失败，任务仍然保留");
    }
  }

  async function scheduleToday(task: Task) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const slot = findEarliestAvailableSlot(tasks.filter((item) => item.id !== task.id), start);
    if (!slot) {
      setNotice("今天没有可用时间段");
      return;
    }
    try {
      const updated = await repository.current.update(task.id, { dueAt: slot.toISOString(), durationMinutes: 60 });
      if (!updated) throw new Error("task not found");
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice(`已将“${task.title}”安排到今天`);
      setPoolOpen(false);
      setError(null);
    } catch {
      setError("保存失败，任务尚未安排");
    }
  }

  function startFocus(task: Task) {
    setActionTask(null);
    setFocusTask(task);
    setFocusSeconds(25 * 60);
    setFocusRunning(true);
  }

  async function finishFocus() {
    if (!focusTask) return;
    try {
      const updated = await repository.current.setCompleted(focusTask.id, true);
      if (!updated) throw new Error("task not found");
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
      setFocusTask(null);
      setFocusRunning(false);
      setNotice("专注完成，任务已标记完成");
      setError(null);
    } catch {
      setError("保存失败，任务尚未标记完成");
    }
  }

  async function shiftTask(task: Task, days: number, hours: number) {
    if (!task.dueAt) return;
    const shifted = new Date(new Date(task.dueAt).getTime() + (days * 24 + hours) * 60 * 60_000);
    try {
      const updated = await repository.current.update(task.id, { dueAt: shifted.toISOString() });
      if (!updated) throw new Error("task not found");
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
      setActionTask(null);
      setNotice(days ? "任务已推迟到明天" : "任务已顺延 1 小时");
      setError(null);
    } catch {
      setError("保存失败，任务时间未被修改");
    }
  }

  async function previewBreakdown(task: Task) {
    setActionTask(null);
    try { setBreakdownPreview({ parent: task, titles: await breakDownTask(task.title) }); }
    catch { setNotice("AI 拆解失败"); }
  }

  async function confirmBreakdown() {
    if (!breakdownPreview) return;
    try {
      const created = await repository.current.createMany(
        breakdownPreview.titles.map((title) => ({ title, parentId: breakdownPreview.parent.id })),
      );
      setTasks((current) => [...current, ...created]);
      setBreakdownPreview(null);
      setNotice("已创建子任务");
      setError(null);
    } catch {
      setError("保存失败，未创建子任务");
    }
  }

  async function createTask(rawText: string) {
    setCreating(true);
    setError(null);
    let drafts;
    let nextNotice: string;
    try {
      const result = await parseTask(rawText);
      if (result.status === "parsed") {
        drafts = result.tasks;
        if (result.truncated && result.partial) {
          nextNotice = "已创建前 10 条任务，其余任务未创建；部分任务未识别";
        } else if (result.truncated) {
          nextNotice = "已创建前 10 条任务，其余任务未创建";
        } else if (result.partial) {
          nextNotice = `已创建 ${result.tasks.length} 条任务，部分任务未识别`;
        } else {
          nextNotice = `已创建 ${result.tasks.length} 条任务`;
        }
      } else {
        drafts = [{ title: rawText }];
        nextNotice = "AI 解析失败";
      }
    } catch {
      drafts = [{ title: rawText }];
      nextNotice = "AI 解析失败";
    }

    try {
      const created = await repository.current.createMany(drafts);
      setTasks((current) => [...current, ...created]);
      setNotice(nextNotice);
      setText("");
    } catch {
      setNotice(null);
      setError("任务保存失败，请稍后重试");
    } finally {
      setCreating(false);
    }
  }

  function submitTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const normalized = text.trim();
    if (!normalized) {
      setError("请输入任务内容");
      return;
    }
    if (window.localStorage.getItem(CONSENT_KEY) !== "accepted") {
      setPendingText(normalized);
      return;
    }
    void createTask(normalized);
  }

  function acceptConsent() {
    if (!pendingText) return;
    window.localStorage.setItem(CONSENT_KEY, "accepted");
    const value = pendingText;
    setPendingText(null);
    void createTask(value);
  }

  if (!loaded) {
    return <p className="text-sm text-slate-500">正在读取个人空间任务…</p>;
  }

  return (
    <section className="space-y-4" aria-label="任务管理">
      <TodayView tasks={tasks} onOpenTask={setActionTask} onStartFocus={startFocus} />
      <form onSubmit={submitTask} className="sticky bottom-3 z-10 space-y-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
        <label className="block space-y-2 text-sm font-medium">
          <span>闪念收集箱</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={creating}
            placeholder="例如：明天下午3点跟老张对齐代码 #工作 !重要"
            className="min-h-24 w-full resize-none rounded-xl border border-slate-200 p-3 text-sm font-normal outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
          />
        </label>
        <Button className="w-full" type="submit" disabled={creating}>
          {creating ? "正在解析…" : "创建任务"}
        </Button>
      </form>

      <button type="button" onClick={() => setPoolOpen(true)} className="flex w-full items-center justify-between rounded-2xl bg-white px-5 py-4 text-left shadow-sm" aria-label={`打开任务池，共 ${backlogTasks.length} 项`}>
        <span className="font-medium">任务池</span><span className="text-sm text-slate-500">{backlogTasks.length} 项 · 上拉展开</span>
      </button>

      {notice && <div role="status" className="flex items-center justify-between gap-3 rounded-xl bg-slate-100 px-3 py-2 text-sm"><span>{notice}</span><button type="button" className="shrink-0 underline" onClick={() => setNotice(null)}>关闭</button></div>}
      {labels.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="标签筛选">
          <Button
            size="sm"
            variant={selectedLabel === null ? "default" : "outline"}
            onClick={() => setSelectedLabel(null)}
          >
            全部
          </Button>
          {labels.map((label) => (
            <Button
              key={label}
              size="sm"
              variant={selectedLabel === label ? "default" : "outline"}
              onClick={() => setSelectedLabel(label)}
            >
              {label}
            </Button>
          ))}
        </div>
      )}

      {visibleTasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="font-medium">{selectedLabel ? "没有匹配任务" : "还没有任务"}</p>
          <p className="mt-1 text-sm text-slate-500">
            {selectedLabel ? "请选择其他标签。" : "稍后可通过自然语言快速创建。"}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visibleTasks.map((task) => (
            <li key={task.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <input
                  aria-label={`切换“${task.title}”完成状态`}
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => void toggleTask(task)}
                  className="mt-1 h-5 w-5 rounded border-slate-300"
                />
                <div className="min-w-0 flex-1">
                  <p className={task.completed ? "break-words text-slate-400 line-through" : "break-words font-medium"}>
                    {task.title}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                    {task.dueAt && <span>{task.dueAt}</span>}
                    {task.priority && <span>优先级：{priorityLabels[task.priority]}</span>}
                    {task.labels.map((label) => (
                      <span key={label} className="rounded-full bg-slate-100 px-2 py-1">
                        #{label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => { setNotice(null); setEditing(task); }}>
                  编辑
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600"
                  onClick={() => { setNotice(null); setDeleting(task); }}
                >
                  删除
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {editing && (
        <Modal label="编辑任务" onClose={() => setEditing(null)} className="z-20 grid place-items-end p-4 sm:place-items-center">
          <form onSubmit={(event) => void saveEdit(event)} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">编辑任务</h2>
            <label className="block space-y-1 text-sm">
              <span>任务名</span>
              <input className={inputClass} name="title" defaultValue={editing.title} required />
            </label>
            <label className="block space-y-1 text-sm">
              <span>时间</span>
              <input className={inputClass} name="dueAt" defaultValue={editing.dueAt ?? ""} />
            </label>
            <label className="block space-y-1 text-sm">
              <span>标签（逗号分隔）</span>
              <input className={inputClass} name="labels" defaultValue={editing.labels.join(", ")} />
            </label>
            <label className="block space-y-1 text-sm">
              <span>优先级</span>
              <select className={inputClass} name="priority" defaultValue={editing.priority ?? ""}>
                <option value="">未设置</option>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>取消</Button>
              <Button type="submit">保存</Button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal label="确认删除" onClose={() => setDeleting(null)}>
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">确认删除</h2>
            <p className="text-sm text-slate-600">删除“{deleting.title}”后无法恢复。</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleting(null)}>取消</Button>
              <Button className="bg-red-600 hover:bg-red-700" onClick={() => void confirmDelete()}>永久删除</Button>
            </div>
          </div>
        </Modal>
      )}

      {pendingText && (
        <Modal label="AI 数据提示" onClose={() => setPendingText(null)}>
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">使用 AI 前请确认</h2>
            <p className="text-sm leading-6 text-slate-600">输入会发送给第三方大模型，请勿输入敏感数据。</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPendingText(null)}>拒绝</Button>
              <Button onClick={acceptConsent}>确认并继续</Button>
            </div>
          </div>
        </Modal>
      )}

      {poolOpen && (
        <Modal label="任务池" onClose={() => setPoolOpen(false)} className="z-20 grid place-items-end">
          <div className="max-h-[70vh] w-full max-w-md overflow-y-auto rounded-t-[2rem] bg-white p-5 shadow-xl">
            <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-slate-300" />
            <div className="flex items-center justify-between"><div><h2 className="text-xl font-semibold">任务池</h2><p className="mt-1 text-sm text-slate-500">没有时间的任务会先放在这里。</p></div><Button variant="outline" onClick={() => setPoolOpen(false)}>关闭</Button></div>
            {backlogTasks.length === 0 ? <p className="py-12 text-center text-sm text-slate-500">任务池为空</p> : <ul className="mt-5 divide-y divide-slate-100">{backlogTasks.map((task) => <li key={task.id} className="flex items-center justify-between gap-3 py-4"><span>{task.title}</span><Button size="sm" variant="outline" onClick={() => void scheduleToday(task)}>安排到今天</Button></li>)}</ul>}
          </div>
        </Modal>
      )}

      {actionTask && (
        <Modal label="任务快捷操作" onClose={() => setActionTask(null)} className="z-20 grid place-items-end">
          <div className="w-full max-w-md space-y-3 rounded-t-[2rem] bg-white p-5 shadow-xl"><div className="mx-auto h-1 w-12 rounded-full bg-slate-300"/><h2 className="text-lg font-semibold">{actionTask.title}</h2><Button className="w-full" onClick={() => startFocus(actionTask)}>开始专注 25:00</Button>{actionTask.dueAt && <><Button className="w-full" variant="outline" onClick={() => void shiftTask(actionTask, 0, 1)}>顺延 1 小时</Button><Button className="w-full" variant="outline" onClick={() => void shiftTask(actionTask, 1, 0)}>推迟到明天</Button></>}<Button className="w-full" variant="outline" onClick={() => void previewBreakdown(actionTask)}>AI 拆解</Button><Button className="w-full" variant="outline" onClick={() => { setEditing(actionTask); setActionTask(null); }}>编辑任务</Button><Button className="w-full" variant="outline" onClick={() => setActionTask(null)}>取消</Button></div>
        </Modal>
      )}

      {focusTask && (
        <Modal label="专注模式" onClose={() => { setFocusTask(null); setFocusRunning(false); }} className="z-30 grid place-items-center bg-slate-950/80 p-5 text-white">
          <div className="w-full max-w-sm text-center"><p className="text-sm text-slate-300">正在专注</p><h2 className="mt-2 text-2xl font-semibold">{focusTask.title}</h2><p className="my-10 text-7xl font-semibold tabular-nums">{String(Math.floor(focusSeconds / 60)).padStart(2, "0")}:{String(focusSeconds % 60).padStart(2, "0")}</p><div className="grid grid-cols-2 gap-3"><Button variant="outline" className="border-white/30 bg-transparent text-white" onClick={() => setFocusRunning((value) => !value)}>{focusRunning ? "暂停" : "继续"}</Button><Button onClick={() => void finishFocus()} className="bg-white text-slate-950 hover:bg-slate-100">完成任务</Button><Button variant="outline" className="col-span-2 border-white/30 bg-transparent text-white" onClick={() => { setFocusTask(null); setFocusRunning(false); }}>结束专注</Button></div></div>
        </Modal>
      )}
      {breakdownPreview && <Modal label="AI 拆解预览" onClose={() => setBreakdownPreview(null)} className="z-30 grid place-items-center p-5"><div className="w-full max-w-sm rounded-2xl bg-white p-5"><h2 className="text-lg font-semibold">AI 拆解预览</h2><p className="mt-1 text-sm text-slate-500">确认后将保留原任务并创建以下子任务。</p><ol className="my-5 list-decimal space-y-2 pl-5">{breakdownPreview.titles.map((title) => <li key={title}>{title}</li>)}</ol><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setBreakdownPreview(null)}>取消</Button><Button onClick={() => void confirmBreakdown()}>确认创建</Button></div></div></Modal>}
    </section>
  );
}
