export type SpaceAuthorization = {
  spaceId: string;
  sessionToken: string;
  sessionExpiresAt: Date;
};

export type CreatedSpaceAuthorization = SpaceAuthorization & {
  accessCode: string;
};

export interface SpaceAuthRepository {
  createSpace(input: {
    spaceId: string;
    credentialId: string;
    accessCodeHash: string;
    sessionId: string;
    sessionTokenHash: string;
    sessionExpiresAt: Date;
  }): Promise<void>;
  findSpaceIdByAccessCodeHash(accessCodeHash: string): Promise<string | null>;
  createSpaceSession(input: {
    sessionId: string;
    spaceId: string;
    sessionTokenHash: string;
    sessionExpiresAt: Date;
  }): Promise<void>;
  findSpaceIdBySessionTokenHash(sessionTokenHash: string): Promise<string | null>;
  getLockedUntil(subjectHash: string): Promise<Date | null>;
  recordRestoreFailure(subjectHash: string): Promise<void>;
  clearRestoreFailures(subjectHash: string): Promise<void>;
}
