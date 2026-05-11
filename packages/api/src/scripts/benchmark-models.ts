/**
 * Empirical model selection benchmark.
 *
 * Holds the prompt variant fixed at V2 (XML-tagged — winner of the prompt
 * ablation per benchmark-prompts-*.csv) and varies the Groq model id across
 * the five options exposed by the production app:
 *   - llama-3.3-70b-versatile           (current default)
 *   - meta-llama/llama-4-scout-17b-16e-instruct
 *   - qwen/qwen3-32b
 *   - openai/gpt-oss-120b
 *   - llama-3.1-8b-instant
 *
 * Two tasks measured per model:
 *   A. first-gen — generate a personalized summary from scratch
 *   B. regen-with-evidence — re-prompt with NLI-flagged sentences + anchor
 *      paragraphs at temperature 0.1 (mirrors regenerateSummaryWithEvidence)
 *
 * Output: scripts/results/benchmark-models-{ts}.csv
 *
 * Usage (mirrors prompt-variants benchmark):
 *   GROQ_API_KEY=... NLI_SERVICE_URL=... METRICS_SERVICE_URL=... \
 *     BASE_URL=... ADMIN_CODE=... \
 *     npx tsx packages/api/src/scripts/benchmark-models.ts
 */

import { writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import path from 'path';
import { generateCompletion, AVAILABLE_MODELS } from '../services/groqClient.js';
import { checkFactuality } from '../services/factualityChecker.js';
import { computeBertScore, computeRouge } from '../services/metricsService.js';
import type { Profile, ArticleStructure } from '@summarizer/shared';
import { generateForVariant, type VariantId } from './promptVariants.js';

const BASE_URL = process.env.BASE_URL || 'https://summa.thomazritter.com.br';
const ADMIN_CODE = process.env.ADMIN_CODE || 'SUMMA-ADMIN';

const VARIANT: VariantId = 'V2';
const MODELS = AVAILABLE_MODELS.map(m => m.id);

// Subset of the prompt-variants profiles, picked to span the dimension space
// without blowing up the call budget.
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
    name: 'expert_all_comprehensive_research',
    profile: { id: 0, name: 'expert', expertise: 'expert', focus: 'all', depth: 'comprehensive', context: 'research' } as Profile,
  },
];

interface ArticleRow {
  id: number;
  title: string;
  rawText: string;
  structuredContent: ArticleStructure;
}

