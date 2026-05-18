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

    -- Legacy ROUGE/BERTScore columns dropped (FineSurE replaced these metrics).
    ALTER TABLE summaries DROP COLUMN IF EXISTS rouge_1;
    ALTER TABLE summaries DROP COLUMN IF EXISTS rouge_2;
    ALTER TABLE summaries DROP COLUMN IF EXISTS rouge_l;
    ALTER TABLE summaries DROP COLUMN IF EXISTS bert_score;

    ALTER TABLE participants ADD COLUMN IF NOT EXISTS structure_preference TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS profile_source TEXT DEFAULT 'questionnaire';

    -- Single-value direct profile dimensions. The legacy override_*/cv_*
    -- split was collapsed into one column per dimension, with a _manual
    -- boolean tracking whether the value was last set via manual UI edit.
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS expertise TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS focus TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS depth TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS context TEXT;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS expertise_manual BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS focus_manual BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS depth_manual BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE participants ADD COLUMN IF NOT EXISTS context_manual BOOLEAN NOT NULL DEFAULT FALSE;

    -- profile_id used to be NOT NULL pointing to the 100/101/102 persona
    -- slots. New personalized summaries persist their config in
    -- profile_snapshot instead, so the column is now nullable.
    ALTER TABLE summaries ALTER COLUMN profile_id DROP NOT NULL;

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

  // Profile data-model cleanup (2026-05-18): collapse legacy
  // override_*/cv_* into single value columns + per-dimension _manual
  // flag, and drop questionnaire fields no longer used by the prompt.
  // The block is wrapped in a DO so we can guard the backfill on the
  // legacy columns still being present — fresh installs and already-
  // migrated environments skip the backfill safely.
  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'participants' AND column_name = 'override_expertise'
      ) THEN
        UPDATE participants
        SET expertise        = COALESCE(expertise, override_expertise, cv_expertise),
            focus            = COALESCE(focus,     override_focus,     cv_focus),
            depth            = COALESCE(depth,     override_depth,     cv_depth),
            context          = COALESCE(context,   override_context,   cv_context),
            expertise_manual = expertise_manual OR override_expertise IS NOT NULL,
            focus_manual     = focus_manual     OR override_focus     IS NOT NULL,
            depth_manual     = depth_manual     OR override_depth     IS NOT NULL,
            context_manual   = context_manual   OR override_context   IS NOT NULL;
      END IF;
    END
    $$;

    ALTER TABLE participants DROP COLUMN IF EXISTS override_expertise;
    ALTER TABLE participants DROP COLUMN IF EXISTS override_focus;
    ALTER TABLE participants DROP COLUMN IF EXISTS override_depth;
    ALTER TABLE participants DROP COLUMN IF EXISTS override_context;
    ALTER TABLE participants DROP COLUMN IF EXISTS cv_expertise;
    ALTER TABLE participants DROP COLUMN IF EXISTS cv_focus;
    ALTER TABLE participants DROP COLUMN IF EXISTS cv_depth;
    ALTER TABLE participants DROP COLUMN IF EXISTS cv_context;
    ALTER TABLE participants DROP COLUMN IF EXISTS experience_level;
    ALTER TABLE participants DROP COLUMN IF EXISTS years_experience;
    ALTER TABLE participants DROP COLUMN IF EXISTS reading_frequency;
    ALTER TABLE participants DROP COLUMN IF EXISTS topic_familiarity;
    ALTER TABLE participants DROP COLUMN IF EXISTS english_comfort;
    ALTER TABLE participants DROP COLUMN IF EXISTS reading_goal;
    ALTER TABLE participants DROP COLUMN IF EXISTS preferred_length;
  `);
  console.log('[auto-migrate] Profile data-model cleanup applied.');

  // 2d. Add index for email lookups on access_codes
  await query('CREATE INDEX IF NOT EXISTS idx_access_codes_email ON access_codes(email);');
  console.log('[auto-migrate] access_codes indexes ensured.');

  // Legacy P-Accuracy table dropped (FineSurE replaced these metrics).
  await query('DROP TABLE IF EXISTS p_accuracy_scores;');
  console.log('[auto-migrate] legacy p_accuracy_scores table dropped if present.');

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
