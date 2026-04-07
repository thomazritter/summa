import { query, closeDb } from './connection.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function seed() {
  // ─── Users ────────────────────────────────────────────────────────
  await query(
    `INSERT INTO users (id, name, email) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [1, 'Test User', 'test@example.com'],
  );

  // ─── Profiles ─────────────────────────────────────────────────────
  const insertProfile = `
    INSERT INTO profiles (id, user_id, name, expertise, focus, depth, context)
    VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING
  `;

  await query(insertProfile, [1, 1, 'Default Profile', 'intermediate', 'all', 'moderate', 'learning']);
  await query(insertProfile, [99, 1, 'Generic (Controle)', 'intermediate', 'all', 'moderate', 'learning']);

  const experimentProfiles = [
    { id: 100, userId: 1, name: 'Dev Junior (Iniciante)', expertise: 'beginner', focus: 'concepts', depth: 'moderate', context: 'learning' },
    { id: 101, userId: 1, name: 'Dev Pleno (Intermediario)', expertise: 'intermediate', focus: 'methodology', depth: 'detailed', context: 'research' },
    { id: 102, userId: 1, name: 'Dev Senior (Avancado)', expertise: 'advanced', focus: 'results', depth: 'comprehensive', context: 'research' },
  ];

  for (const p of experimentProfiles) {
    await query(insertProfile, [p.id, p.userId, p.name, p.expertise, p.focus, p.depth, p.context]);
  }

  // ─── Articles ─────────────────────────────────────────────────────
  const articles = JSON.parse(readFileSync(join(__dirname, 'seed-articles.json'), 'utf-8'));

  for (const a of articles) {
    await query(
      `INSERT INTO articles (id, title, authors, year, doi, url, raw_text, structured_content)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
      [a.id, a.title, a.authors || null, a.year || null, a.doi || null, a.url || null, a.raw_text || null, a.structured_content || null],
    );
  }

  // ─── Summaries ────────────────────────────────────────────────────
  const summaries = JSON.parse(readFileSync(join(__dirname, 'seed-summaries.json'), 'utf-8'));

  for (const s of summaries) {
    await query(
      `INSERT INTO summaries (id, article_id, profile_id, content, factuality_score, factuality_details)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [s.id, s.article_id, s.profile_id, s.content, s.factuality_score || null, s.factuality_details || null],
    );
  }

  // ─── Reset sequences ─────────────────────────────────────────────
  await query(`SELECT setval('articles_id_seq', (SELECT COALESCE(MAX(id), 0) FROM articles))`);
  await query(`SELECT setval('summaries_id_seq', (SELECT COALESCE(MAX(id), 0) FROM summaries))`);
  await query(`SELECT setval('profiles_id_seq', (SELECT COALESCE(MAX(id), 0) FROM profiles))`);
  await query(`SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 0) FROM users))`);

  console.log('Database seeded successfully!');
  console.log(`- ${articles.length} articles`);
  console.log(`- ${summaries.length} summaries`);
  console.log('- 5 profiles (default, generic, junior, pleno, senior)');

  await closeDb();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
