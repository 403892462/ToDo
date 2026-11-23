export type SpaceCredential = { spaceId: string; accessCode: string };

async function parseResponse<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? fallback);
  }
  return response.json() as Promise<T>;
}

export async function getCurrentSpace(): Promise<{ spaceId: string } | null> {
  const response = await fetch("/api/spaces", { cache: "no-store" });
  if (response.status === 401) return null;
  return parseResponse(response, "个人空间读取失败");
}

export async function createSpace(): Promise<SpaceCredential> {
  return parseResponse(
    await fetch("/api/spaces", { method: "POST" }),
    "个人空间创建失败",
  );
}

export async function recoverSpace(accessCode: string): Promise<{ spaceId: string }> {
  return parseResponse(
    await fetch("/api/spaces/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessCode }),
    }),
    "无法恢复个人空间",
  );
}
