import { createHmac, createHash, randomBytes, randomUUID } from "node:crypto";

export function generateAccessCode(): string {
  return `TD-${randomBytes(24).toString("base64url")}`;
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function generateIdentifier(): string {
  return randomUUID();
}

export function hashAccessCode(accessCode: string, pepper: string): string {
  return createHmac("sha256", pepper).update(accessCode, "utf8").digest("hex");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function hashAttemptSubject(subject: string, pepper: string): string {
  return createHmac("sha256", pepper).update(subject, "utf8").digest("hex");
}

export function readAccessCodePepper(environment = process.env): string {
  const pepper = environment.ACCESS_CODE_PEPPER;
  if (!pepper || pepper.length < 32) {
    throw new Error("访问码服务端安全配置不完整");
  }
  return pepper;
}