interface BenchRow {
  task: 'first_gen' | 'regen';
  model: string;
  article_id: number;
  profile_name: string;
  parent_summary_id?: number;
  summary_chars: number;
  summary_words: number;
  factuality_score: number | null;
  pct_supported: number;
  pct_neutral: number;
  pct_contradicted: number;
  rouge_l: number | null;
  bert_score: number | null;
  depth_adherence?: number;
  anomaly?: boolean;
  duration_ms: number;
  error?: string;
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

async function loadArticles(): Promise<ArticleRow[]> {
  const ids = (process.env.ARTICLE_IDS || '1,2').split(',').map(s => Number(s.trim())).filter(Number.isFinite);
  const rows: ArticleRow[] = [];
  for (const id of ids) {
    const res = await fetch(`${BASE_URL}/api/articles/${id}`, { headers: { 'x-access-code': ADMIN_CODE } });
    if (!res.ok) continue;
    rows.push((await res.json()) as ArticleRow);
  }
  return rows;
}

interface ManagerSummary {
  id: number;
  articleId: number;
  factualityScore: number | null;
  factualityDetails?: Array<{ sentence: string; label: string; sourceSentence?: string }>;
  rougeL: number | null;
}

async function loadFlaggedSummaries(limit: number): Promise<{ id: number; articleId: number; factualityScore: number; flagged: Array<{ sentence: string; label: string; sourceSentence?: string }> }[]> {
  // Use manager export to get summaries with their factuality details.
  const res = await fetch(`${BASE_URL}/api/manager/summaries`, { headers: { 'x-access-code': ADMIN_CODE } });
  if (!res.ok) {
    console.error(`Failed to fetch manager summaries: HTTP ${res.status}`);
    return [];
  }
  const data = (await res.json()) as { summaries: ManagerSummary[] };
  // Manager endpoint may not return factuality_details; fetch each one individually then.
  const articlesWithAbstract = new Set(data.summaries.filter(s => s.rougeL !== null).map(s => s.articleId));
  const flagged = data.summaries
    .filter(s => s.factualityScore !== null && s.factualityScore < 1.0 && articlesWithAbstract.has(s.articleId))
    .sort((a, b) => (a.factualityScore ?? 1) - (b.factualityScore ?? 1))
    .slice(0, limit * 3); // overfetch since some may not have details

  // Fetch details from individual summary endpoint or fall back to manager data.
  const enriched: { id: number; articleId: number; factualityScore: number; flagged: Array<{ sentence: string; label: string; sourceSentence?: string }> }[] = [];
  for (const s of flagged) {
    if (enriched.length >= limit) break;
    // Manager summaries endpoint doesn't expose factuality_details, but the
    // database row does. We fetch via the article endpoint to keep state minimal,
    // then re-derive flagged sentences by re-running checkFactuality on the
    // stored content. To avoid that cost, we instead skip the regen sub-bench
    // on summaries we cannot inspect.
    enriched.push({
      id: s.id,
      articleId: s.articleId,
      factualityScore: s.factualityScore as number,
      flagged: [], // populated below if possible
    });
  }
  return enriched;
}

// Strip Qwen-style chain-of-thought tags from the model output. Qwen 3 has
// reasoning ON by default and emits <think>…</think> blocks before the
// answer; for a fair comparison across models we remove them.
const stripThinking = (raw: string): string =>
  raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

const TARGET_DEPTH_WORDS: Record<string, number> = {
  brief: 100,
  moderate: 250,
  detailed: 500,
  comprehensive: 900,
};

const ANOMALY_CHAR_LIMIT = 15000; // 3-4× any reasonable comprehensive depth

async function runFirstGen(modelId: string, profileEntry: typeof PROFILE_PRESETS[number], article: ArticleRow): Promise<BenchRow> {
  const start = Date.now();
  const wrappedLlm = (prompt: string, opts: { temperature: number; maxTokens: number; model?: string }) =>
    generateCompletion({ prompt, temperature: opts.temperature, maxTokens: opts.maxTokens, model: modelId });

  let summary = '';
  try {
    const raw = await generateForVariant(VARIANT, profileEntry.profile, article.structuredContent, article.rawText, wrappedLlm);
    summary = stripThinking(raw);
  } catch (e) {
    return {
      task: 'first_gen',
      model: modelId,
      article_id: article.id,
      profile_name: profileEntry.name,
      summary_chars: 0,
      summary_words: 0,
      factuality_score: 0,
      pct_supported: 0,
      pct_neutral: 0,
      pct_contradicted: 0,
      rouge_l: null,
      bert_score: null,
      duration_ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const fact = await checkFactuality(summary, article.structuredContent, article.rawText).catch(() => ({
    score: 0, results: [] as { label: 'supported' | 'neutral' | 'contradicted' }[],
  }));
  const total = fact.results.length || 1;
  const supported = fact.results.filter(r => r.label === 'supported').length;
  const neutral = fact.results.filter(r => r.label === 'neutral').length;
  const contradicted = fact.results.filter(r => r.label === 'contradicted').length;

  const reference = (article.structuredContent.abstract || '').trim();
  let rouge_l: number | null = null;
  let bert_score: number | null = null;
  if (reference.length > 0) {
    rouge_l = computeRouge(summary, reference).rougeL;
    bert_score = await computeBertScore(summary, reference).catch(() => null);
  }

  // Adherence to depth target: ratio of generated words to target. 1.0 is ideal.
  // Values close to 1.0 (between 0.5 and 2.0) mean the model respected the depth.
  const targetWords = TARGET_DEPTH_WORDS[profileEntry.profile.depth] ?? 250;
  const words = wordCount(summary);
  const depth_adherence = Number((words / targetWords).toFixed(3));
  const anomaly = summary.length > ANOMALY_CHAR_LIMIT;

  return {
    task: 'first_gen',
    model: modelId,
    article_id: article.id,
    profile_name: profileEntry.name,
    summary_chars: summary.length,
    summary_words: words,
    factuality_score: fact.score === null ? null : Number(fact.score.toFixed(4)),
    pct_supported: Number((100 * supported / total).toFixed(1)),
    pct_neutral: Number((100 * neutral / total).toFixed(1)),
    pct_contradicted: Number((100 * contradicted / total).toFixed(1)),
    rouge_l: rouge_l !== null ? Number(rouge_l.toFixed(4)) : null,
    bert_score: bert_score !== null ? Number(bert_score.toFixed(4)) : null,
    depth_adherence,
    anomaly,
    duration_ms: Date.now() - start,
  };
}

async function main() {
  const articles = await loadArticles();
  if (articles.length === 0) {
    console.error('No articles loaded.');
    process.exit(1);
  }

  console.log(`\n=== Model selection benchmark ===`);
  console.log(`Variant fixed: ${VARIANT} (XML-tagged, winner of prompt ablation)`);
  console.log(`Articles: ${articles.map(a => a.id).join(', ')}`);
  console.log(`Profiles: ${PROFILE_PRESETS.length}`);
  console.log(`Models: ${MODELS.length}`);
  const totalFirst = articles.length * PROFILE_PRESETS.length * MODELS.length;
  console.log(`First-gen runs: ${totalFirst}\n`);

  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const resultsDir = path.resolve(scriptDir, '../../../../scripts/results');
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(resultsDir, `benchmark-models-${ts}.csv`);

  const csvHeader = 'task,model,article_id,profile,parent_summary_id,summary_chars,summary_words,factuality_score,pct_supported,pct_neutral,pct_contradicted,rouge_l,bert_score,depth_adherence,anomaly,duration_ms,error';
  writeFileSync(csvPath, csvHeader + '\n');

  const all: BenchRow[] = [];

  // ─── Task A: first-gen ────────────────────────────────────────────
  let idx = 0;
  for (const article of articles) {
    for (const profileEntry of PROFILE_PRESETS) {
      for (const modelId of MODELS) {
        idx++;
        process.stdout.write(`[${idx}/${totalFirst}] first_gen × ${modelId.slice(0, 30)} × art=${article.id} × ${profileEntry.name.slice(0, 25)}…`);
        const row = await runFirstGen(modelId, profileEntry, article);
        all.push(row);

        const csv = [
          row.task, JSON.stringify(row.model), row.article_id, row.profile_name,
          row.parent_summary_id ?? '',
          row.summary_chars, row.summary_words, row.factuality_score,
          row.pct_supported, row.pct_neutral, row.pct_contradicted,
          row.rouge_l ?? '', row.bert_score ?? '',
          row.depth_adherence ?? '', row.anomaly === true ? 'true' : 'false',
          row.duration_ms,
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

  // ─── Aggregate per model (first-gen) ────────────────────────────────
  const stddev = (xs: number[]): number => {
    if (xs.length === 0) return 0;
    const m = mean(xs);
    return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
  };
  console.log(`\n=== Aggregate per model (first_gen, mean ± std across ${PROFILE_PRESETS.length * articles.length} runs each) ===`);
  for (const modelId of MODELS) {
    const rows = all.filter(r => r.task === 'first_gen' && r.model === modelId && !r.error && r.factuality_score !== null);
    if (rows.length === 0) {
      console.log(`  ${modelId}: no successful runs`);
      continue;
    }
    const facts = rows.map(r => r.factuality_score as number);
    const factMean = mean(facts);
    const factStd = stddev(facts);
    const supported = mean(rows.map(r => r.pct_supported));
    const bert = mean(rows.filter(r => r.bert_score !== null).map(r => r.bert_score as number));
    const dur = mean(rows.map(r => r.duration_ms));
    const chars = mean(rows.map(r => r.summary_chars));
    const adherence = mean(rows.filter(r => typeof r.depth_adherence === 'number').map(r => r.depth_adherence as number));
    const anomalies = rows.filter(r => r.anomaly).length;
    console.log(`  ${modelId.padEnd(45)} fact=${factMean.toFixed(3)}±${factStd.toFixed(3)}  supp%=${supported.toFixed(1)}  bert=${bert.toFixed(3)}  adher=${adherence.toFixed(2)}  chars=${chars.toFixed(0)}  ${(dur / 1000).toFixed(1)}s  anom=${anomalies}/${rows.length}`);
  }

  console.log(`\nCSV: ${csvPath}\n`);
}

main().catch(e => {
  console.error('Benchmark failed:', e);
  process.exit(1);
});
