import { query, closeDb } from './connection.js';

async function seed() {
  // Create a test user
  await query(
    `INSERT INTO users (id, name, email) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [1, 'Test User', 'test@example.com'],
  );

  // Create a default profile for the test user
  const insertProfile = `
    INSERT INTO profiles (id, user_id, name, expertise, focus, depth, context)
    VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING
  `;

  await query(insertProfile, [1, 1, 'Default Profile', 'intermediate', 'all', 'moderate', 'learning']);

  // Generic profile used for control summaries in the experiment (no parameterization)
  await query(insertProfile, [99, 1, 'Generic (Controle)', 'intermediate', 'all', 'moderate', 'learning']);

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
    await query(insertProfile, [
      profile.id,
      profile.userId,
      profile.name,
      profile.expertise,
      profile.focus,
      profile.depth,
      profile.context,
    ]);
  }

  console.log('Database seeded successfully!');
  console.log('- Created test user (id: 1, email: test@example.com)');
  console.log('- Created default profile (id: 1)');
  console.log('- Created generic profile (id: 99)');
  console.log('- Created experiment profiles:');
  console.log('  - Dev Junior (id: 100)');
  console.log('  - Dev Pleno (id: 101)');
  console.log('  - Dev Senior (id: 102)');

  await closeDb();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
