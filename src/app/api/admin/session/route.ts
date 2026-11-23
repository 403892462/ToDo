import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  AdminAuthenticationError,
  authenticateAdmin,
  getAdminAttemptSubject,
  isAdminRequest,
  setAdminSessionCookie,
} from "@/lib/admin";
import { DatabaseOperationError } from "@/lib/db";

export const runtime = "nodejs";

const schema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(500),
  totp: z.string().regex(/^\d{6}$/),
});

export async function GET(request: NextRequest) {
  try {
    return await isAdminRequest(request)
      ? NextResponse.json({ authenticated: true })
      : NextResponse.json({ authenticated: false }, { status: 401 });
  } catch (error) {
    return NextResponse.json(
      { error: "管理员会话检查失败" },
      { status: error instanceof DatabaseOperationError ? 503 : 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "管理员验证失败" }, { status: 401 });
  try {
    const session = await authenticateAdmin({
      ...parsed.data,
      attemptSubject: getAdminAttemptSubject(request),
    });
    const response = NextResponse.json({ authenticated: true });
    setAdminSessionCookie(response, session.token);
    return response;
  } catch (error) {
    if (error instanceof AdminAuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: error.rateLimited ? 429 : 401 });
    }
    return NextResponse.json(
      { error: "管理员验证失败" },
      { status: error instanceof DatabaseOperationError ? 503 : 500 },
    );
  }
}
