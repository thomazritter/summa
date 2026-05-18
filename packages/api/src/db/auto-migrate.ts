import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, queryOne } from './connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Apply the canonical schema and seed the manager access code.
 *
 * The schema is idempotent (all CREATE statements use IF NOT EXISTS), so
 * this can be safely called on startup against any DB state. There is no
 * legacy migration path: the system was rebuilt from scratch on
 * 2026-05-18, and pre-rebuild data lives in
 * /Users/thomazjusto/Documents/TCC/db_archive_2026-05-18/ for audit only.
 */
export async function runMigrations(): Promise<void> {
  console.log('[auto-migrate] Applying schema...');
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await query(schema);
  console.log('[auto-migrate] Schema applied.');

  // Seed the manager access code so the operator can always log in.
  const managerCode = process.env.MANAGER_CODE || 'SUMMA-ADMIN';
  const managerEmail = process.env.MANAGER_EMAIL || 'thomaz.ritter207@gmail.com';
  const existing = await queryOne('SELECT id FROM access_codes WHERE code = $1', [managerCode]);
  if (!existing) {
    await query(
      'INSERT INTO access_codes (code, email, role) VALUES ($1, $2, $3)',
      [managerCode, managerEmail, 'manager'],
    );
    console.log(`[auto-migrate] Manager code seeded: ${managerCode}`);
  }

  console.log('[auto-migrate] Migrations complete.');
}
