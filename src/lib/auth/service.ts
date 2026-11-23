import {
  SPACE_SESSION_MAX_AGE_SECONDS,
} from "./constants";
import {
  generateAccessCode,
  generateIdentifier,
  generateSessionToken,
  hashAccessCode,
  hashAttemptSubject,
  hashSessionToken,
  readAccessCodePepper,
} from "./crypto";
import { postgresSpaceAuthRepository } from "./repository";
import type {
  CreatedSpaceAuthorization,
  SpaceAuthorization,
  SpaceAuthRepository,
} from "./types";

export class SpaceRestoreRejectedError extends Error {
  readonly code = "SPACE_RESTORE_REJECTED";

  constructor() {
    super("无法恢复个人空间");
    this.name = "SpaceRestoreRejectedError";
  }
}

export class SpaceRestoreRateLimitedError extends Error {
  readonly code = "SPACE_RESTORE_RATE_LIMITED";

  constructor() {
    super("尝试次数过多，请稍后重试");
    this.name = "SpaceRestoreRateLimitedError";
  }
}

function newSession(now: Date): SpaceAuthorization {
  return {
    spaceId: "",
    sessionToken: generateSessionToken(),
    sessionExpiresAt: new Date(now.getTime() + SPACE_SESSION_MAX_AGE_SECONDS * 1000),
  };
}

export async function createPersonalSpace(options: {
  repository?: SpaceAuthRepository;
  pepper?: string;
  now?: Date;
} = {}): Promise<CreatedSpaceAuthorization> {
  const repository = options.repository ?? postgresSpaceAuthRepository;
  const pepper = options.pepper ?? readAccessCodePepper();
  const now = options.now ?? new Date();
  const spaceId = generateIdentifier();
  const accessCode = generateAccessCode();
  const session = newSession(now);

  await repository.createSpace({
    spaceId,
    credentialId: generateIdentifier(),
    accessCodeHash: hashAccessCode(accessCode, pepper),
    sessionId: generateIdentifier(),
    sessionTokenHash: hashSessionToken(session.sessionToken),
    sessionExpiresAt: session.sessionExpiresAt,
  });

  return { ...session, spaceId, accessCode };
}

export async function restorePersonalSpace(options: {
  accessCode: string;
  attemptSubject: string;
  repository?: SpaceAuthRepository;
  pepper?: string;
  now?: Date;
}): Promise<SpaceAuthorization> {
  const repository = options.repository ?? postgresSpaceAuthRepository;
  const pepper = options.pepper ?? readAccessCodePepper();
  const now = options.now ?? new Date();
  const subjectHash = hashAttemptSubject(options.attemptSubject, pepper);
  const lockedUntil = await repository.getLockedUntil(subjectHash);
  if (lockedUntil && lockedUntil.getTime() > now.getTime()) {
    throw new SpaceRestoreRateLimitedError();
  }

  const spaceId = await repository.findSpaceIdByAccessCodeHash(
    hashAccessCode(options.accessCode.trim(), pepper),
  );
  if (!spaceId) {
    await repository.recordRestoreFailure(subjectHash);
    throw new SpaceRestoreRejectedError();
  }

  const session = newSession(now);
  await repository.createSpaceSession({
    sessionId: generateIdentifier(),
    spaceId,
    sessionTokenHash: hashSessionToken(session.sessionToken),
    sessionExpiresAt: session.sessionExpiresAt,
  });
  await repository.clearRestoreFailures(subjectHash);
  return { ...session, spaceId };
}

export async function resolvePersonalSpace(
  sessionToken: string | undefined,
  repository: SpaceAuthRepository = postgresSpaceAuthRepository,
): Promise<string | null> {
  if (!sessionToken) return null;
  return repository.findSpaceIdBySessionTokenHash(hashSessionToken(sessionToken));
}
