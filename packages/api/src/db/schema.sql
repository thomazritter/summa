-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  expertise TEXT NOT NULL CHECK (expertise IN ('beginner', 'intermediate', 'advanced', 'expert')),
  focus TEXT NOT NULL CHECK (focus IN ('concepts', 'methodology', 'results', 'applications', 'all')),
  depth TEXT NOT NULL CHECK (depth IN ('brief', 'moderate', 'detailed', 'comprehensive')),
  context TEXT NOT NULL CHECK (context IN ('quick_review', 'learning', 'research', 'teaching')),
  custom_preferences TEXT, -- JSON for extensibility
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Articles table
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  authors TEXT,
  year INTEGER,
  doi TEXT,
  url TEXT,
  raw_text TEXT NOT NULL,
  structured_content TEXT NOT NULL, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Summaries table
CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  profile_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  factuality_score REAL,
  factuality_details TEXT, -- JSON
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Feedback table
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  summary_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  utility_rating INTEGER NOT NULL CHECK (utility_rating BETWEEN 1 AND 5),
  technical_level_rating INTEGER NOT NULL CHECK (technical_level_rating BETWEEN 1 AND 5),
  depth_rating INTEGER NOT NULL CHECK (depth_rating BETWEEN 1 AND 5),
  comments TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (summary_id) REFERENCES summaries(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_summaries_article_id ON summaries(article_id);
CREATE INDEX IF NOT EXISTS idx_summaries_profile_id ON summaries(profile_id);
CREATE INDEX IF NOT EXISTS idx_feedback_summary_id ON feedback(summary_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);

-- Triggers to update updated_at timestamps
CREATE TRIGGER IF NOT EXISTS users_updated_at
AFTER UPDATE ON users
BEGIN
  UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS profiles_updated_at
AFTER UPDATE ON profiles
BEGIN
  UPDATE profiles SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- ─── Experiment Mode Tables ──────────────────────────────────────────

-- Participants table (experiment pre-test data)
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  experience_level TEXT NOT NULL CHECK (experience_level IN ('junior', 'pleno', 'senior')),
  years_experience INTEGER NOT NULL,
  reading_frequency TEXT NOT NULL CHECK (reading_frequency IN ('never', 'rarely', 'sometimes', 'frequently')),
  topic_familiarity TEXT NOT NULL CHECK (topic_familiarity IN ('none', 'little', 'moderate', 'high')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Experiment sessions table (one per participant + article combination)
CREATE TABLE IF NOT EXISTS experiment_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL,
  article_id INTEGER NOT NULL,
  profile_id INTEGER NOT NULL,
  generic_summary_id INTEGER NOT NULL,
  personalized_summary_id INTEGER NOT NULL,
  ab_order TEXT NOT NULL, -- JSON: {"A": "generic"|"personalized", "B": "generic"|"personalized"}
  preference TEXT CHECK (preference IN ('A', 'B')),
  phase TEXT NOT NULL DEFAULT 'comparison' CHECK (phase IN ('comparison', 'feedback', 'regenerated', 'complete')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (generic_summary_id) REFERENCES summaries(id) ON DELETE CASCADE,
  FOREIGN KEY (personalized_summary_id) REFERENCES summaries(id) ON DELETE CASCADE
);

-- Regenerations table (feedback cycle data)
CREATE TABLE IF NOT EXISTS regenerations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  feedback_text TEXT NOT NULL,
  regenerated_summary_id INTEGER NOT NULL,
  improvement_rating TEXT CHECK (improvement_rating IN ('improved', 'same', 'worse')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES experiment_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (regenerated_summary_id) REFERENCES summaries(id) ON DELETE CASCADE
);

-- Indexes for experiment tables
CREATE INDEX IF NOT EXISTS idx_experiment_sessions_participant ON experiment_sessions(participant_id);
CREATE INDEX IF NOT EXISTS idx_experiment_sessions_article ON experiment_sessions(article_id);
CREATE INDEX IF NOT EXISTS idx_regenerations_session ON regenerations(session_id);

-- ─── Embedded Feedback Tables ──────────────────────────────────────

-- Likert ratings per summary (Trial page, Phase 1)
CREATE TABLE IF NOT EXISTS summary_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  summary_id INTEGER NOT NULL,
  ab_label TEXT NOT NULL CHECK (ab_label IN ('A', 'B')),
  utilidade INTEGER NOT NULL CHECK (utilidade BETWEEN 1 AND 5),
  clareza INTEGER NOT NULL CHECK (clareza BETWEEN 1 AND 5),
  adequacao_perfil INTEGER NOT NULL CHECK (adequacao_perfil BETWEEN 1 AND 5),
  factualidade_percebida INTEGER NOT NULL CHECK (factualidade_percebida BETWEEN 1 AND 5),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES experiment_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (summary_id) REFERENCES summaries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_summary_ratings_session ON summary_ratings(session_id);

-- Post-test responses (replaces Google Forms)
CREATE TABLE IF NOT EXISTS post_test_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL UNIQUE,
  overall_satisfaction INTEGER NOT NULL CHECK (overall_satisfaction BETWEEN 1 AND 5),
  would_use_again INTEGER NOT NULL CHECK (would_use_again BETWEEN 1 AND 5),
  comments TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
);

-- ─── Access Codes (Auth) ─────────────────────────────────────────────

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
