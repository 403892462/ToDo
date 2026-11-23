import type { TaskDraft } from "./model";

export type ClientParseResult =
  | { status: "parsed"; tasks: TaskDraft[]; partial: boolean; truncated: boolean }
  | { status: "error"; error: "AI_PARSE_FAILED" };

export async function requestTaskParse(text: string): Promise<ClientParseResult> {
  const response = await fetch("/api/tasks/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = (await response.json()) as ClientParseResult;
  if (!response.ok) return { status: "error", error: "AI_PARSE_FAILED" };
  return body;
}
