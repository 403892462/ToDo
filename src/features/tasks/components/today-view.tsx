import { useRef } from "react";
import { AlertTriangle, Clock3, MoreHorizontal } from "lucide-react";
import type { Task } from "../model";
import { calculateLockedMinutes, findConflictingTaskIds, getTaskInterval } from "../scheduling";

const minutesInDay = 24 * 60;

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export function TodayView({ tasks, now = new Date(), onOpenTask, onStartFocus }: { tasks: Task[]; now?: Date; onOpenTask: (task: Task) => void; onStartFocus?: (task: Task) => void }) {
  const pointerStart = useRef<number | null>(null);
  const dayStart = startOfLocalDay(now);
  const dayEnd = new Date(dayStart.getTime() + minutesInDay * 60_000);
  const scheduled = tasks.filter((task) => {
    const interval = getTaskInterval(task);
    return interval && interval.start < dayEnd && interval.end > dayStart;
  }).sort((left, right) => new Date(left.dueAt!).getTime() - new Date(right.dueAt!).getTime());
  const lockedMinutes = calculateLockedMinutes(scheduled, dayStart);
  const conflicts = findConflictingTaskIds(scheduled);
  const percent = Math.min(100, (lockedMinutes / minutesInDay) * 100);
  const dateLabel = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(now);

  return <section aria-label="今日视图" className="rounded-[2rem] bg-white px-5 pb-6 pt-5 shadow-sm">
    <header className="flex items-center justify-between gap-4">
      <div><h1 className="text-4xl font-semibold tracking-tight">今天</h1><p className="mt-1 text-sm text-slate-500">{dateLabel}</p></div>
      <div className="flex items-center gap-3" aria-label={`已锁定 ${lockedMinutes / 60} 小时，空闲 ${(minutesInDay - lockedMinutes) / 60} 小时`}>
        <div className="relative h-14 w-14 rounded-full" style={{ background: `conic-gradient(#0f172a ${percent}%, #e5e7eb 0)` }}><span className="absolute inset-1.5 rounded-full bg-white" /></div>
        <div className="border-l border-slate-200 pl-3 text-xs text-slate-500"><p>锁定 <strong className="ml-1 text-lg text-slate-900">{lockedMinutes / 60}h</strong></p><p>空闲 <strong className="ml-1 text-lg text-slate-900">{(minutesInDay - lockedMinutes) / 60}h</strong></p></div>
      </div>
    </header>
    <div className="relative mt-8 min-h-80 pl-16">
      <div className="absolute bottom-0 left-[3.15rem] top-0 w-px bg-slate-200" />
      {scheduled.length === 0 ? <div className="py-16 text-center"><Clock3 className="mx-auto h-5 w-5 text-slate-400"/><p className="mt-3 font-medium">今天还没有安排</p><p className="mt-1 text-sm text-slate-500">例如：今天下午 3 点写周报</p></div> :
        <div className="space-y-5">{scheduled.map((task) => { const interval = getTaskInterval(task)!; return <article key={task.id} className="relative">
          <span className="absolute -left-16 top-2 w-11 text-right text-xs text-slate-500">{formatTime(interval.start)}</span><span className="absolute -left-[1.05rem] top-2 h-2 w-2 rounded-full bg-slate-500" />
          <button onPointerDown={(event) => { pointerStart.current = event.clientX; }} onPointerUp={(event) => { const start = pointerStart.current; pointerStart.current = null; if (start !== null && event.clientX - start >= 60) onStartFocus?.(task); else if (start !== null && event.clientX - start <= -60) onOpenTask(task); }} onClick={() => onOpenTask(task)} className="relative w-full touch-pan-y rounded-2xl bg-slate-100 px-4 py-4 text-left hover:bg-slate-200" aria-label={`打开任务：${task.title}`}><strong className="block text-base">{task.title}</strong><span className="mt-1 block text-xs text-slate-500">{formatTime(interval.start)} – {formatTime(interval.end)}</span><MoreHorizontal className="absolute right-4 top-4 h-4 w-4 text-slate-400" />{conflicts.has(task.id) && <span className="mt-2 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5"/>时间冲突</span>}</button>
        </article>; })}</div>}
    </div>
  </section>;
}
