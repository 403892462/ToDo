export async function requestTaskBreakdown(title: string): Promise<string[]> {
  const response = await fetch("/api/tasks/breakdown", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
  if (!response.ok) throw new Error("AI_BREAKDOWN_FAILED");
  const body = await response.json() as { subtasks?: string[] };
  if (!body.subtasks?.length) throw new Error("AI_BREAKDOWN_FAILED");
  return body.subtasks;
}
