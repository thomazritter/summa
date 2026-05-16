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

    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS rouge_1 REAL;
    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS rouge_2 REAL;
    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS rouge_l REAL;
    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS bert_score REAL;

    ALTER TABLE participants ADD COLUMN IF NOT EXISTS structure_preference TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS reading_goal TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS preferred_length TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS english_comfort TEXT;

    ALTER TABLE participants ADD COLUMN IF NOT EXISTS override_expertise TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS override_focus TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS override_depth TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS override_context TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS profile_source TEXT DEFAULT 'questionnaire';

    ALTER TABLE participants ADD COLUMN IF NOT EXISTS cv_expertise TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS cv_focus TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS cv_depth TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS cv_context TEXT;

    ALTER TABLE articles ADD COLUMN IF NOT EXISTS uploaded_by INTEGER;

    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS model_id TEXT;

    ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
    -- consumed_at marks the moment a magic link is exchanged for a session.
    -- Magic links (rows with a non-null expires_at) are rejected on
    -- subsequent /auth/login attempts once consumed_at is set; permanent
    -- codes (SUMMA-ADMIN, no expires_at) ignore this and stay reusable.
    ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMP;

    ALTER TABLE participants ADD COLUMN IF NOT EXISTS domain TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS current_project TEXT;

    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS parent_summary_id INTEGER REFERENCES summaries(id) ON DELETE SET NULL;

    -- Per-summary snapshot of the profile + preferences that were active when the
    -- summary was generated. Stored on every summary (experiment + product) so
    -- the row can be reproduced even after the user edits their profile later.
    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS profile_snapshot JSONB;

    -- Tracks the lifecycle of the asynchronous factuality job for each summary.
    -- 'pending' (default) → set at INSERT; the job is still running or will start.
    -- 'complete'         → checkFactuality finished successfully.
    -- 'failed'           → the job threw an error.
    -- 'skipped'          → the NLI service was unavailable when the job ran.
    -- Lets the UI distinguish "still verifying" from "verification gave up".
    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS factuality_status TEXT DEFAULT 'pending';

    -- FineSurE 3-dim persistence (Song et al. 2024).
    -- completeness_score follows Eq. 2a: fraction of abstract keyfacts covered
    -- by at least one summary sentence. NULL when no abstract was identified.
    -- conciseness_score follows Eq. 2b: fraction of summary sentences that
    -- cover at least one keyfact. NULL when no abstract was identified.
    -- factuality_keyfacts persists the full per-keyfact alignment as
    -- [{fact: string, covered: boolean, lineNumbers: number[]}], 1-indexed.
    -- Powers the "uncovered abstract points" and "low-density sentences"
    -- panels on the summary view.
    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS completeness_score REAL;
    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS conciseness_score  REAL;
    ALTER TABLE summaries ADD COLUMN IF NOT EXISTS factuality_keyfacts JSONB;

    -- Likert ratings collected from the product summary view.
    -- participant_id identifies who rated; source distinguishes legacy
    -- 'experiment' rows from current 'product' rows.
    ALTER TABLE summary_ratings ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'product';
    ALTER TABLE summary_ratings ADD COLUMN IF NOT EXISTS participant_id INTEGER REFERENCES participants(id) ON DELETE CASCADE;
  `;
  await query(alterStatements);
  console.log('[auto-migrate] ALTER TABLE migrations applied.');

  // Backfill: legacy CV participants stored inferred values in override_*.
  // Move them to cv_* and clear the overrides so the UI labels them as
  // "Inferido do currículo" instead of "Editado manualmente". Idempotent.
  await query(`
    UPDATE participants
    SET
      cv_expertise = COALESCE(cv_expertise, override_expertise),
      cv_focus     = COALESCE(cv_focus,     override_focus),
      cv_depth     = COALESCE(cv_depth,     override_depth),
      cv_context   = COALESCE(cv_context,   override_context),
      override_expertise = NULL,
      override_focus     = NULL,
      override_depth     = NULL,
      override_context   = NULL
    WHERE profile_source = 'cv'
      AND (override_expertise IS NOT NULL
        OR override_focus     IS NOT NULL
        OR override_depth     IS NOT NULL
        OR override_context   IS NOT NULL);
  `);
  console.log('[auto-migrate] CV-inferred override values backfilled into cv_* columns.');

  // 2d. Add index for email lookups on access_codes
  await query('CREATE INDEX IF NOT EXISTS idx_access_codes_email ON access_codes(email);');
  console.log('[auto-migrate] access_codes indexes ensured.');

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
    DROP INDEX IF EXISTS idx_unique_generic_summary;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_generic_variant ON summaries(article_id, profile_id) WHERE profile_id IN (98, 99);
    -- One product rating per (participant, summary) pair.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_product_rating ON summary_ratings(participant_id, summary_id) WHERE source = 'product';
    -- Lookup index for product ratings by participant (moved here from
    -- schema.sql because the WHERE clause references the source column,
    -- which only exists after the ALTER TABLE above).
    CREATE INDEX IF NOT EXISTS idx_summary_ratings_participant ON summary_ratings(participant_id) WHERE source = 'product';
  `;
  await query(uniqueConstraints);
  console.log('[auto-migrate] Unique constraints ensured.');

  // 3. Drop legacy tables from the deprecated A/B experiment flow.
  // The product runs on participants + summaries + summary_ratings only;
  // experiment_sessions/post_test_responses/regenerations carry no code
  // path in the live codebase. Snapshot of all four tables (including the
  // already-dropped feedback) is in
  // /Users/thomazjusto/Documents/TCC/db_snapshot_2026-05-16/.
  await query(`
    DROP TABLE IF EXISTS regenerations CASCADE;
    DROP TABLE IF EXISTS post_test_responses CASCADE;
    DROP TABLE IF EXISTS experiment_sessions CASCADE;
    DROP TABLE IF EXISTS feedback CASCADE;
    -- Columns inherited from the experiment trial flow that no live code
    -- path references. Both are unused in production (verified 2026-05-16:
    -- summary_ratings.session_id NULL in all rows, ab_label only set by
    -- the deleted ExperimentTrial page).
    ALTER TABLE summary_ratings DROP COLUMN IF EXISTS session_id;
    ALTER TABLE summary_ratings DROP COLUMN IF EXISTS ab_label;
  `);
  console.log('[auto-migrate] Legacy experiment tables dropped: regenerations, post_test_responses, experiment_sessions, feedback.');

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
