/**
 * Generates the 4×4 grid of fresh summaries (4 reader profiles × 4 articles)
 * used to populate the §6.3 results table of the thesis, then waits for the
 * background FineSurE 3-dim job to finish on each of the 16 rows and writes
 * a consolidated CSV alongside the N=9 recompute output.
 *
 * Profiles intentionally span the full range of each dimension so the FineSurE
 * completeness metric has room to discriminate (Estudante grad vs Revisor par
 * should differ on cobertura de keyfacts even though faithfulness saturates).
 *
 * Run with:  railway run -- npx tsx src/scripts/finesure-generate-grid.ts
 *
 * Idempotency: the script INSERTs new profiles and articles every run, so
 * re-running creates duplicates. Use once per data-collection round.
 */

import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { writeFileSync } from 'fs';
import type { ArticleStructure } from '@summarizer/shared';
import { processPDF } from '../services/pdfProcessor.js';
import { generatePersonalizedSummary } from '../services/summarizationService.js';
import { checkFactuality } from '../services/factualityChecker.js';
import type { ProfileDimensions } from '../services/summarizationService.js';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const PAPERS_DIR = '/Users/thomazjusto/Documents/TCC/papers_pdf';

const ARTICLES = [
  { file: 'vaswani2017attention.pdf', label: 'Vaswani Transformer' },
  { file: 'song2024finesure.pdf', label: 'Song FineSurE' },
  { file: 'bornmann2021growth.pdf', label: 'Bornmann Growth' },
  { file: 'khurana2025personalized.pdf', label: 'Khurana Personalized Medicine' },
];

const PROFILES: Array<{ name: string; label: string; dimensions: ProfileDimensions }> = [
  {
    name: 'T12 Estudante grad',
    label: 'Estudante grad',
    dimensions: { expertise: 'beginner', focus: 'concepts', depth: 'brief', context: 'learning' },
  },
  {
    name: 'T12 Mestrando',
    label: 'Mestrando',
    dimensions: { expertise: 'intermediate', focus: 'methodology', depth: 'moderate', context: 'research' },
  },
  {
    name: 'T12 Pesquisador',
    label: 'Pesquisador',
    dimensions: { expertise: 'advanced', focus: 'results', depth: 'detailed', context: 'research' },
  },
  {
    name: 'T12 Revisor par',
    label: 'Revisor par',
    dimensions: { expertise: 'expert', focus: 'all', depth: 'comprehensive', context: 'research' },
  },
];

