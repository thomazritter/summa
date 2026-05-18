-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  expertise TEXT NOT NULL CHECK (expertise IN ('beginner', 'intermediate', 'advanced', 'expert')),
  focus TEXT NOT NULL CHECK (focus IN ('concepts', 'methodology', 'results', 'applications', 'all')),
  depth TEXT NOT NULL CHECK (depth IN ('brief', 'moderate', 'detailed', 'comprehensive')),
  context TEXT NOT NULL CHECK (context IN ('quick_review', 'learning', 'research', 'teaching')),
  custom_preferences TEXT, -- JSON for extensibility
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Articles table
CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  authors TEXT,
  year INTEGER,
  doi TEXT,
  url TEXT,
  raw_text TEXT NOT NULL,
  structured_content TEXT NOT NULL, -- JSON
  uploaded_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Summaries table
-- `profile_id` references the legacy persona slots in `profiles` (98/99/100/
-- 101/102) and is preserved nullable for backward compatibility with the
-- historical N=9 experiment rows. New personalized summaries leave this
-- column NULL — the actual generation config travels in `profile_snapshot`.
CREATE TABLE IF NOT EXISTS summaries (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL,
  profile_id INTEGER,
  content TEXT NOT NULL,
  factuality_score REAL,
  factuality_details TEXT, -- JSON
  -- Per-summary snapshot of profile dimensions + auxiliary preferences that
  -- were active at generation time. Lets the system reproduce what produced
  -- this row even after the user edits their profile later.
  profile_snapshot JSONB,
  -- Lifecycle of the async factuality job: 'pending' | 'complete' | 'failed' | 'skipped'.
  factuality_status TEXT DEFAULT 'pending',
  generated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_summaries_article_id ON summaries(article_id);
CREATE INDEX IF NOT EXISTS idx_summaries_profile_id ON summaries(profile_id);

-- Trigger function to update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop triggers first to make re-runs idempotent, then recreate
DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─── Experiment Mode Tables ──────────────────────────────────────────

-- Participants table — single flat profile per participant.
-- Each dimension/aux preference has a value column and a `_manual` boolean
-- indicating whether the value was last set via manual UI edit (true) or via
-- the questionnaire/CV path (false). Questionnaire and CV are frontend input
-- paths that write into the same columns.
CREATE TABLE IF NOT EXISTS participants (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Unique constraint preventing duplicate generic summaries per article.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_generic_variant ON summaries(article_id, profile_id) WHERE profile_id IN (98, 99);

-- ─── Embedded Feedback Tables ──────────────────────────────────────

-- Likert ratings per summary, collected from the product summary view.
CREATE TABLE IF NOT EXISTS summary_ratings (
  id SERIAL PRIMARY KEY,
  summary_id INTEGER NOT NULL,
  participant_id INTEGER,
  source TEXT DEFAULT 'product',
  utilidade INTEGER NOT NULL CHECK (utilidade BETWEEN 1 AND 5),
  clareza INTEGER NOT NULL CHECK (clareza BETWEEN 1 AND 5),
  adequacao_perfil INTEGER NOT NULL CHECK (adequacao_perfil BETWEEN 1 AND 5),
  factualidade_percebida INTEGER NOT NULL CHECK (factualidade_percebida BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (summary_id) REFERENCES summaries(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
);
-- idx_summary_ratings_participant (WHERE source = 'product') is created in
-- auto-migrate.ts AFTER the source column is added via ALTER TABLE, to remain
-- compatible with pre-existing databases where the column did not yet exist.

-- ─── Access Codes (Auth) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS access_codes (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('participant', 'manager')) DEFAULT 'participant',
  participant_id INTEGER,
  used_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_access_codes_code ON access_codes(code);
CREATE INDEX IF NOT EXISTS idx_access_codes_email ON access_codes(email);

-- ─── Profile dimensions ─────────────────────────────────────────
-- Each dimension is a single value column plus a `_manual` boolean flag
-- that marks whether the value was last set via manual edit. The flag is
-- the only source-tracking signal at the backend layer; the questionnaire
-- and CV flows both write the value with manual=false.
ALTER TABLE participants ADD COLUMN IF NOT EXISTS expertise TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS focus TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS depth TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS context TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS expertise_manual BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS focus_manual BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS depth_manual BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS context_manual BOOLEAN NOT NULL DEFAULT FALSE;

-- Auxiliary profile preferences.
ALTER TABLE participants ADD COLUMN IF NOT EXISTS domain TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS current_project TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS domain_manual BOOLEAN DEFAULT FALSE;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS current_project_manual BOOLEAN DEFAULT FALSE;

-- Initial input path (questionnaire | cv). Informational only — the
-- backend treats both paths identically for dimension storage.
ALTER TABLE participants ADD COLUMN IF NOT EXISTS profile_source TEXT DEFAULT 'questionnaire';

-- ─── Model Tracking ───────────────────────────────────────────────

ALTER TABLE summaries ADD COLUMN IF NOT EXISTS model_id TEXT;

-- ─── Guided Regeneration Lineage ──────────────────────────────────

ALTER TABLE summaries ADD COLUMN IF NOT EXISTS parent_summary_id INTEGER REFERENCES summaries(id) ON DELETE SET NULL;

