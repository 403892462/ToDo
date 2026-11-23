import { type NextRequest, NextResponse } from "next/server";

import { updateTaskSchema } from "@/features/tasks/api-schema";
import { postgresTaskRepository } from "@/features/tasks/server-repository";
import { DatabaseOperationError } from "@/lib/db";

import { getAuthorizedSpaceId } from "../authorization";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/tasks/[id]">) {
  const parsed = updateTaskSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "任务内容无效" }, { status: 400 });

  try {
    const spaceId = await getAuthorizedSpaceId(request);
    if (!spaceId) return NextResponse.json({ error: "未授权" }, { status: 401 });
    const { id } = await context.params;
    const task = await postgresTaskRepository.update(spaceId, id, parsed.data);
    return task
      ? NextResponse.json(task)
      : NextResponse.json({ error: "任务不存在" }, { status: 404 });
  } catch (error) {
    const status = error instanceof DatabaseOperationError ? 503 : 500;
    return NextResponse.json({ error: "任务保存失败，请稍后重试" }, { status });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext<"/api/tasks/[id]">) {
  try {
    const spaceId = await getAuthorizedSpaceId(request);
    if (!spaceId) return NextResponse.json({ error: "未授权" }, { status: 401 });
    const { id } = await context.params;
    const deleted = await postgresTaskRepository.delete(spaceId, id);
    return deleted
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ error: "任务不存在" }, { status: 404 });
  } catch (error) {
    const status = error instanceof DatabaseOperationError ? 503 : 500;
    return NextResponse.json({ error: "任务删除失败，请稍后重试" }, { status });
  }
}
