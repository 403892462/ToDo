import type { NextRequest } from "next/server";

import { resolvePersonalSpace, SPACE_SESSION_COOKIE } from "@/lib/auth";

export async function getAuthorizedSpaceId(request: NextRequest): Promise<string | null> {
  return resolvePersonalSpace(request.cookies.get(SPACE_SESSION_COOKIE)?.value);
}
