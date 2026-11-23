import { NextResponse } from "next/server";
import { z } from "zod";

import { parseTaskText } from "@/lib/ai/task-parser";

const requestSchema = z.object({ text: z.string() });

type Parser = typeof parseTaskText;

export function createPost(parser: Parser = parseTaskText) {
  return async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success || !parsed.data.text.trim()) {
    return NextResponse.json({ error: "EMPTY_TASK" }, { status: 400 });
  }

  try {
    const result = await parser(parsed.data.text);
    return NextResponse.json(result);
  } catch (error) {
    console.error("AI task parse failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown failure",
    });
    return NextResponse.json({ status: "error", error: "AI_PARSE_FAILED" }, { status: 503 });
  }
  };
}

export const POST = createPost();
