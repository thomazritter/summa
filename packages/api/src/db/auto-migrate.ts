import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, queryOne } from './connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<void> {
  console.log('[auto-migrate] Running database migrations...');

  // 1. Execute schema.sql (all CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS)
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    await query(schema);
    console.log('[auto-migrate] Schema applied.');
  } else {
    console.warn('[auto-migrate] schema.sql not found, skipping schema creation.');
  }

  // 2. Seed manager access code if it doesn't exist
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
