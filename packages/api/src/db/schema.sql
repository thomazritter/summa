-- Summa canonical schema.
-- Single source of truth applied verbatim by auto-migrate.ts on startup.
-- All CREATE statements use IF NOT EXISTS so re-applying is idempotent.

-- ─── Articles ─────────────────────────────────────────────────────────
-- Uploaded scientific articles. `uploaded_by` stores the id of the
-- participant who uploaded the file (no FK constraint; participants may be
-- deleted while their articles remain accessible to the uploader's session).
CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  authors TEXT,
  year INTEGER,
  doi TEXT,
  url TEXT,
  raw_text TEXT NOT NULL,
  structured_content TEXT NOT NULL,
  uploaded_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─── Participants ─────────────────────────────────────────────────────
-- Single flat profile per participant. Each profile dimension has a value
-- column plus a `_manual` boolean flag marking whether the value was last
-- set via manual UI edit (true) or via the questionnaire/CV path (false).
-- Questionnaire and CV are frontend input paths that write the same columns.
-- `profile_source` records the initial input path for the UI badge.
CREATE TABLE IF NOT EXISTS participants (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  expertise TEXT,
  focus TEXT,
  depth TEXT,
  context TEXT,
  expertise_manual BOOLEAN NOT NULL DEFAULT FALSE,
  focus_manual BOOLEAN NOT NULL DEFAULT FALSE,
  depth_manual BOOLEAN NOT NULL DEFAULT FALSE,
  context_manual BOOLEAN NOT NULL DEFAULT FALSE,
  domain TEXT,
  current_project TEXT,
  domain_manual BOOLEAN DEFAULT FALSE,
  current_project_manual BOOLEAN DEFAULT FALSE,
  profile_source TEXT DEFAULT 'questionnaire',
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─── Access Codes ─────────────────────────────────────────────────────
-- Magic-link tokens: rows with `expires_at` are single-use links, rejected
-- after `consumed_at` is set. Permanent codes (the manager seed) leave both
-- timestamps NULL and remain reusable.
CREATE TABLE IF NOT EXISTS access_codes (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('participant', 'manager')) DEFAULT 'participant',
  participant_id INTEGER REFERENCES participants(id) ON DELETE SET NULL,
  used_at TIMESTAMP,
  expires_at TIMESTAMP,
  consumed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_access_codes_code ON access_codes(code);
CREATE INDEX IF NOT EXISTS idx_access_codes_email ON access_codes(email);

-- ─── Summaries ────────────────────────────────────────────────────────
-- Every summary carries a `profile_snapshot` JSONB with the dimensions and
-- auxiliary preferences that were active at generation time. The snapshot
-- makes the row reproducible even after the participant edits their
-- profile later, so each rating, regeneration, or factuality recompute
-- ties back to the exact configuration that produced the text.
--
-- FineSurE 3-dim scores (Song et al. 2024) are persisted alongside:
--   - factuality_score   → Eq. 1
--   - completeness_score → Eq. 2a (NULL when no abstract is identifiable)
--   - conciseness_score  → Eq. 2b (NULL when no abstract is identifiable)
--   - factuality_keyfacts → per-keyfact alignment for the UI panel
--
-- `factuality_status` tracks the lifecycle of the asynchronous job:
-- 'pending' | 'complete' | 'failed' | 'skipped'.
CREATE TABLE IF NOT EXISTS summaries (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  model_id TEXT,
  profile_snapshot JSONB NOT NULL,
  parent_summary_id INTEGER REFERENCES summaries(id) ON DELETE SET NULL,
  factuality_score REAL,
  factuality_details TEXT,
  completeness_score REAL,
  conciseness_score REAL,
  factuality_keyfacts JSONB,
  factuality_status TEXT DEFAULT 'pending',
  generated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_summaries_article_id ON summaries(article_id);

-- ─── Summary Ratings ──────────────────────────────────────────────────
-- Likert ratings collected from the product summary view. The unique index
-- enforces one rating per (participant, summary) pair.
CREATE TABLE IF NOT EXISTS summary_ratings (
  id SERIAL PRIMARY KEY,
  summary_id INTEGER NOT NULL REFERENCES summaries(id) ON DELETE CASCADE,
  participant_id INTEGER REFERENCES participants(id) ON DELETE CASCADE,
  source TEXT DEFAULT 'product',
  utilidade INTEGER NOT NULL CHECK (utilidade BETWEEN 1 AND 5),
  clareza INTEGER NOT NULL CHECK (clareza BETWEEN 1 AND 5),
  adequacao_perfil INTEGER NOT NULL CHECK (adequacao_perfil BETWEEN 1 AND 5),
  factualidade_percebida INTEGER NOT NULL CHECK (factualidade_percebida BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_product_rating ON summary_ratings(participant_id, summary_id) WHERE source = 'product';
CREATE INDEX IF NOT EXISTS idx_summary_ratings_participant ON summary_ratings(participant_id) WHERE source = 'product';
