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

export async function createAccessCode(email: string, role: 'participant' | 'manager' = 'participant') {
  const code = generateCode();
  await execute('INSERT INTO access_codes (code, email, role) VALUES ($1, $2, $3)', [code, email, role]);
  return code;
}

// createMagicLink (non-atomic) and countRecentMagicLinks were removed once the
// /magic-link route migrated to createMagicLinkUnderQuota, which combines the
// quota check and code insertion inside a single advisory-locked transaction.

/**
 * Validate a magic link code, checking expiration.
 * On success, clears expires_at so the code becomes a permanent session token.
 */
export async function validateMagicLink(code: string): Promise<AccessCodeRow | null> {
  const access = await queryOne<AccessCodeRow>(
    'SELECT * FROM access_codes WHERE code = $1',
    [code],
  );

  if (!access) return null;

  // If expires_at is set, check it hasn't expired
  if (access.expires_at) {
    const expiresAt = new Date(access.expires_at);
    if (expiresAt < new Date()) {
      return null; // Expired
    }

    // Valid magic link — clear expiration to make it a permanent session token
    await execute(
      'UPDATE access_codes SET expires_at = NULL, used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [access.id],
    );
    access.expires_at = null;
    access.used_at = new Date().toISOString();
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

    // Reuse a permanent code if the email is already a registered participant.
    const existing = await client.query<AccessCodeRow>(
      'SELECT * FROM access_codes WHERE email = $1 ORDER BY created_at DESC LIMIT 1',
      [email],
    );
    if (existing.rows[0]?.participant_id != null) {
      await client.query('COMMIT');
      return { code: existing.rows[0].code };
    }

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
      'INSERT INTO access_codes (code, email, role, expires_at) VALUES ($1, $2, $3, $4)',
      [code, email, 'participant', expiresAt],
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
