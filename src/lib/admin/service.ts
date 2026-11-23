import { timingSafeEqual } from "node:crypto";

import {
  generateAccessCode,
  generateIdentifier,
  generateSessionToken,
  hashAccessCode,
  hashAttemptSubject,
  hashSessionToken,
  readAccessCodePepper,
} from "@/lib/auth/crypto";

import { readAdminConfig, type AdminConfig } from "./config";
import { verifyAdminPassword, verifyTotp } from "./crypto";
import { postgresAdminRepository } from "./repository";
import type { AdminRepository, RecoveryAudit } from "./types";

const ADMIN_SESSION_MS = 30 * 60_000;

export class AdminAuthenticationError extends Error {
  constructor(public readonly rateLimited = false) {
    super(rateLimited ? "尝试次数过多，请稍后重试" : "管理员验证失败");
    this.name = "AdminAuthenticationError";
  }
}

function sameText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function authenticateAdmin(input: {
  username: string;
  password: string;
  totp: string;
  attemptSubject: string;
  repository?: AdminRepository;
  config?: AdminConfig;
  pepper?: string;
  now?: Date;
}) {
  const repository = input.repository ?? postgresAdminRepository;
  const config = input.config ?? readAdminConfig();
  const pepper = input.pepper ?? readAccessCodePepper();
  const now = input.now ?? new Date();
  const subjectHash = hashAttemptSubject(input.attemptSubject, pepper);
  const lockedUntil = await repository.getLockedUntil(subjectHash);
  if (lockedUntil && lockedUntil > now) throw new AdminAuthenticationError(true);

  const valid = sameText(input.username, config.username)
    && await verifyAdminPassword(input.password, config.passwordHash)
    && verifyTotp(input.totp, config.totpSecret, now.getTime());
  if (!valid) {
    await repository.recordLoginFailure(subjectHash);
    throw new AdminAuthenticationError();
  }

  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + ADMIN_SESSION_MS);
  await repository.createSession({ id: generateIdentifier(), tokenHash: hashSessionToken(token), expiresAt });
  await repository.clearLoginFailures(subjectHash);
  return { token, expiresAt };
}

export async function hasAdminSession(token: string | undefined, repository: AdminRepository = postgresAdminRepository) {
  return token ? repository.hasValidSession(hashSessionToken(token)) : false;
}

export async function resetSpaceAccessCode(input: {
  spaceId: string;
  repository?: AdminRepository;
  pepper?: string;
}) {
  const repository = input.repository ?? postgresAdminRepository;
  const pepper = input.pepper ?? readAccessCodePepper();
  const accessCode = generateAccessCode();
  const auditId = generateIdentifier();
  try {
    const reset = await repository.resetSpaceAccessCode({
      auditId,
      credentialId: generateIdentifier(),
      spaceId: input.spaceId,
      accessCodeHash: hashAccessCode(accessCode, pepper),
    });
    return reset ? accessCode : null;
  } catch (error) {
    try {
      await repository.recordDatabaseFailure(generateIdentifier(), input.spaceId);
    } catch {
      // Database outages can also prevent the best-effort failure audit.
    }
    throw error;
  }
}

export async function listRecoveryAudits(repository: AdminRepository = postgresAdminRepository): Promise<RecoveryAudit[]> {
  return repository.listAudits();
}
