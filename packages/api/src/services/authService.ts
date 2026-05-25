import crypto from 'crypto';
import { queryOne, execute, getClient } from '../db/connection.js';

export interface AccessCodeRow {
  id: number;
  code: string;
  email: string;
  role: string;
  participant_id: number | null;
  used_at: string | null;
  expires_at: string | null;
  consumed_at: string | null;
}

export async function validateCode(code: string): Promise<AccessCodeRow | null> {
  return queryOne<AccessCodeRow>('SELECT * FROM access_codes WHERE code = $1', [code]);
}

export function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let code = 'SUMMA-';
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

// createMagicLink (non-atomic) and countRecentMagicLinks were removed once the
// /magic-link route migrated to createMagicLinkUnderQuota, which combines the
// quota check and code insertion inside a single advisory-locked transaction.

/**
 * Validate a magic link code for the /auth/login exchange.
 *
 * Magic links (rows with a non-null expires_at) are single-use: the first
 * successful call sets consumed_at and clears expires_at, promoting the
 * code to a permanent session token. Subsequent /auth/login calls with
 * the same code are rejected so an intercepted link cannot be used twice.
 *
 * Consuming a magic link also deletes every other access code that shares
 * the same email. Requesting a fresh magic link is treated as the
 * canonical revocation primitive — any session that was previously open
 * on another device is terminated as soon as the new link is consumed.
 *
 * Permanent codes (no expires_at — e.g. SUMMA-ADMIN) bypass both the
 * single-use rule and the session-revoke step, staying reusable for
 * emergency access.
 */
export async function validateMagicLink(code: string): Promise<AccessCodeRow | null> {
  const access = await queryOne<AccessCodeRow>(
    'SELECT * FROM access_codes WHERE code = $1',
    [code],
  );

  if (!access) return null;

  if (access.expires_at) {
    // Originated as a magic link.
    if (access.consumed_at) {
      return null; // Already exchanged for a session; reject reuse.
    }
    const expiresAt = new Date(access.expires_at);
    if (expiresAt < new Date()) {
      return null; // Expired before being consumed.
    }

    // Revoke any other access codes sharing this email so a newly issued
    // link supersedes whatever permanent or pending codes existed before.
    await execute(
      'DELETE FROM access_codes WHERE email = $1 AND id <> $2',
      [access.email, access.id],
    );

    // Promote the current row to a permanent session token.
    await execute(
      'UPDATE access_codes SET expires_at = NULL, used_at = CURRENT_TIMESTAMP, consumed_at = CURRENT_TIMESTAMP WHERE id = $1',
      [access.id],
    );
    access.expires_at = null;
    access.consumed_at = new Date().toISOString();
    access.used_at = access.consumed_at;
  }

  return access;
}

/**
 * Atomic "count recent magic links → create a new one if under quota".
 *
 * The non-atomic version (count + create as separate calls) has a race window:
 * two concurrent requests can both observe count=N (under the limit), both
 * create a new code, and the table ends up with N+2 codes — silently
 * violating the "max requests per window" invariant.
 *
 * This function serialises requests per email using a PostgreSQL advisory
 * transaction lock keyed on hash(email), then runs the count and the insert
 * inside the same transaction so the invariant is enforced.
 *
 * Every successful call issues a fresh 15-minute magic link, including for
 * emails that already correspond to a registered participant. The new row
 * inherits the existing participant_id (if any) so the link, once consumed,
 * lands the user on the same participant record — and validateMagicLink
 * revokes any other access codes for the same email at consumption time.
 *
 * Returns `null` when the quota is already exhausted (caller should respond
 * with the email-enumeration-safe success message anyway).
 */
export async function createMagicLinkUnderQuota(
  email: string,
  maxRequests: number,
  windowMs: number,
): Promise<{ code: string } | null> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    // Per-email lock prevents concurrent count/insert races.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [email]);

    // Look up an existing participant_id so the new magic link is bound to
    // the same participant on consumption. Returns null for first-time
    // emails — the registration flow will set participant_id later.
    const existingLink = await client.query<{ participant_id: number | null }>(
      'SELECT participant_id FROM access_codes WHERE email = $1 AND participant_id IS NOT NULL ORDER BY created_at DESC LIMIT 1',
      [email],
    );
    const participantId = existingLink.rows[0]?.participant_id ?? null;

    const since = new Date(Date.now() - windowMs).toISOString();
    const countResult = await client.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM access_codes WHERE email = $1 AND expires_at IS NOT NULL AND created_at > $2',
      [email, since],
    );
    const recent = parseInt(countResult.rows[0]?.count ?? '0', 10);
    if (recent >= maxRequests) {
      await client.query('COMMIT');
      return null;
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await client.query(
      'INSERT INTO access_codes (code, email, role, participant_id, expires_at) VALUES ($1, $2, $3, $4, $5)',
      [code, email, 'participant', participantId, expiresAt],
    );
    await client.query('COMMIT');
    return { code };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {/* already failed; nothing to undo */});
    throw error;
  } finally {
    client.release();
  }
}
