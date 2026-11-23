import type { RecoveryAudit } from "@/lib/admin";

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as ({ error?: string } & T) | null;
  if (!response.ok) throw new Error(body?.error ?? "操作失败，请稍后重试");
  return body as T;
}

export async function checkAdminSession(): Promise<boolean> {
  const response = await fetch("/api/admin/session", { cache: "no-store" });
  if (response.status === 401) return false;
  await parse(response);
  return true;
}

export async function loginAdmin(input: { username: string; password: string; totp: string }) {
  await parse(
    await fetch("/api/admin/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function resetAccessCode(spaceId: string): Promise<string> {
  const result = await parse<{ accessCode: string }>(
    await fetch("/api/admin/access-codes/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spaceId, confirmed: true }),
    }),
  );
  return result.accessCode;
}

export async function getRecoveryAudits(): Promise<RecoveryAudit[]> {
  return parse(await fetch("/api/admin/audits", { cache: "no-store" }));
}
