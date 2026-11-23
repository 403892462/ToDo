import { type NextRequest, NextResponse } from "next/server";

import { isAdminRequest, listRecoveryAudits } from "@/lib/admin";
import { DatabaseOperationError } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    if (!await isAdminRequest(request)) return NextResponse.json({ error: "未授权" }, { status: 401 });
    return NextResponse.json(await listRecoveryAudits());
  } catch (error) {
    return NextResponse.json(
      { error: "审计记录读取失败" },
      { status: error instanceof DatabaseOperationError ? 503 : 500 },
    );
  }
}
