import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getRestoreAttemptSubject,
  restorePersonalSpace,
  setSpaceSessionCookie,
  SpaceRestoreRateLimitedError,
  SpaceRestoreRejectedError,
} from "@/lib/auth";
import { DatabaseOperationError } from "@/lib/db";

export const runtime = "nodejs";

const requestSchema = z.object({
  accessCode: z.string().trim().min(20).max(128),
});

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "无法恢复个人空间" }, { status: 401 });
  }

  try {
    const authorization = await restorePersonalSpace({
      accessCode: parsed.data.accessCode,
      attemptSubject: getRestoreAttemptSubject(request),
    });
    const response = NextResponse.json({ spaceId: authorization.spaceId });
    setSpaceSessionCookie(response, authorization.sessionToken);
    return response;
  } catch (error) {
    if (error instanceof SpaceRestoreRateLimitedError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    if (error instanceof SpaceRestoreRejectedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    const status = error instanceof DatabaseOperationError ? 503 : 500;
    return NextResponse.json({ error: "无法恢复个人空间" }, { status });
  }
}
