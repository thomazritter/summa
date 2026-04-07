import { getDb, closeDb } from './connection.js';

const db = getDb();

console.log('Running auth migration...');

db.exec(`
  CREATE TABLE IF NOT EXISTS access_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('participant', 'manager')) DEFAULT 'participant',
    participant_id INTEGER,
    used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_access_codes_code ON access_codes(code);
`);

// Seed manager code
const managerCode = process.env.MANAGER_CODE || 'SUMMA-ADMIN';
const managerEmail = process.env.MANAGER_EMAIL || 'thomaz.ritter207@gmail.com';

const existing = db.prepare('SELECT id FROM access_codes WHERE code = ?').get(managerCode);
if (!existing) {
  db.prepare('INSERT INTO access_codes (code, email, role) VALUES (?, ?, ?)').run(managerCode, managerEmail, 'manager');
  console.log(`Manager code seeded: ${managerCode} (${managerEmail})`);
} else {
  console.log(`Manager code already exists: ${managerCode}`);
}

console.log('Auth migration complete.');
closeDb();
