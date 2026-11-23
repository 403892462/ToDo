import { type NextRequest, NextResponse } from "next/server";

import { createTasksSchema } from "@/features/tasks/api-schema";
import { postgresTaskRepository } from "@/features/tasks/server-repository";
import { DatabaseOperationError } from "@/lib/db";

import { getAuthorizedSpaceId } from "./authorization";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const spaceId = await getAuthorizedSpaceId(request);
    if (!spaceId) return NextResponse.json({ error: "未授权" }, { status: 401 });
    return NextResponse.json(await postgresTaskRepository.list(spaceId));
  } catch (error) {
    const status = error instanceof DatabaseOperationError ? 503 : 500;
    return NextResponse.json({ error: "任务读取失败，请稍后重试" }, { status });
  }
}

export async function POST(request: NextRequest) {
  const parsed = createTasksSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "任务内容无效" }, { status: 400 });

  try {
    const spaceId = await getAuthorizedSpaceId(request);
    if (!spaceId) return NextResponse.json({ error: "未授权" }, { status: 401 });
    const tasks = await postgresTaskRepository.createMany(spaceId, parsed.data.tasks);
    return NextResponse.json(tasks, { status: 201 });
  } catch (error) {
    const status = error instanceof DatabaseOperationError ? 503 : 500;
    return NextResponse.json({ error: "任务保存失败，请稍后重试" }, { status });
  }
}
