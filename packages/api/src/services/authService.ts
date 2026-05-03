import crypto from 'crypto';
import { queryOne, execute } from '../db/connection.js';

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

/**
 * Create a magic link access code for self-service login.
 * - If email has an existing code with a participant_id, reuse it (returning existing code).
 * - If email has a code but no participant, create a new code (allow re-registration).
 * - If no code exists, create a new one with role='participant' and 15-min expiration.
 */
export async function createMagicLink(email: string): Promise<{ code: string }> {
  const existing = await queryOne<AccessCodeRow>(
    'SELECT * FROM access_codes WHERE email = $1 ORDER BY created_at DESC LIMIT 1',
    [email],
  );

  if (existing && existing.participant_id !== null) {
    // Participant already registered — reuse their permanent code
    return { code: existing.code };
  }

  // Create a new magic link code with 15-minute expiration
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await execute(
    'INSERT INTO access_codes (code, email, role, expires_at) VALUES ($1, $2, $3, $4)',
    [code, email, 'participant', expiresAt],
  );
  return { code };
}

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
 * Count how many magic link requests an email has made in the last windowMs.
 */
export async function countRecentMagicLinks(email: string, windowMs: number): Promise<number> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const row = await queryOne<{ count: string }>(
    'SELECT COUNT(*) as count FROM access_codes WHERE email = $1 AND expires_at IS NOT NULL AND created_at > $2',
    [email, since],
  );
  return row ? parseInt(row.count, 10) : 0;
}
