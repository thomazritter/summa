import { getDb } from './connection.js';

const db = getDb();

console.log('Running embedded feedback migration...');

db.exec(`
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

  CREATE TABLE IF NOT EXISTS post_test_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL UNIQUE,
    overall_satisfaction INTEGER NOT NULL CHECK (overall_satisfaction BETWEEN 1 AND 5),
    would_use_again INTEGER NOT NULL CHECK (would_use_again BETWEEN 1 AND 5),
    comments TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
  );
`);

// ALTER TABLE for existing table - wrap in try/catch since column may already exist
try {
  db.exec(`ALTER TABLE regenerations ADD COLUMN satisfaction_rating INTEGER CHECK (satisfaction_rating BETWEEN 1 AND 5);`);
  console.log('Added satisfaction_rating column to regenerations');
} catch (e: any) {
  if (e.message.includes('duplicate column')) {
    console.log('satisfaction_rating column already exists');
  } else {
    throw e;
  }
}

console.log('Migration complete!');
