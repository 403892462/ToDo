import { generateText, Output } from "ai";
import { z } from "zod";
import { createTodoProvider } from "./provider";
const schema = z.object({ subtasks: z.array(z.string().min(1)).min(1).max(8) });
export type GenerateBreakdown = (title: string) => Promise<{ subtasks: string[] }>;
async function generateBreakdown(title: string) {
  const { AI_BASE_URL: baseURL, AI_MODEL_ID: modelId, AI_API_KEY: apiKey } = process.env;
  if (!baseURL || !modelId || !apiKey) throw new Error("AI provider configuration is incomplete");
  const provider = createTodoProvider(baseURL, apiKey);
  const { output } = await generateText({ model: provider(modelId), output: Output.object({ schema }), prompt: `将任务拆成 2 到 5 个具体、可执行的中文子任务。任务：${title}` });
  return output;
}
export async function breakDownTask(title: string, generate: GenerateBreakdown = generateBreakdown) {
  const normalized = title.trim(); if (!normalized) throw new Error("Task title is required");
  const result = await generate(normalized); return { subtasks: result.subtasks.map((item) => item.trim()).filter(Boolean) };
}
