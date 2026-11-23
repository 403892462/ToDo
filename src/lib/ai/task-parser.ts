import { generateText, Output } from "ai";
import { z } from "zod";
import type { TaskDraft, TaskPriority } from "@/features/tasks/model";
import { createTodoProvider } from "./provider";

const modelTaskSchema = z.object({
  sourceText: z.string(), certain: z.boolean(), title: z.string().nullable(),
  dueAt: z.string().nullable(), durationMinutes: z.number().int().positive().nullable(),
  labels: z.array(z.string()), priority: z.enum(["low", "medium", "high"]).nullable(),
});
const modelOutputSchema = z.object({ tasks: z.array(modelTaskSchema), truncated: z.boolean() });
type ModelTaskOutput = z.infer<typeof modelOutputSchema>;
type GenerateTaskOutput = (text: string) => Promise<ModelTaskOutput>;

export type TaskParseResult = {
  status: "parsed"; tasks: TaskDraft[]; partial: boolean; truncated: boolean;
};

export function buildTaskPrompt(text: string, now = new Date()) {
  const currentTime = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(now);
  return [
    "从用户的中文自然语言输入中按原文顺序提取一个或多个独立个人任务。",
    "最多返回前 10 个任务；若还有其余任务，将 truncated 设为 true。",
    "每个任务必须在 sourceText 中保留对应的原文片段。无法可靠解析该片段时，certain=false，title=null。",
    "时间范围使用 dueAt 表示开始时间，并将起止时间差换算为 durationMinutes；只有开始时间时 durationMinutes=null。",
    `当前时间：${currentTime}`, "时区：Asia/Shanghai（UTC+08:00）。",
    "将“今天”解释为当前日期，将“明天”解释为当前日期加一天。",
    "将“下班后”默认解释为当天 18:00；用户明确输入其他时间时，以用户输入为准。",
    "存在日期或时间表达时，dueAt 必须返回带 +08:00 时区的 ISO 8601 时间戳。",
    "没有日期或时间时将 dueAt 设为 null。优先级只能映射为 low、medium 或 high。",
    `用户输入：${text}`,
  ].join("\n");
}

async function generateTaskOutput(text: string): Promise<ModelTaskOutput> {
  const baseURL = process.env.AI_BASE_URL;
  const modelId = process.env.AI_MODEL_ID;
  const apiKey = process.env.AI_API_KEY;
  if (!baseURL || !modelId || !apiKey) throw new Error("AI provider configuration is incomplete");
  const provider = createTodoProvider(baseURL, apiKey);
  const { output } = await generateText({
    model: provider(modelId), output: Output.object({ schema: modelOutputSchema }), prompt: buildTaskPrompt(text),
  });
  return output;
}

export async function parseTaskText(text: string, generate: GenerateTaskOutput = generateTaskOutput): Promise<TaskParseResult> {
  const normalized = text.trim();
  if (!normalized) throw new Error("Task text is required");
  const result = await generate(normalized);
  const selected = result.tasks.slice(0, 10);
  if (selected.length === 0) {
    return { status: "parsed", tasks: [{ title: normalized, labels: [] }], partial: true, truncated: result.truncated };
  }
  let partial = false;
  const tasks = selected.map((item): TaskDraft => {
    const title = item.title?.trim();
    if (!item.certain || !title) {
      partial = true;
      return { title: item.sourceText.trim() || normalized, labels: [] };
    }
    return {
      title, dueAt: item.dueAt ?? undefined, durationMinutes: item.durationMinutes ?? undefined,
      labels: item.labels, priority: item.priority as TaskPriority | undefined,
    };
  });
  return { status: "parsed", tasks, partial, truncated: result.truncated || result.tasks.length > 10 };
}
