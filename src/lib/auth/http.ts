import type { NextRequest, NextResponse } from "next/server";

import {
  SPACE_SESSION_COOKIE,
  SPACE_SESSION_MAX_AGE_SECONDS,
} from "./constants";

export function setSpaceSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set({
    name: SPACE_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SPACE_SESSION_MAX_AGE_SECONDS,
    priority: "high",
  });
}

export function getRestoreAttemptSubject(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = request.headers.get("x-real-ip") ?? forwardedFor ?? "unknown";
  const agent = request.headers.get("user-agent") ?? "unknown";
  return `${address}|${agent}`;
}
