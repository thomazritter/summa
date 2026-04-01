import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/summarizer.db');

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

// Create a test user
const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (id, name, email)
  VALUES (1, 'Test User', 'test@example.com')
`);

insertUser.run();

// Create a default profile for the test user
const insertProfile = db.prepare(`
  INSERT OR IGNORE INTO profiles (id, user_id, name, expertise, focus, depth, context)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

insertProfile.run(1, 1, 'Default Profile', 'intermediate', 'all', 'moderate', 'learning');

// Generic profile used for control summaries in the experiment (no parameterization)
insertProfile.run(99, 1, 'Generic (Controle)', 'intermediate', 'all', 'moderate', 'learning');

// ─── Experiment Profiles ────────────────────────────────────────────
// These are the 3 pre-defined profiles matching the experiment protocol.
// They use user_id=1 (test user) and fixed IDs 100, 101, 102 to avoid conflicts.

const experimentProfiles = [
  {
    id: 100,
    userId: 1,
    name: 'Dev Junior (Iniciante)',
    expertise: 'beginner',
    focus: 'concepts',
    depth: 'moderate',
    context: 'learning',
  },
  {
    id: 101,
    userId: 1,
    name: 'Dev Pleno (Intermediario)',
    expertise: 'intermediate',
    focus: 'methodology',
    depth: 'detailed',
    context: 'research',
  },
  {
    id: 102,
    userId: 1,
    name: 'Dev Senior (Avancado)',
    expertise: 'advanced',
    focus: 'results',
    depth: 'comprehensive',
    context: 'research',
  },
];

for (const profile of experimentProfiles) {
  insertProfile.run(
    profile.id,
    profile.userId,
    profile.name,
    profile.expertise,
    profile.focus,
    profile.depth,
    profile.context
  );
}

console.log('Database seeded successfully!');
console.log('- Created test user (id: 1, email: test@example.com)');
console.log('- Created default profile (id: 1)');
console.log('- Created generic profile (id: 99)');
console.log('- Created experiment profiles:');
console.log('  - Dev Junior (id: 100)');
console.log('  - Dev Pleno (id: 101)');
console.log('  - Dev Senior (id: 102)');

db.close();
