/**
 * Pre-generate summaries for the experiment.
 *
 * For each article in the database, generates:
 * - 1 generic summary (profile_id=99)
 * - 1 summary per experiment profile (ids 100, 101, 102)
 *
 * Run this ONCE before the experiment:
 *   cd /Users/thomazjusto/Documents/TCC/project/summarizer
 *   npx tsx packages/api/src/scripts/pregenerate.ts
 *
 * Prerequisites:
 * - Ollama running with llama3.1:8b
 * - Database migrated and seeded
 * - Articles uploaded to the database
 */

import { queryOne, queryAll, closeDb } from '../db/connection.js';
import { generateSummary, generateGenericSummary } from '../services/summarizationService.js';

const EXPERIMENT_PROFILE_IDS = [100, 101, 102]; // junior, pleno, senior
const GENERIC_PROFILE_ID = 99;

async function pregenerate() {
  // Get all articles
  const articles = await queryAll<{ id: number; title: string }>('SELECT id, title FROM articles');

  if (articles.length === 0) {
    console.error('Nenhum artigo encontrado no banco. Faca upload dos artigos antes de rodar este script.');
    process.exit(1);
  }

  console.log(`Encontrados ${articles.length} artigo(s). Iniciando pre-geracao...\n`);

  for (const article of articles) {
    console.log(`=== Artigo ${article.id}: ${article.title} ===\n`);

    // Check if generic summary already exists
    const existingGeneric = await queryOne<{ id: number }>(
      'SELECT id FROM summaries WHERE article_id = $1 AND profile_id = $2',
      [article.id, GENERIC_PROFILE_ID],
    );

    if (existingGeneric) {
      console.log(`  [SKIP] Resumo generico ja existe (id=${existingGeneric.id})`);
    } else {
      console.log('  Gerando resumo GENERICO...');
      const start = Date.now();
      const summary = await generateGenericSummary(article.id);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  [OK] Resumo generico gerado (id=${summary.id}) em ${elapsed}s`);
    }

    // Generate personalized summaries for each profile
    for (const profileId of EXPERIMENT_PROFILE_IDS) {
      const existingPersonalized = await queryOne<{ id: number }>(
        'SELECT id FROM summaries WHERE article_id = $1 AND profile_id = $2',
        [article.id, profileId],
      );

      if (existingPersonalized) {
        console.log(`  [SKIP] Resumo perfil ${profileId} ja existe (id=${existingPersonalized.id})`);
        continue;
      }

      const profileName = profileId === 100 ? 'Junior' : profileId === 101 ? 'Pleno' : 'Senior';
      console.log(`  Gerando resumo PERSONALIZADO (${profileName}, perfil ${profileId})...`);
      const start = Date.now();
      const summary = await generateSummary(article.id, profileId);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  [OK] Resumo ${profileName} gerado (id=${summary.id}) em ${elapsed}s`);
    }

    console.log('');
  }

  console.log('Pre-geracao concluida!');
  console.log(`Total de resumos: ${articles.length * 4} (1 generico + 3 personalizados por artigo)`);

  // Summary of what was generated
  const totalSummaries = await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM summaries');
  console.log(`Resumos no banco: ${totalSummaries?.count ?? 0}`);

  await closeDb();
  process.exit(0);
}

pregenerate().catch(async (err) => {
  console.error('Erro na pre-geracao:', err);
  await closeDb();
  process.exit(1);
});
