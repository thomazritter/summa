/**
 * Recompute factuality scores on the summaries that were exercised by real
 * participants during the experiment described in §6.4 of the thesis.
 *
 * Why: the NLI verdict aggregation in `factualityChecker.ts` had two bugs
 *   (C3 / C4 from the business-logic review) that silently routed
 *   contradictions into the "neutral 0.0" placeholder; the meta-sentence
 *   filter (C5) was too aggressive; and the empty-results case (M1)
 *   returned 1.0 instead of null. All three are fixed in the local code.
 *
 * What it does: for each summary referenced by an experiment_session (as
 * either the generic or the personalized variant), runs checkFactuality
 * with the fixed implementation, persists the new score + details (also
 * updates factuality_status to 'complete'), and prints an aggregate
 * comparison table by profile_id.
 *
 * Run with:  npx tsx src/scripts/recompute-factuality.ts
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

  console.log('=== Recompute factuality on experiment summaries ===\n');

  const summaries = await pool.query<SummaryRow>(`
    SELECT s.id, s.profile_id, s.article_id, s.content, s.factuality_score
    FROM summaries s
    WHERE s.id IN (
      SELECT generic_summary_id FROM experiment_sessions
      UNION SELECT personalized_summary_id FROM experiment_sessions
    )
    ORDER BY s.profile_id, s.id
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
    profile_id: number;
    profile_label: string;
    article_id: number;
    old_score: number | null;
    new_score: number | null;
    n_sentences: number;
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
      `  [${i + 1}/${summaries.rows.length}] profile=${s.profile_id} (${PROFILE_LABEL[s.profile_id]}) summary=${s.id}…`,
    );

    try {
      const { score, results: details } = await checkFactuality(s.content, article.structure, article.rawText);

      const n_supported = details.filter((d) => d.label === 'supported').length;
      const n_neutral = details.filter((d) => d.label === 'neutral').length;
      const n_contradicted = details.filter((d) => d.label === 'contradicted').length;

      await pool.query(
        `UPDATE summaries
         SET factuality_score = $1, factuality_details = $2
         WHERE id = $3`,
        [score, JSON.stringify(details), s.id],
      );

      results.push({
        summary_id: s.id,
        profile_id: s.profile_id,
        profile_label: PROFILE_LABEL[s.profile_id] ?? String(s.profile_id),
        article_id: s.article_id,
        old_score: s.factuality_score,
        new_score: score,
        n_sentences: details.length,
        n_supported,
        n_neutral,
        n_contradicted,
      });

      const newLabel = score === null ? 'n/a' : score.toFixed(3);
      const oldLabel = s.factuality_score === null ? 'n/a' : s.factuality_score.toFixed(3);
      console.log(` ${oldLabel} → ${newLabel} (n=${details.length})`);
    } catch (err) {
      console.log(` ERR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\n=== Aggregate by profile (after recompute) ===\n');
  const byProfile = new Map<number, Result[]>();
  for (const r of results) {
    if (!byProfile.has(r.profile_id)) byProfile.set(r.profile_id, []);
    byProfile.get(r.profile_id)!.push(r);
  }

  console.log('profile_id | label              | n_summaries | total_sent | %supp | %neu | %contr | mean_score (new) | mean_score (old)');
  console.log('-----------+--------------------+-------------+------------+-------+------+--------+------------------+-----------------');
  const profileIds = Array.from(byProfile.keys()).sort();
  let totalSent = 0;
  let totalSupp = 0;
  let totalNeu = 0;
  let totalCon = 0;
  for (const pid of profileIds) {
    const rows = byProfile.get(pid)!;
    const sent = rows.reduce((s, r) => s + r.n_sentences, 0);
    const supp = rows.reduce((s, r) => s + r.n_supported, 0);
    const neu = rows.reduce((s, r) => s + r.n_neutral, 0);
    const con = rows.reduce((s, r) => s + r.n_contradicted, 0);
    const validNew = rows.filter((r) => r.new_score !== null);
    const validOld = rows.filter((r) => r.old_score !== null);
    const meanNew = validNew.length > 0 ? validNew.reduce((s, r) => s + (r.new_score as number), 0) / validNew.length : null;
    const meanOld = validOld.length > 0 ? validOld.reduce((s, r) => s + (r.old_score as number), 0) / validOld.length : null;
    totalSent += sent;
    totalSupp += supp;
    totalNeu += neu;
    totalCon += con;
    console.log(
      `${String(pid).padEnd(11)}| ${rows[0].profile_label.padEnd(19)}| ${String(rows.length).padEnd(12)}| ${String(sent).padEnd(11)}| ${((100 * supp) / sent).toFixed(1).padEnd(6)}| ${((100 * neu) / sent).toFixed(1).padEnd(5)}| ${((100 * con) / sent).toFixed(1).padEnd(7)}| ${(meanNew === null ? 'n/a' : meanNew.toFixed(3)).padEnd(17)}| ${meanOld === null ? 'n/a' : meanOld.toFixed(3)}`,
    );
  }
  console.log('-----------+--------------------+-------------+------------+-------+------+--------+------------------+-----------------');
  console.log(
    `TOTAL      |                    | ${String(results.length).padEnd(12)}| ${String(totalSent).padEnd(11)}| ${((100 * totalSupp) / totalSent).toFixed(1).padEnd(6)}| ${((100 * totalNeu) / totalSent).toFixed(1).padEnd(5)}| ${((100 * totalCon) / totalSent).toFixed(1).padEnd(7)}|`,
  );

  const csvPath = join(process.cwd(), `data/recompute-factuality-${Date.now()}.csv`);
  const csv = [
    'summary_id,profile_id,profile_label,article_id,old_score,new_score,n_sentences,n_supported,n_neutral,n_contradicted',
    ...results.map((r) =>
      [
        r.summary_id,
        r.profile_id,
        r.profile_label,
        r.article_id,
        r.old_score ?? '',
        r.new_score ?? '',
        r.n_sentences,
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
