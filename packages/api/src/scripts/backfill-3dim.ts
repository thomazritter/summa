/**
 * Backfill the FineSurE 3-dim columns (completeness_score, conciseness_score,
 * factuality_keyfacts) on summaries that already have faithfulness persisted
 * but were checked before the schema added those columns.
 *
 * Idempotent: skips any summary that already has completeness_score set, so
 * re-running the script after a partial failure only processes the leftovers.
 *
 * Run with:
 *   railway run --service @summarizer/api -- npx tsx src/scripts/backfill-3dim.ts
 */

import { Pool } from 'pg';
import type { ArticleStructure } from '@summarizer/shared';
import { checkFactuality } from '../services/factualityChecker.js';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

interface SummaryRow {
  id: number;
  profile_id: number;
  article_id: number;
  content: string;
  factuality_score: number | null;
}

interface ArticleRow {
  id: number;
  structured_content: string;
  raw_text: string;
}

async function main() {
  const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

  console.log('=== Backfill FineSurE 3-dim columns ===\n');

  const summaries = await pool.query<SummaryRow>(`
    SELECT s.id, s.profile_id, s.article_id, s.content, s.factuality_score
    FROM summaries s
    WHERE s.factuality_status = 'complete'
      AND s.completeness_score IS NULL
    ORDER BY s.id
  `);

  if (summaries.rows.length === 0) {
    console.log('Nothing to backfill — all complete summaries already have 3-dim scores.');
    await pool.end();
    return;
  }

  console.log(`Found ${summaries.rows.length} summaries missing 3-dim scores.\n`);

  const articleCache = new Map<number, { structure: ArticleStructure; rawText: string }>();
  for (const row of summaries.rows) {
    if (articleCache.has(row.article_id)) continue;
    const a = await pool.query<ArticleRow>(
      'SELECT id, structured_content, raw_text FROM articles WHERE id = $1',
      [row.article_id],
    );
    if (!a.rows[0]) {
      console.error(`Article ${row.article_id} not found.`);
      continue;
    }
    articleCache.set(row.article_id, {
      structure: JSON.parse(a.rows[0].structured_content) as ArticleStructure,
      rawText: a.rows[0].raw_text,
    });
  }

  let completed = 0;
  let skippedNoAbstract = 0;
  let failed = 0;

  for (let i = 0; i < summaries.rows.length; i++) {
    const s = summaries.rows[i];
    const article = articleCache.get(s.article_id);
    if (!article) {
      failed += 1;
      continue;
    }

    process.stdout.write(
      `  [${i + 1}/${summaries.rows.length}] summary=${s.id} article=${s.article_id} profile=${s.profile_id}… `,
    );

    try {
      const { score, results: details, completeness, conciseness, keyfacts, keyfactAlignment } =
        await checkFactuality(s.content, article.structure, article.rawText);

      await pool.query(
        `UPDATE summaries
         SET factuality_score = $1,
             factuality_details = $2,
             completeness_score = $3,
             conciseness_score = $4,
             factuality_keyfacts = $5
         WHERE id = $6`,
        [
          score,
          JSON.stringify(details),
          completeness,
          conciseness,
          keyfactAlignment.length > 0 ? JSON.stringify(keyfactAlignment) : null,
          s.id,
        ],
      );

      if (completeness === null) skippedNoAbstract += 1;
      completed += 1;

      const fmt = (x: number | null) => (x === null ? 'n/a' : x.toFixed(3));
      console.log(
        `faith ${fmt(score)}  comp ${fmt(completeness)}  conc ${fmt(conciseness)}  (n=${details.length}, k=${keyfacts.length})`,
      );
    } catch (err) {
      failed += 1;
      console.log(`ERR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Processed:           ${completed}`);
  console.log(`Without abstract:    ${skippedNoAbstract} (comp/conc stayed null)`);
  console.log(`Failed:              ${failed}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
