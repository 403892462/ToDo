import { NextResponse } from "next/server";
import { z } from "zod";
import { breakDownTask } from "@/lib/ai/task-breakdown";
const schema = z.object({ title: z.string() });
type Breaker = typeof breakDownTask;
export function createPost(breaker: Breaker = breakDownTask) { return async function POST(request: Request) {
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 }); }
  const parsed = schema.safeParse(body); if (!parsed.success || !parsed.data.title.trim()) return NextResponse.json({ error: "EMPTY_TASK" }, { status: 400 });
  try { return NextResponse.json(await breaker(parsed.data.title)); } catch (error) {
    console.error("AI task breakdown failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown failure",
    });
    return NextResponse.json({ error: "AI_BREAKDOWN_FAILED" }, { status: 503 });
  }
}; }
export const POST = createPost();
