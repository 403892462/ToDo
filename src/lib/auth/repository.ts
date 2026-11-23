import { queryDatabase, withTransaction } from "@/lib/db";

import {
  RESTORE_FAILURE_LIMIT,
  RESTORE_WINDOW_MINUTES,
} from "./constants";
import type { SpaceAuthRepository } from "./types";

export const postgresSpaceAuthRepository: SpaceAuthRepository = {
  async createSpace(input) {
    await withTransaction(async (client) => {
      await client.query("INSERT INTO spaces (id) VALUES ($1)", [input.spaceId]);
      await client.query(
        `INSERT INTO access_credentials (id, space_id, secret_hash)
         VALUES ($1, $2, $3)`,
        [input.credentialId, input.spaceId, input.accessCodeHash],
      );
      await client.query(
        `INSERT INTO space_sessions (id, space_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [input.sessionId, input.spaceId, input.sessionTokenHash, input.sessionExpiresAt],
      );
    });
  },

  async findSpaceIdByAccessCodeHash(accessCodeHash) {
    const result = await queryDatabase<{ space_id: string }>(
      `SELECT space_id
         FROM access_credentials
        WHERE secret_hash = $1 AND revoked_at IS NULL
        LIMIT 1`,
      [accessCodeHash],
    );
    return result.rows[0]?.space_id ?? null;
  },

  async createSpaceSession(input) {
    await queryDatabase(
      `INSERT INTO space_sessions (id, space_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [input.sessionId, input.spaceId, input.sessionTokenHash, input.sessionExpiresAt],
    );
  },

  async findSpaceIdBySessionTokenHash(sessionTokenHash) {
    const result = await queryDatabase<{ space_id: string }>(
      `SELECT space_id
         FROM space_sessions
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > now()
        LIMIT 1`,
      [sessionTokenHash],
    );
    return result.rows[0]?.space_id ?? null;
  },

  async getLockedUntil(subjectHash) {
    const result = await queryDatabase<{ locked_until: Date | null }>(
      `SELECT locked_until
         FROM authentication_attempts
        WHERE scope = 'space_restore' AND subject_hash = $1`,
      [subjectHash],
    );
    return result.rows[0]?.locked_until ?? null;
  },

  async recordRestoreFailure(subjectHash) {
    await queryDatabase(
      `INSERT INTO authentication_attempts
         (scope, subject_hash, failure_count, window_started_at, locked_until)
       VALUES ('space_restore', $1, 1, now(), NULL)
       ON CONFLICT (scope, subject_hash) DO UPDATE SET
         failure_count = CASE
           WHEN authentication_attempts.window_started_at < now() - ($2 * interval '1 minute') THEN 1
           ELSE authentication_attempts.failure_count + 1
         END,
         window_started_at = CASE
           WHEN authentication_attempts.window_started_at < now() - ($2 * interval '1 minute') THEN now()
           ELSE authentication_attempts.window_started_at
         END,
         locked_until = CASE
           WHEN authentication_attempts.window_started_at >= now() - ($2 * interval '1 minute')
            AND authentication_attempts.failure_count + 1 >= $3
           THEN now() + ($2 * interval '1 minute')
           ELSE NULL
         END`,
      [subjectHash, RESTORE_WINDOW_MINUTES, RESTORE_FAILURE_LIMIT],
    );
  },

  async clearRestoreFailures(subjectHash) {
    await queryDatabase(
      `DELETE FROM authentication_attempts
        WHERE scope = 'space_restore' AND subject_hash = $1`,
      [subjectHash],
    );
  },
};
