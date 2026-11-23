import { useMemo, useState } from "react";
import { ArrowRightIcon, ChevronDownIcon, ClockIcon, DotsHorizontalIcon, MagicWandIcon, PlayIcon } from "@radix-ui/react-icons";
import { BottomSheet, KeyboardInput, MobileScroll, useKeyboard, useKeyboardInsets } from "./mobile";

type TimelineTask = { id: number; title: string; start: string; end: string };
const initialTasks: TimelineTask[] = [
  { id: 1, title: "敲代码", start: "09:00", end: "10:00" },
  { id: 2, title: "和老张对齐", start: "11:30", end: "12:30" },
  { id: 3, title: "写周报", start: "15:00", end: "16:00" },
];

export default function Prototype() {
  const [tasks, setTasks] = useState(initialTasks);
  const [backlog, setBacklog] = useState(["整理照片", "回复邮件", "订周末的车票"]);
  const [value, setValue] = useState("");
  const [poolOpen, setPoolOpen] = useState(false);
  const [menuTask, setMenuTask] = useState<TimelineTask | null>(null);
  const [focusTask, setFocusTask] = useState<TimelineTask | null>(null);
  const [focusSeconds, setFocusSeconds] = useState(25 * 60);
  const [message, setMessage] = useState("可以输入任务、时间或想法");
  const keyboard = useKeyboard();
  const { bottomInset } = useKeyboardInsets();
  const locked = useMemo(() => tasks.length, [tasks]);

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    if (/\d{1,2}[:点时]|上午|下午|今晚|今天/.test(text)) {
      setTasks((items) => [...items, { id: Date.now(), title: text.replace(/今天|下午|上午|\d{1,2}[点时:]\d{0,2}/g, "").trim() || text, start: "17:00", end: "18:00" }]);
      setMessage("已识别时间，安排到今天 17:00");
    } else {
      setBacklog((items) => [...items, text]);
      setMessage("未识别时间，已放入任务池");
    }
    setValue(""); keyboard.hide();
  };

  const scheduleBacklog = (title: string) => {
    setBacklog((items) => items.filter((item) => item !== title));
    setTasks((items) => [...items, { id: Date.now(), title, start: "17:00", end: "18:00" }]);
    setPoolOpen(false); setMessage(`已将“${title}”安排到 17:00`);
  };

  const delayTask = (kind: "hour" | "tomorrow") => {
    if (!menuTask) return;
    if (kind === "hour") {
      const bump = (time: string) => `${String((Number(time.slice(0, 2)) + 1) % 24).padStart(2, "0")}${time.slice(2)}`;
      setTasks((items) => items.map((task) => task.id === menuTask.id ? { ...task, start: bump(task.start), end: bump(task.end) } : task));
      setMessage("任务已顺延 1 小时");
    } else {
      setTasks((items) => items.filter((task) => task.id !== menuTask.id));
      setBacklog((items) => [...items, `${menuTask.title} · 明天 ${menuTask.start}`]);
      setMessage("任务已推迟到明天");
    }
    setMenuTask(null);
  };

  return <div className="today-app">
    <MobileScroll className="today-scroll"><main className="today-content" aria-label="今日视图">
      <header className="today-header"><div><h1>今天</h1><p>11月5日 星期四</p></div>
        <div className="time-asset" aria-label={`已锁定 ${locked} 小时，空闲 ${24 - locked} 小时`}>
          <div className="time-ring" style={{ "--locked": `${locked * 15}deg` } as React.CSSProperties}><span /></div>
          <div className="asset-copy"><span>锁定 <strong>{locked}h</strong></span><span>空闲 <strong>{24 - locked}h</strong></span></div>
        </div></header>
      <section className="timeline" aria-label="今日时间轴"><div className="period-label">早上</div><div className="timeline-line" />
        {tasks.map((task, index) => <article className={`timeline-task task-${index}`} key={task.id}>
          <span className="time-dot" /><span className="task-time">{task.start}</span>
          <button className="task-card" onClick={() => setMenuTask(task)} aria-label={`${task.title}快捷操作`}><strong>{task.title}</strong><span>{task.start} – {task.end}</span><DotsHorizontalIcon aria-hidden="true" /></button>
          {index === 1 && <button className="focus-peek" onClick={() => { setFocusTask(task); setFocusSeconds(25 * 60); }} aria-label={`开始专注：${task.title}`}><PlayIcon /><span>专注</span></button>}
        </article>)}
        <div className="now-line"><span>10:24</span><i /></div><div className="period-label afternoon">下午</div><div className="period-label evening">晚上</div><p className="no-more">之后暂无安排</p>
      </section>
    </main></MobileScroll>
    <div className="bottom-stack" style={{ bottom: bottomInset }}><p className="create-message" aria-live="polite">{message}</p>
      <form className="capture-bar" onSubmit={(event) => { event.preventDefault(); submit(); }}><MagicWandIcon /><KeyboardInput value={value} onChange={(event) => setValue(event.target.value)} placeholder="记下任务、时间或想法…" aria-label="闪念收集箱" /><button type="submit" aria-label="创建任务"><ArrowRightIcon /></button></form>
      <button className="pool-peek" onClick={() => setPoolOpen(true)}><span className="pool-handle" /><strong>任务池 · {backlog.length}项</strong><ChevronDownIcon /></button>
    </div>
    <BottomSheet open={poolOpen} onOpenChange={setPoolOpen} title="任务池" description="没有时间的任务会先放在这里。" snap={0.54}><div className="pool-list">{backlog.map((item) => <div className="pool-row" key={item}><span>{item}</span><button onClick={() => scheduleBacklog(item)}>安排到今天</button></div>)}</div></BottomSheet>
    <BottomSheet open={Boolean(menuTask)} onOpenChange={(open) => !open && setMenuTask(null)} title={menuTask?.title ?? "任务操作"} snap={0.48}><div className="action-list">
      <button onClick={() => { setFocusTask(menuTask); setMenuTask(null); }}><PlayIcon />开始专注 25:00</button><button onClick={() => delayTask("hour")}><ClockIcon />顺延 1 小时</button><button onClick={() => delayTask("tomorrow")}><ArrowRightIcon />推迟到明天</button><button onClick={() => { setMessage("AI 已生成 3 个子任务预览，等待确认"); setMenuTask(null); }}><MagicWandIcon />AI 拆解</button>
    </div></BottomSheet>
    <BottomSheet open={Boolean(focusTask)} onOpenChange={(open) => !open && setFocusTask(null)} title="专注模式" description={focusTask?.title} snap={0.5}><div className="focus-panel"><div className="focus-clock">{String(Math.floor(focusSeconds / 60)).padStart(2, "0")}:{String(focusSeconds % 60).padStart(2, "0")}</div><div className="focus-actions"><button onClick={() => setFocusSeconds((seconds) => Math.max(0, seconds - 60))}>暂停</button><button className="dark" onClick={() => { setMessage(`已完成“${focusTask?.title}”`); setFocusTask(null); }}>完成任务</button></div></div></BottomSheet>
  </div>;
}
