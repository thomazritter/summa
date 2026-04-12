import crypto from 'crypto';
import { queryOne, execute } from '../db/connection.js';

export interface AccessCodeRow {
  id: number;
  code: string;
  email: string;
  role: string;
  participant_id: number | null;
  used_at: string | null;
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