async function main() {
  const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

  // ─── Phase 1: insert the 4 profiles ──────────────────────────────
  // user_id=1 ("Test User") is the only user in the schema and owns all the
  // existing legacy profiles (1, 98–102). Reusing it keeps the new T12
  // profiles within the same ownership domain.
  const OWNER_USER_ID = 1;
  console.log('=== Phase 1: insert 4 reader profiles ===\n');
  const profileRows: Array<{ id: number; label: string; dimensions: ProfileDimensions }> = [];
  for (const p of PROFILES) {
    const r = await pool.query<{ id: number }>(
      `INSERT INTO profiles (name, expertise, focus, depth, context, user_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [p.name, p.dimensions.expertise, p.dimensions.focus, p.dimensions.depth, p.dimensions.context, OWNER_USER_ID],
    );
    profileRows.push({ id: r.rows[0].id, label: p.label, dimensions: p.dimensions });
    console.log(`  profile_id=${r.rows[0].id} — ${p.label} (${p.dimensions.expertise}/${p.dimensions.focus}/${p.dimensions.depth}/${p.dimensions.context})`);
  }
  console.log();

  // ─── Phase 2: ingest 4 articles ──────────────────────────────────
  console.log('=== Phase 2: ingest 4 articles ===\n');
  const articleRows: Array<{ id: number; label: string; structure: ArticleStructure; rawText: string }> = [];
  for (const art of ARTICLES) {
    const filePath = join(PAPERS_DIR, art.file);
    process.stdout.write(`  ${art.file}... `);
    const buffer = readFileSync(filePath);
    const result = await processPDF(buffer);
    const r = await pool.query<{ id: number }>(
      `INSERT INTO articles (title, authors, year, raw_text, structured_content, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, NULL) RETURNING id`,
      [
        result.metadata.title || art.label,
        result.metadata.authors || null,
        null,
        result.rawText,
        JSON.stringify(result.structuredContent),
      ],
    );
    articleRows.push({
      id: r.rows[0].id,
      label: art.label,
      structure: result.structuredContent,
      rawText: result.rawText,
    });
    console.log(`article_id=${r.rows[0].id}, ${result.rawText.length} chars, title="${(result.metadata.title || '').slice(0, 60)}"`);
  }
  console.log();

  // ─── Phase 3: generate + FineSurE 3-dim sync ─────────────────────
  console.log('=== Phase 3: generate 16 summaries + FineSurE 3-dim sync ===\n');
  type Row = {
    summary_id: number; article_id: number; article_label: string;
    profile_id: number; profile_label: string;
    faithfulness: number | null; completeness: number | null; conciseness: number | null;
    n_sentences: number; n_keyfacts: number;
    n_supported: number; n_neutral: number; n_contradicted: number;
    content_len: number;
  };
  const rows: Row[] = [];

  for (const article of articleRows) {
    for (const profile of profileRows) {
      process.stdout.write(`  ${profile.label.padEnd(15)} × ${article.label.padEnd(34)}... `);
      try {
        // generatePersonalizedSummary also kicks off background factuality —
        // we run checkFactuality synchronously below to capture all three
        // FineSurE dimensions for the CSV (only faithfulness gets persisted).
        const summary = await generatePersonalizedSummary(article.id, profile.id, profile.dimensions);
        const { score, results: details, completeness, conciseness, keyfacts } =
          await checkFactuality(summary.content, article.structure, article.rawText);

        rows.push({
          summary_id: summary.id,
          article_id: article.id,
          article_label: article.label,
          profile_id: profile.id,
          profile_label: profile.label,
          faithfulness: score,
          completeness,
          conciseness,
          n_sentences: details.length,
          n_keyfacts: keyfacts.length,
          n_supported: details.filter((d) => d.label === 'supported').length,
          n_neutral: details.filter((d) => d.label === 'neutral').length,
          n_contradicted: details.filter((d) => d.label === 'contradicted').length,
          content_len: summary.content.length,
        });

        const fmt = (x: number | null) => (x === null ? 'n/a' : x.toFixed(3));
        console.log(`id=${summary.id}  faith ${fmt(score)}  comp ${fmt(completeness)}  conc ${fmt(conciseness)}  (n=${details.length}, k=${keyfacts.length})`);
      } catch (err) {
        console.log(`ERR: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  console.log();

  // ─── Phase 4: aggregate + CSV ─────────────────────────────────────
  console.log('=== Phase 4: aggregate by profile ===\n');
  const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
  const fmt = (x: number | null) => (x === null ? 'n/a' : x.toFixed(3));

  console.log('profile_id | label          | n | faith    | comp     | conc');
  console.log('-----------+----------------+---+----------+----------+--------');
  const byProfile = new Map<number, Row[]>();
  for (const r of rows) {
    if (!byProfile.has(r.profile_id)) byProfile.set(r.profile_id, []);
    byProfile.get(r.profile_id)!.push(r);
  }
  for (const [pid, group] of Array.from(byProfile.entries()).sort((a, b) => a[0] - b[0])) {
    const meanFaith = mean(group.map((r) => r.faithfulness).filter((x): x is number => x !== null));
    const meanComp = mean(group.map((r) => r.completeness).filter((x): x is number => x !== null));
    const meanConc = mean(group.map((r) => r.conciseness).filter((x): x is number => x !== null));
    console.log(
      `${String(pid).padEnd(11)}| ${group[0].profile_label.padEnd(15)}| ${String(group.length).padEnd(2)}| ${fmt(meanFaith).padEnd(9)}| ${fmt(meanComp).padEnd(9)}| ${fmt(meanConc)}`,
    );
  }
  console.log('-----------+----------------+---+----------+----------+--------');
  const allFaith = mean(rows.map((r) => r.faithfulness).filter((x): x is number => x !== null));
  const allComp = mean(rows.map((r) => r.completeness).filter((x): x is number => x !== null));
  const allConc = mean(rows.map((r) => r.conciseness).filter((x): x is number => x !== null));
  console.log(
    `TOTAL      |                | ${String(rows.length).padEnd(2)}| ${fmt(allFaith).padEnd(9)}| ${fmt(allComp).padEnd(9)}| ${fmt(allConc)}`,
  );
  console.log();

  const csvPath = join(process.cwd(), `data/finesure-grid-${Date.now()}.csv`);
  const csv = [
    'summary_id,article_id,article_label,profile_id,profile_label,faithfulness,completeness,conciseness,n_sentences,n_keyfacts,n_supported,n_neutral,n_contradicted,content_len',
    ...rows.map((r) => [
      r.summary_id,
      r.article_id,
      `"${r.article_label}"`,
      r.profile_id,
      `"${r.profile_label}"`,
      r.faithfulness ?? '',
      r.completeness ?? '',
      r.conciseness ?? '',
      r.n_sentences,
      r.n_keyfacts,
      r.n_supported,
      r.n_neutral,
      r.n_contradicted,
      r.content_len,
    ].join(',')),
  ].join('\n');
  writeFileSync(csvPath, csv);
  console.log(`CSV written to ${csvPath}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
