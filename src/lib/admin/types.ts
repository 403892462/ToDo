export type RecoveryAudit = {
  id: string;
  targetSpaceId?: string;
  attemptedSpaceId: string;
  result: "succeeded" | "space_not_found" | "database_failed";
  occurredAt: string;
};

export interface AdminRepository {
  getLockedUntil(subjectHash: string): Promise<Date | null>;
  recordLoginFailure(subjectHash: string): Promise<void>;
  clearLoginFailures(subjectHash: string): Promise<void>;
  createSession(input: { id: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  hasValidSession(tokenHash: string): Promise<boolean>;
  resetSpaceAccessCode(input: {
    auditId: string;
    credentialId: string;
    spaceId: string;
    accessCodeHash: string;
  }): Promise<boolean>;
  recordDatabaseFailure(auditId: string, attemptedSpaceId: string): Promise<void>;
  listAudits(): Promise<RecoveryAudit[]>;
}
