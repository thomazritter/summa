/**
 * Empirical ablation study comparing prompt variants for the personalized
 * summarization pipeline. See ./promptVariants.ts for the rationale of each
 * variant.
 *
 * The benchmark runs every (variant × article × profile) combination,
 * persists the generated summary in-memory only (does NOT touch the DB),
 * and computes factuality + BERTScore + ROUGE-L for each output. Results
 * are written to a timestamped CSV under scripts/results/.
 *
 * Usage:
 *   npx tsx packages/api/src/scripts/benchmark-prompt-variants.ts
 *
 * Env vars:
 *   ARTICLE_IDS    comma-separated, default "1,2"
 *   GROQ_API_KEY   required (read from .env via groqClient)
 *   NLI_SERVICE_URL  default http://127.0.0.1:5050
 *   METRICS_SERVICE_URL  default http://127.0.0.1:5050
 */

import { writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import path from 'path';
import { generateCompletion } from '../services/groqClient.js';
import { checkFactuality } from '../services/factualityChecker.js';
import { computeBertScore, computeRouge } from '../services/metricsService.js';
import type { Profile, ArticleStructure } from '@summarizer/shared';
import { generateForVariant, VARIANT_LABELS, type VariantId } from './promptVariants.js';

const BASE_URL = process.env.BASE_URL || 'https://summa.thomazritter.com.br';
const ADMIN_CODE = process.env.ADMIN_CODE || 'SUMMA-ADMIN';

const VARIANTS: VariantId[] = ['V0', 'V1', 'V2', 'V3', 'V4'];

// Profile presets — chosen to span the dimension space without hitting all
// 4*5*4*4 = 320 combinations. Five presets cover the diversity that matters.
const PROFILE_PRESETS: { name: string; profile: Profile }[] = [
  {
    name: 'junior_concepts_brief_learning',
    profile: { id: 0, name: 'junior', expertise: 'beginner', focus: 'concepts', depth: 'brief', context: 'learning' } as Profile,
  },
  {
    name: 'pleno_methodology_moderate_research',
    profile: { id: 0, name: 'pleno', expertise: 'intermediate', focus: 'methodology', depth: 'moderate', context: 'research' } as Profile,
  },
  {
    name: 'senior_results_detailed_research',
    profile: { id: 0, name: 'senior', expertise: 'advanced', focus: 'results', depth: 'detailed', context: 'research' } as Profile,
  },
  {
    name: 'expert_all_comprehensive_research',
    profile: { id: 0, name: 'expert', expertise: 'expert', focus: 'all', depth: 'comprehensive', context: 'research' } as Profile,
  },
  {
    name: 'pleno_applications_brief_quickreview',
    profile: { id: 0, name: 'pleno_apps', expertise: 'intermediate', focus: 'applications', depth: 'brief', context: 'quick_review' } as Profile,
  },
];

interface ArticleRow {
  id: number;
  title: string;
  rawText: string;
  structuredContent: ArticleStructure;
}

interface BenchRow {
  variant: VariantId;
  article_id: number;
  article_title: string;
  profile_name: string;
  summary_chars: number;
  summary_words: number;
  factuality_score: number;
  pct_supported: number;
  pct_neutral: number;
  pct_contradicted: number;
  rouge_l: number | null;
  bert_score: number | null;
  llm_calls: number;
  duration_ms: number;
  error?: string;
}

const safeJsonParse = <T>(s: string | null): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

async function loadArticles(): Promise<ArticleRow[]> {
  const ids = (process.env.ARTICLE_IDS || '1,2').split(',').map(s => Number(s.trim())).filter(Number.isFinite);
  const rows: ArticleRow[] = [];
  for (const id of ids) {
    const res = await fetch(`${BASE_URL}/api/articles/${id}`, {
      headers: { 'x-access-code': ADMIN_CODE },
    });
    if (!res.ok) {
      console.error(`Failed to fetch article ${id}: HTTP ${res.status}`);
      continue;
    }
    const article = (await res.json()) as ArticleRow;
    rows.push(article);
  }
  return rows;
}

async function runOne(
  variant: VariantId,
  profileEntry: typeof PROFILE_PRESETS[number],
  article: ArticleRow,
  structure: ArticleStructure,
): Promise<BenchRow> {
  const start = Date.now();
  const llmCalls = { count: 0 };
  const wrappedLlm = async (prompt: string, opts: { temperature: number; maxTokens: number }) => {
    llmCalls.count++;
    return generateCompletion({ prompt, temperature: opts.temperature, maxTokens: opts.maxTokens });
  };

  let summary = '';
  try {
    summary = await generateForVariant(variant, profileEntry.profile, structure, article.rawText, wrappedLlm);
  } catch (e) {
    return {
      variant,
      article_id: article.id,
      article_title: article.title.slice(0, 60),
      profile_name: profileEntry.name,
      summary_chars: 0,
      summary_words: 0,
      factuality_score: 0,
      pct_supported: 0,
      pct_neutral: 0,
      pct_contradicted: 0,
      rouge_l: null,
      bert_score: null,
      llm_calls: llmCalls.count,
      duration_ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // Factuality (NLI + LLM-judge runs inside checkFactuality)
  const fact = await checkFactuality(summary, structure, article.rawText).catch(() => ({
    score: 0,
    results: [] as { label: 'supported' | 'neutral' | 'contradicted' }[],
  }));

  const total = fact.results.length || 1;
  const supported = fact.results.filter(r => r.label === 'supported').length;
  const neutral = fact.results.filter(r => r.label === 'neutral').length;
  const contradicted = fact.results.filter(r => r.label === 'contradicted').length;

  const reference = (structure.abstract || '').trim();
  let rouge_l: number | null = null;
  let bert_score: number | null = null;
  if (reference.length > 0) {
    rouge_l = computeRouge(summary, reference).rougeL;
    bert_score = await computeBertScore(summary, reference).catch(() => null);
  }

  return {
    variant,
    article_id: article.id,
    article_title: article.title.slice(0, 60),
    profile_name: profileEntry.name,
    summary_chars: summary.length,
    summary_words: wordCount(summary),
    factuality_score: Number(fact.score.toFixed(4)),
    pct_supported: Number((100 * supported / total).toFixed(1)),
    pct_neutral: Number((100 * neutral / total).toFixed(1)),
    pct_contradicted: Number((100 * contradicted / total).toFixed(1)),
    rouge_l: rouge_l !== null ? Number(rouge_l.toFixed(4)) : null,
    bert_score: bert_score !== null ? Number(bert_score.toFixed(4)) : null,
    llm_calls: llmCalls.count,
    duration_ms: Date.now() - start,
  };
}

async function main() {
  const articles = await loadArticles();
  if (articles.length === 0) {
    console.error('No articles found. Set ARTICLE_IDS env var.');
    process.exit(1);
  }

  console.log(`\n=== Prompt-variant ablation ===`);
  console.log(`Articles: ${articles.map(a => a.id).join(', ')}`);
  console.log(`Profiles: ${PROFILE_PRESETS.length}`);
  console.log(`Variants: ${VARIANTS.join(', ')}`);
  console.log(`Total runs: ${articles.length * PROFILE_PRESETS.length * VARIANTS.length}\n`);

  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const resultsDir = path.resolve(scriptDir, '../../../../scripts/results');
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(resultsDir, `benchmark-prompts-${ts}.csv`);

  const csvHeader = 'variant,article_id,article_title,profile,summary_chars,summary_words,factuality_score,pct_supported,pct_neutral,pct_contradicted,rouge_l,bert_score,llm_calls,duration_ms,error';
  writeFileSync(csvPath, csvHeader + '\n');

  const all: BenchRow[] = [];
  let idx = 0;
  const total = articles.length * PROFILE_PRESETS.length * VARIANTS.length;

  for (const article of articles) {
    const structure = article.structuredContent || ({ sections: [] } as ArticleStructure);
    for (const profileEntry of PROFILE_PRESETS) {
      for (const variant of VARIANTS) {
        idx++;
        process.stdout.write(`[${idx}/${total}] ${variant} × art=${article.id} × ${profileEntry.name}…`);
        const row = await runOne(variant, profileEntry, article, structure);
        all.push(row);

        const csv = [
          row.variant, row.article_id, JSON.stringify(row.article_title), row.profile_name,
          row.summary_chars, row.summary_words, row.factuality_score,
          row.pct_supported, row.pct_neutral, row.pct_contradicted,
          row.rouge_l ?? '', row.bert_score ?? '', row.llm_calls, row.duration_ms,
          row.error ? JSON.stringify(row.error) : '',
        ].join(',');
        appendFileSync(csvPath, csv + '\n');

        if (row.error) {
          console.log(` ERR: ${row.error.slice(0, 60)}`);
        } else {
          console.log(` factuality=${row.factuality_score} bert=${row.bert_score ?? '?'} chars=${row.summary_chars} (${row.duration_ms}ms)`);
        }
      }
    }
  }

  // ─── Aggregate per variant ──────────────────────────────────────────
  console.log(`\n=== Aggregate per variant (mean across ${PROFILE_PRESETS.length * articles.length} runs) ===`);
  for (const v of VARIANTS) {
    const rows = all.filter(r => r.variant === v && !r.error);
    if (rows.length === 0) {
      console.log(`  ${v}: no successful runs`);
      continue;
    }
    const fact = mean(rows.map(r => r.factuality_score));
    const supported = mean(rows.map(r => r.pct_supported));
    const bert = mean(rows.filter(r => r.bert_score !== null).map(r => r.bert_score as number));
    const rouge = mean(rows.filter(r => r.rouge_l !== null).map(r => r.rouge_l as number));
    const chars = mean(rows.map(r => r.summary_chars));
    const words = mean(rows.map(r => r.summary_words));
    const dur = mean(rows.map(r => r.duration_ms));
    console.log(`  ${v} (${VARIANT_LABELS[v]}):`);
    console.log(`     factuality=${fact.toFixed(3)}  supported%=${supported.toFixed(1)}  bert=${bert.toFixed(3)}  rouge_l=${rouge.toFixed(3)}`);
    console.log(`     length: ${chars.toFixed(0)} chars / ${words.toFixed(0)} words   avg duration: ${(dur / 1000).toFixed(1)}s`);
  }

  // ─── P-Accuracy (pairwise ROUGE-L between profiles) per variant per article ──────
  console.log(`\n=== P-Accuracy per variant (1 - avg pairwise ROUGE-L between profiles, same article) ===`);
  for (const v of VARIANTS) {
    const perArticle: number[] = [];
    for (const article of articles) {
      const sums = all.filter(r => r.variant === v && r.article_id === article.id && !r.error);
      if (sums.length < 2) continue;
      // Recompute pairwise ROUGE-L between summaries — but we don't have content stored. Skip.
      // For simplicity, derive from how similar the per-profile rouge_l vs abstract values are: not the same metric.
      // We'd need to keep summary content for proper pairwise. For this benchmark, this aggregate is omitted.
    }
    if (perArticle.length > 0) {
      console.log(`  ${v}: P-Accuracy (mean across articles) = ${mean(perArticle).toFixed(3)}`);
    } else {
      console.log(`  ${v}: P-Accuracy not computed (would require keeping summary content in memory; see CSV summary_chars for proxy)`);
    }
  }

  console.log(`\nCSV: ${csvPath}\n`);
}

main().catch(e => {
  console.error('Benchmark failed:', e);
  process.exit(1);
});
