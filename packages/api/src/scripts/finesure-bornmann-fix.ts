/**
 * One-off fix for the Bornmann 2021 article (id=29 in the prod DB after the
 * T12 grid run): the structuring LLM did not detect the abstract because the
 * paper presents it under no "Abstract" label (Nature Communications style),
 * so FineSurE completeness/conciseness came back null on all 4 grid summaries.
 *
 * This script:
 *   1. Patches articles.structured_content.abstract on article 29 with the
 *      abstract text extracted between the author byline and the DOI line.
 *   2. Re-runs checkFactuality on the 4 grid summaries (107, 108, 109, 110)
 *      and updates each summary row with the fresh faithfulness + details.
 *   3. Prints the new completeness/conciseness so they can be folded into
 *      the §6.3 consolidated table.
 *
 * Tied to the T12.3 grid run on 2026-05-15. Discard once Bornmann is no
 * longer in any active dataset.
 */

import { Pool } from 'pg';
import type { ArticleStructure } from '@summarizer/shared';
import { checkFactuality } from '../services/factualityChecker.js';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

const ARTICLE_ID = 29;
const SUMMARY_IDS = [107, 108, 109, 110];
const PROFILE_LABEL: Record<number, string> = {
  104: 'Estudante grad',
  105: 'Mestrando',
  106: 'Pesquisador',
  107: 'Revisor par',
};

async function main() {
  const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

  console.log('=== Step 1: patch abstract on article 29 ===\n');
  const art = await pool.query<{ raw_text: string; structured_content: string }>(
    'SELECT raw_text, structured_content FROM articles WHERE id = $1',
    [ARTICLE_ID],
  );
  if (!art.rows[0]) throw new Error('Article 29 not found');
  const raw = art.rows[0].raw_text;
  const start = raw.indexOf('Growth of science is a prevalent');
  const end = raw.indexOf('https://doi.org/');
  if (start < 0 || end < 0) throw new Error('Abstract markers not found');
  const abstract = raw.slice(start, end).trim().replace(/\s+/g, ' ');
  console.log(`Extracted abstract: ${abstract.length} chars`);

  const structure = JSON.parse(art.rows[0].structured_content) as ArticleStructure;
  (structure as ArticleStructure & { abstract: string }).abstract = abstract;
  await pool.query(
    'UPDATE articles SET structured_content = $1 WHERE id = $2',
    [JSON.stringify(structure), ARTICLE_ID],
  );
  console.log('articles.structured_content updated.\n');

  console.log('=== Step 2: re-run FineSurE on the 4 Bornmann summaries ===\n');
  const sums = await pool.query<{ id: number; profile_id: number; content: string }>(
    'SELECT id, profile_id, content FROM summaries WHERE id = ANY($1) ORDER BY profile_id',
    [SUMMARY_IDS],
  );

  type Row = {
    summary_id: number; profile_id: number; profile_label: string;
    faithfulness: number | null; completeness: number | null; conciseness: number | null;
    n_sentences: number; n_keyfacts: number;
    n_supported: number; n_neutral: number; n_contradicted: number;
  };
  const rows: Row[] = [];

  for (const s of sums.rows) {
    process.stdout.write(`  ${(PROFILE_LABEL[s.profile_id] ?? String(s.profile_id)).padEnd(15)} (id=${s.id})... `);
    const { score, results: details, completeness, conciseness, keyfacts, keyfactAlignment } =
      await checkFactuality(s.content, structure, raw);

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

    const fmt = (x: number | null) => (x === null ? 'n/a' : x.toFixed(3));
    rows.push({
      summary_id: s.id,
      profile_id: s.profile_id,
      profile_label: PROFILE_LABEL[s.profile_id] ?? String(s.profile_id),
      faithfulness: score,
      completeness,
      conciseness,
      n_sentences: details.length,
      n_keyfacts: keyfacts.length,
      n_supported: details.filter((d) => d.label === 'supported').length,
      n_neutral: details.filter((d) => d.label === 'neutral').length,
      n_contradicted: details.filter((d) => d.label === 'contradicted').length,
    });
    console.log(`faith ${fmt(score)}  comp ${fmt(completeness)}  conc ${fmt(conciseness)}  (n=${details.length}, k=${keyfacts.length})`);
  }

  console.log('\n=== Step 3: results ===\n');
  console.table(rows);

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
