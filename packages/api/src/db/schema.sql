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
CREATE TABLE IF NOT EXISTS summaries (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL,
  profile_id INTEGER NOT NULL,
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

-- Participants table (experiment pre-test data)
CREATE TABLE IF NOT EXISTS participants (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  experience_level TEXT NOT NULL CHECK (experience_level IN ('junior', 'pleno', 'senior')),
  years_experience INTEGER NOT NULL,
  reading_frequency TEXT NOT NULL CHECK (reading_frequency IN ('never', 'rarely', 'sometimes', 'frequently')),
  topic_familiarity TEXT NOT NULL CHECK (topic_familiarity IN ('none', 'little', 'moderate', 'high')),
  structure_preference TEXT CHECK (structure_preference IN ('prose', 'bullets', 'mixed')),
  reading_goal TEXT CHECK (reading_goal IN ('overview', 'methodology', 'results', 'practical')),
  preferred_length TEXT CHECK (preferred_length IN ('brief', 'moderate', 'detailed')),
  english_comfort TEXT, -- deprecated; column kept to preserve historical experiment data
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

-- ─── Profile Overrides & Snapshot ───────────────────────────────────

ALTER TABLE participants ADD COLUMN IF NOT EXISTS override_expertise TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS override_focus TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS override_depth TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS override_context TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS profile_source TEXT DEFAULT 'questionnaire';

-- Values inferred from CV are stored separately from manual overrides so the
-- UI can distinguish "inferido do currículo" from "editado manualmente".
ALTER TABLE participants ADD COLUMN IF NOT EXISTS cv_expertise TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS cv_focus TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS cv_depth TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS cv_context TEXT;

-- ─── Domain & Current Project ─────────────────────────────────────

ALTER TABLE participants ADD COLUMN IF NOT EXISTS domain TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS current_project TEXT;

-- ─── Manual-edit flags for aux fields ────────────────────────────
-- The four main dimensions (expertise/focus/depth/context) already
-- separate cv_X from override_X, so 'manual' can be derived from
-- override_X IS NOT NULL. The three auxiliary fields below have a
-- single column each (structure_preference, domain, current_project),
-- so we need explicit flags to tell the UI when the value originated
-- from a manual /profile edit vs. CV inference or questionnaire.
ALTER TABLE participants ADD COLUMN IF NOT EXISTS structure_preference_manual BOOLEAN DEFAULT FALSE;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS domain_manual BOOLEAN DEFAULT FALSE;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS current_project_manual BOOLEAN DEFAULT FALSE;

-- ─── Model Tracking ───────────────────────────────────────────────

ALTER TABLE summaries ADD COLUMN IF NOT EXISTS model_id TEXT;

-- ─── Guided Regeneration Lineage ──────────────────────────────────

ALTER TABLE summaries ADD COLUMN IF NOT EXISTS parent_summary_id INTEGER REFERENCES summaries(id) ON DELETE SET NULL;

