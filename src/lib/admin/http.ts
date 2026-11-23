import type { NextRequest, NextResponse } from "next/server";

import { hasAdminSession } from "./service";

export const ADMIN_SESSION_COOKIE = "todo_admin_session";

export function setAdminSessionCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 30 * 60,
    priority: "high",
  });
}

export function getAdminAttemptSubject(request: NextRequest): string {
  const address = request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
  return `${address}|${request.headers.get("user-agent") ?? "unknown"}`;
}

export async function isAdminRequest(request: NextRequest): Promise<boolean> {
  return hasAdminSession(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
}
