import { getDb } from '../db/connection.js';

export function validateCode(code: string) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM access_codes WHERE code = ?').get(code);
  return row || null;
}

export function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'SUMMA-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function createAccessCode(email: string, role: 'participant' | 'manager' = 'participant') {
  const db = getDb();
  const code = generateCode();
  db.prepare('INSERT INTO access_codes (code, email, role) VALUES (?, ?, ?)').run(code, email, role);
  return code;
}
