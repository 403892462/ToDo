import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminRequest, resetSpaceAccessCode } from "@/lib/admin";
import { DatabaseOperationError } from "@/lib/db";

export const runtime = "nodejs";

const schema = z.object({ spaceId: z.string().uuid(), confirmed: z.literal(true) });

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "重置请求无效" }, { status: 400 });
  try {
    if (!await isAdminRequest(request)) return NextResponse.json({ error: "未授权" }, { status: 401 });
    const accessCode = await resetSpaceAccessCode({ spaceId: parsed.data.spaceId });
    return accessCode
      ? NextResponse.json({ accessCode })
      : NextResponse.json({ error: "个人空间不存在" }, { status: 404 });
  } catch (error) {
    return NextResponse.json(
      { error: "访问码重置失败，旧访问码保持有效" },
      { status: error instanceof DatabaseOperationError ? 503 : 500 },
    );
  }
}
