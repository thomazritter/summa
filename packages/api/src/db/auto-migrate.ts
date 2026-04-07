import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function runMigrations(): void {
  const db = getDb();

  console.log('[auto-migrate] Running database migrations...');

  // 1. Execute schema.sql (all CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS)
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
    console.log('[auto-migrate] Schema applied.');
  } else {
    console.warn('[auto-migrate] schema.sql not found, skipping schema creation.');
  }

  // 2. ALTER TABLE migrations (idempotent - ignore "duplicate column" errors)
  const alterMigrations = [
    'ALTER TABLE regenerations ADD COLUMN satisfaction_rating INTEGER CHECK (satisfaction_rating BETWEEN 1 AND 5)',
  ];

  for (const sql of alterMigrations) {
    try {
      db.exec(sql);
      console.log(`[auto-migrate] Applied: ${sql.substring(0, 60)}...`);
    } catch (e: any) {
      if (e.message.includes('duplicate column')) {
        // Already applied, skip
      } else {
        console.error(`[auto-migrate] Failed: ${sql}`, e.message);
      }
    }
  }

  // 3. Seed manager access code if it doesn't exist
  const managerCode = process.env.MANAGER_CODE || 'SUMMA-ADMIN';
  const managerEmail = process.env.MANAGER_EMAIL || 'thomaz.ritter207@gmail.com';

  const existing = db.prepare('SELECT id FROM access_codes WHERE code = ?').get(managerCode);
  if (!existing) {
    db.prepare('INSERT INTO access_codes (code, email, role) VALUES (?, ?, ?)').run(
      managerCode,
      managerEmail,
      'manager'
    );
    console.log(`[auto-migrate] Manager code seeded: ${managerCode}`);
  }

  console.log('[auto-migrate] Migrations complete.');
}
