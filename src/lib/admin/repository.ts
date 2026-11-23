import { queryDatabase, withTransaction } from "@/lib/db";

import type { AdminRepository, RecoveryAudit } from "./types";

const FAILURE_LIMIT = 5;
const WINDOW_MINUTES = 15;

export const postgresAdminRepository: AdminRepository = {
  async getLockedUntil(subjectHash) {
    const result = await queryDatabase<{ locked_until: Date | null }>(
      `SELECT locked_until FROM authentication_attempts
        WHERE scope = 'admin_login' AND subject_hash = $1`,
      [subjectHash],
    );
    return result.rows[0]?.locked_until ?? null;
  },

  async recordLoginFailure(subjectHash) {
    await queryDatabase(
      `INSERT INTO authentication_attempts
         (scope, subject_hash, failure_count, window_started_at, locked_until)
       VALUES ('admin_login', $1, 1, now(), NULL)
       ON CONFLICT (scope, subject_hash) DO UPDATE SET
         failure_count = CASE WHEN authentication_attempts.window_started_at < now() - ($2 * interval '1 minute') THEN 1 ELSE authentication_attempts.failure_count + 1 END,
         window_started_at = CASE WHEN authentication_attempts.window_started_at < now() - ($2 * interval '1 minute') THEN now() ELSE authentication_attempts.window_started_at END,
         locked_until = CASE WHEN authentication_attempts.window_started_at >= now() - ($2 * interval '1 minute') AND authentication_attempts.failure_count + 1 >= $3 THEN now() + ($2 * interval '1 minute') ELSE NULL END`,
      [subjectHash, WINDOW_MINUTES, FAILURE_LIMIT],
    );
  },

  async clearLoginFailures(subjectHash) {
    await queryDatabase(
      "DELETE FROM authentication_attempts WHERE scope = 'admin_login' AND subject_hash = $1",
      [subjectHash],
    );
  },

  async createSession(input) {
    await queryDatabase(
      "INSERT INTO admin_sessions (id, token_hash, expires_at) VALUES ($1, $2, $3)",
      [input.id, input.tokenHash, input.expiresAt],
    );
  },

  async hasValidSession(tokenHash) {
    const result = await queryDatabase(
      `SELECT 1 FROM admin_sessions
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
        LIMIT 1`,
      [tokenHash],
    );
    return result.rows.length > 0;
  },

  async resetSpaceAccessCode(input) {
    return withTransaction(async (client) => {
      const target = await client.query<{ id: string }>("SELECT id FROM spaces WHERE id = $1 FOR UPDATE", [input.spaceId]);
      if (!target.rows[0]) {
        await client.query(
          `INSERT INTO recovery_audits (id, target_space_id, attempted_space_id, result)
           VALUES ($1, NULL, $2, 'space_not_found')`,
          [input.auditId, input.spaceId],
        );
        return false;
      }
      await client.query(
        "UPDATE access_credentials SET revoked_at = now() WHERE space_id = $1 AND revoked_at IS NULL",
        [input.spaceId],
      );
      await client.query(
        "INSERT INTO access_credentials (id, space_id, secret_hash) VALUES ($1, $2, $3)",
        [input.credentialId, input.spaceId, input.accessCodeHash],
      );
      await client.query(
        `INSERT INTO recovery_audits (id, target_space_id, attempted_space_id, result)
         VALUES ($1, $2, $2, 'succeeded')`,
        [input.auditId, input.spaceId],
      );
      return true;
    });
  },

  async recordDatabaseFailure(auditId, attemptedSpaceId) {
    await queryDatabase(
      `INSERT INTO recovery_audits (id, target_space_id, attempted_space_id, result)
       VALUES ($1, NULL, $2, 'database_failed')`,
      [auditId, attemptedSpaceId],
    );
  },

  async listAudits() {
    const result = await queryDatabase<{
      id: string;
      target_space_id: string | null;
      attempted_space_id: string;
      result: RecoveryAudit["result"];
      occurred_at: Date | string;
    }>(
      `SELECT id, target_space_id, attempted_space_id, result, occurred_at
         FROM recovery_audits ORDER BY occurred_at DESC`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      targetSpaceId: row.target_space_id ?? undefined,
      attemptedSpaceId: row.attempted_space_id,
      result: row.result,
      occurredAt: new Date(row.occurred_at).toISOString(),
    }));
  },
};
