import { queryOne, execute } from '../db/connection.js';

export async function validateCode(code: string) {
  const row = await queryOne('SELECT * FROM access_codes WHERE code = $1', [code]);
  return row || null;
}

export function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'SUMMA-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function createAccessCode(email: string, role: 'participant' | 'manager' = 'participant') {
  const code = generateCode();
  await execute('INSERT INTO access_codes (code, email, role) VALUES ($1, $2, $3)', [code, email, role]);
  return code;
}
