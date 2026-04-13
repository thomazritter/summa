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

  // 2. Add new columns to existing tables (idempotent)
  const alterStatements = `
    ALTER TABLE summary_ratings ADD COLUMN IF NOT EXISTS comment TEXT;

    ALTER TABLE experiment_sessions ADD COLUMN IF NOT EXISTS preference_reason TEXT;

    ALTER TABLE regenerations ADD COLUMN IF NOT EXISTS utility_rating INTEGER CHECK (utility_rating BETWEEN 1 AND 5);
    ALTER TABLE regenerations ADD COLUMN IF NOT EXISTS clarity_rating INTEGER CHECK (clarity_rating BETWEEN 1 AND 5);
    ALTER TABLE regenerations ADD COLUMN IF NOT EXISTS adequacy_rating INTEGER CHECK (adequacy_rating BETWEEN 1 AND 5);
    ALTER TABLE regenerations ADD COLUMN IF NOT EXISTS change_description TEXT;

    ALTER TABLE post_test_responses ADD COLUMN IF NOT EXISTS noticed_difference TEXT;
    ALTER TABLE post_test_responses ADD COLUMN IF NOT EXISTS difference_type TEXT;
    ALTER TABLE post_test_responses ADD COLUMN IF NOT EXISTS would_use_daily TEXT;
    ALTER TABLE post_test_responses ADD COLUMN IF NOT EXISTS improvements TEXT;

    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS rouge_1 REAL;
    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS rouge_2 REAL;
    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS rouge_l REAL;
    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS bert_score REAL;

    ALTER TABLE participants ADD COLUMN IF NOT EXISTS structure_preference TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS reading_goal TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS preferred_length TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS english_comfort TEXT;

    ALTER TABLE experiment_sessions ADD COLUMN IF NOT EXISTS preference_rating INTEGER;
  `;
  await query(alterStatements);
  console.log('[auto-migrate] ALTER TABLE migrations applied.');

  // 2b. Create p_accuracy_scores table if not exists
  const pAccuracyTable = `
    CREATE TABLE IF NOT EXISTS p_accuracy_scores (
      id SERIAL PRIMARY KEY,
      article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      p_accuracy_rouge REAL,
      avg_pairwise_rouge_l REAL,
      pairwise_details TEXT,
      computed_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(article_id)
    );
  `;
  await query(pAccuracyTable);
  console.log('[auto-migrate] p_accuracy_scores table ensured.');

  // 2c. Add unique constraints to prevent race-condition duplicates
  const uniqueConstraints = `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_session_participant_article ON experiment_sessions(participant_id, article_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_generic_summary ON summaries(article_id, profile_id) WHERE profile_id = 99;
  `;
  await query(uniqueConstraints);
  console.log('[auto-migrate] Unique constraints ensured.');

  // 3. Drop legacy columns from post_test_responses if they still exist
  // (overall_satisfaction and would_use_again replaced by new text fields)
  try {
    await query(`
      ALTER TABLE post_test_responses DROP COLUMN IF EXISTS overall_satisfaction;
      ALTER TABLE post_test_responses DROP COLUMN IF EXISTS would_use_again;
    `);
    console.log('[auto-migrate] Legacy post_test_responses columns dropped.');
  } catch {
    // Columns may already be gone on fresh databases; ignore errors
  }

  // 4. Seed manager access code if it doesn't exist
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
