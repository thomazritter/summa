/**
 * Recompute the FineSurE 3-dim metrics (faithfulness, completeness,
 * conciseness) on every summary currently stored with
 * factuality_status='complete'. Used to refresh stored scores after
 * changes to the factuality pipeline (e.g. heading exclusion + content
 * reconciliation in 229c1cf).
 *
 * Runs checkFactuality with the current pipeline against each summary's
 * content + raw article text, persists faithfulness + per-sentence
 * details + completeness + conciseness + per-keyfact alignment, and
 * writes a CSV with old vs new scores for downstream analysis.
 *
 * Run with:  DATABASE_URL=... npx tsx src/scripts/recompute-factuality.ts
 */

import { Pool } from 'pg';
import { writeFileSync } from 'fs';
import { join } from 'path';
import type { ArticleStructure } from '@summarizer/shared';
import { checkFactuality } from '../services/factualityChecker.js';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const PROFILE_LABEL: Record<number, string> = {
  98: 'Genérico Traduzido',
  99: 'Genérico',
  100: 'Junior',
  101: 'Pleno',
  102: 'Senior',
};
const labelFor = (pid: number | null): string =>
  pid === null ? 'Personalized' : (PROFILE_LABEL[pid] ?? `profile=${pid}`);

interface SummaryRow {
  id: number;
  profile_id: number | null;
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

  console.log('=== Recompute factuality on experiment summaries ===\n');

  const summaries = await pool.query<SummaryRow>(`
    SELECT s.id, s.profile_id, s.article_id, s.content, s.factuality_score
    FROM summaries s
    WHERE s.factuality_status = 'complete'
      AND s.content IS NOT NULL AND s.content <> ''
    ORDER BY s.id
  `);

  console.log(`Found ${summaries.rows.length} summaries to recompute.\n`);

  // Cache article structure + raw text per article_id to avoid repeated DB hits.
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

  type Result = {
    summary_id: number;
    profile_id: number | null;
    profile_label: string;
    article_id: number;
    old_score: number | null;
    new_score: number | null;
    completeness: number | null;
    conciseness: number | null;
    n_sentences: number;
    n_keyfacts: number;
    n_supported: number;
    n_neutral: number;
    n_contradicted: number;
  };
  const results: Result[] = [];

  for (let i = 0; i < summaries.rows.length; i++) {
    const s = summaries.rows[i];
    const article = articleCache.get(s.article_id);
    if (!article) continue;

    process.stdout.write(
      `  [${i + 1}/${summaries.rows.length}] ${labelFor(s.profile_id).padEnd(14)} summary=${s.id}…`,
    );

    try {
      const { score, results: details, completeness, conciseness, keyfacts, keyfactAlignment } =
        await checkFactuality(s.content, article.structure, article.rawText);

      const n_supported = details.filter((d) => d.label === 'supported').length;
      const n_neutral = details.filter((d) => d.label === 'neutral').length;
      const n_contradicted = details.filter((d) => d.label === 'contradicted').length;

      await pool.query(
        `UPDATE summaries
         SET factuality_score = $1,
             factuality_details = $2,
             completeness_score = $3,
             conciseness_score = $4,
             factuality_keyfacts = $5,
             factuality_status = 'complete'
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

      results.push({
        summary_id: s.id,
        profile_id: s.profile_id,
        profile_label: labelFor(s.profile_id),
        article_id: s.article_id,
        old_score: s.factuality_score,
        new_score: score,
        completeness,
        conciseness,
        n_sentences: details.length,
        n_keyfacts: keyfacts.length,
        n_supported,
        n_neutral,
        n_contradicted,
      });

      const fLabel = score === null ? 'n/a' : score.toFixed(3);
      const cmpLabel = completeness === null ? 'n/a' : completeness.toFixed(3);
      const cncLabel = conciseness === null ? 'n/a' : conciseness.toFixed(3);
      const oldLabel = s.factuality_score === null ? 'n/a' : s.factuality_score.toFixed(3);
      console.log(
        ` faith ${oldLabel} → ${fLabel}  comp ${cmpLabel}  conc ${cncLabel}  (n=${details.length}, k=${keyfacts.length})`,
      );
    } catch (err) {
      console.log(` ERR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\n=== Aggregate by profile (after recompute) ===\n');
  const byProfile = new Map<string, Result[]>();
  for (const r of results) {
    const key = r.profile_label;
    if (!byProfile.has(key)) byProfile.set(key, []);
    byProfile.get(key)!.push(r);
  }

  const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
  const fmt = (x: number | null) => (x === null ? 'n/a' : x.toFixed(3));

  console.log('label              | n  | faith (new) | faith (old) | comp     | conc');
  console.log('-------------------+----+-------------+-------------+----------+--------');
  const labels = Array.from(byProfile.keys()).sort();
  for (const label of labels) {
    const rows = byProfile.get(label)!;
    const meanFaithNew = mean(rows.map((r) => r.new_score).filter((x): x is number => x !== null));
    const meanFaithOld = mean(rows.map((r) => r.old_score).filter((x): x is number => x !== null));
    const meanComp = mean(rows.map((r) => r.completeness).filter((x): x is number => x !== null));
    const meanConc = mean(rows.map((r) => r.conciseness).filter((x): x is number => x !== null));
    console.log(
      `${label.padEnd(19)}| ${String(rows.length).padEnd(3)}| ${fmt(meanFaithNew).padEnd(12)}| ${fmt(meanFaithOld).padEnd(12)}| ${fmt(meanComp).padEnd(9)}| ${fmt(meanConc)}`,
    );
  }
  console.log('-------------------+----+-------------+-------------+----------+--------');
  const allFaithNew = mean(results.map((r) => r.new_score).filter((x): x is number => x !== null));
  const allFaithOld = mean(results.map((r) => r.old_score).filter((x): x is number => x !== null));
  const allComp = mean(results.map((r) => r.completeness).filter((x): x is number => x !== null));
  const allConc = mean(results.map((r) => r.conciseness).filter((x): x is number => x !== null));
  console.log(
    `TOTAL              | ${String(results.length).padEnd(3)}| ${fmt(allFaithNew).padEnd(12)}| ${fmt(allFaithOld).padEnd(12)}| ${fmt(allComp).padEnd(9)}| ${fmt(allConc)}`,
  );

  const csvPath = join(process.cwd(), `data/recompute-factuality-${Date.now()}.csv`);
  const csv = [
    'summary_id,profile_id,profile_label,article_id,old_score,new_score,completeness,conciseness,n_sentences,n_keyfacts,n_supported,n_neutral,n_contradicted',
    ...results.map((r) =>
      [
        r.summary_id,
        r.profile_id,
        r.profile_label,
        r.article_id,
        r.old_score ?? '',
        r.new_score ?? '',
        r.completeness ?? '',
        r.conciseness ?? '',
        r.n_sentences,
        r.n_keyfacts,
        r.n_supported,
        r.n_neutral,
        r.n_contradicted,
      ].join(','),
    ),
  ].join('\n');
  writeFileSync(csvPath, csv);
  console.log(`\nCSV written to ${csvPath}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
