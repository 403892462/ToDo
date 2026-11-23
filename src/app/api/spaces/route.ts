import { type NextRequest, NextResponse } from "next/server";

import {
  createPersonalSpace,
  resolvePersonalSpace,
  setSpaceSessionCookie,
  SPACE_SESSION_COOKIE,
} from "@/lib/auth";
import { DatabaseOperationError } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const spaceId = await resolvePersonalSpace(request.cookies.get(SPACE_SESSION_COOKIE)?.value);
    return spaceId
      ? NextResponse.json({ spaceId })
      : NextResponse.json({ error: "未授权" }, { status: 401 });
  } catch (error) {
    const status = error instanceof DatabaseOperationError ? 503 : 500;
    return NextResponse.json({ error: "个人空间读取失败" }, { status });
  }
}

export async function POST() {
  try {
    const authorization = await createPersonalSpace();
    const response = NextResponse.json(
      { spaceId: authorization.spaceId, accessCode: authorization.accessCode },
      { status: 201 },
    );
    setSpaceSessionCookie(response, authorization.sessionToken);
    return response;
  } catch (error) {
    const status = error instanceof DatabaseOperationError ? 503 : 500;
    return NextResponse.json({ error: "个人空间创建失败" }, { status });
  }
}
