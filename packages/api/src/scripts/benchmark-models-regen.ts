/**
 * Model selection benchmark for the regenerate-with-evidence path.
 *
 * Purpose: identify the best LLM for re-prompting summaries with NLI-flagged
 * sentences and anchor paragraphs at temperature 0.1. This is a different
 * task than first-gen — the goal here is *factuality improvement* over the
 * parent summary, so the scoring weighs absolute factuality and improvement
 * delta heavily, latency moderately, and structural metrics lightly.
 *
 * Flow per (parent summary, model):
 *   1. Fetch parent.content + article (raw + structured)
 *   2. Run checkFactuality on parent → get flagged sentences + anchors
 *   3. Build the same 4-block regen prompt that production uses
 *   4. Call Groq with target model + temperature 0.1
 *   5. Strip <think>...</think> from the output
 *   6. Re-run checkFactuality on the regenerated output
 *   7. Record metrics: new factuality, delta vs parent, BERTScore, latency
 *
 * Output: scripts/results/benchmark-models-regen-{ts}.csv
 */

import { writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import path from 'path';
import { generateCompletion, AVAILABLE_MODELS } from '../services/groqClient.js';
import { checkFactuality, findRelevantContexts } from '../services/factualityChecker.js';
import { computeBertScore } from '../services/metricsService.js';
import { buildSummarizationPrompt, type ParticipantPreferences } from '../services/promptBuilder.js';
import type { ArticleStructure, FactualityResult, Profile } from '@summarizer/shared';

const BASE_URL = process.env.BASE_URL || 'https://summa.thomazritter.com.br';
const ADMIN_CODE = process.env.ADMIN_CODE || 'SUMMA-ADMIN';
const N_PARENTS = Number(process.env.N_PARENTS || 5);
// Optional: comma-separated list of article IDs to stratify the parent
// sample. When set, the bench picks the lowest-factuality eligible parent
// from EACH listed article (one per article). Useful for cross-domain
// runs, e.g. ARTICLE_IDS="1,2,15,16,17" mixes Code Review parents with
// NLI/SNLI parents to surface domain-dependent regen behaviour. When
// unset, the original "top N_PARENTS lowest factuality globally" rule
// remains in force.
const ARTICLE_IDS = (process.env.ARTICLE_IDS || '')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => Number.isFinite(n) && n > 0);
// Optional: restrict the model sweep. Comma-separated REGEN_MODELS env.
// When empty/unset, all AVAILABLE_MODELS run.
const requestedModels = (process.env.REGEN_MODELS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const MODELS = requestedModels.length > 0
  ? requestedModels
  : AVAILABLE_MODELS.map(m => m.id);

const stripThinking = (raw: string): string =>
  raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

interface ManagerSummary {
  id: number;
  articleId: number;
  profileId: number;
  content: string;
  factualityScore: number | null;
  rougeL: number | null;
}

interface ArticleResp {
  id: number;
  title: string;
  rawText: string;
  structuredContent: ArticleStructure;
}

interface ParentInfo {
  summaryId: number;
  articleId: number;
  profile: Profile;
  parentContent: string;
  parentFactuality: number;
  flagged: FactualityResult[];
  article: ArticleResp;
}

interface BenchRow {
  model: string;
  parent_summary_id: number;
  article_id: number;
  parent_factuality: number;
  regen_factuality: number | null;
  delta: number | null;
  pct_supported: number;
  pct_neutral: number;
  pct_contradicted: number;
  bert_score: number | null;
  summary_chars: number;
  duration_ms: number;
  error?: string;
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const stddev = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
};

// Profile presets matching the seeded ids on the production DB.
const PROFILE_BY_ID: Record<number, Profile> = {
  99: { id: 99, name: 'generic', expertise: 'intermediate', focus: 'all', depth: 'moderate', context: 'quick_review' } as Profile,
  100: { id: 100, name: 'junior', expertise: 'beginner', focus: 'concepts', depth: 'moderate', context: 'learning' } as Profile,
  101: { id: 101, name: 'pleno', expertise: 'intermediate', focus: 'methodology', depth: 'detailed', context: 'research' } as Profile,
  102: { id: 102, name: 'senior', expertise: 'advanced', focus: 'results', depth: 'comprehensive', context: 'research' } as Profile,
};

// Synthetic participant preferences applied uniformly to all parents in this
// benchmark. This matches the production regen path (which now looks up real
// participant prefs via experiment_sessions or articles.uploaded_by) by
// ensuring the regen prompt receives the same auxiliary fields the parent
// summary's first-gen prompt did. Without this, the regen prompt would be
// strictly smaller than the parent's, biasing the factuality measurement
// upward by giving the model less material to elaborate on. We use a fixed
// configuration to control for prefs across models — what we are isolating
// here is the model's effect, not the prefs' effect.
const REGEN_PREFERENCES: ParticipantPreferences = {
  structurePreference: 'prose',
  domain: 'software engineering',
  currentProject: undefined,
};

async function fetchParents(): Promise<ManagerSummary[]> {
  const res = await fetch(`${BASE_URL}/api/manager/summaries`, { headers: { 'x-access-code': ADMIN_CODE } });
  if (!res.ok) throw new Error(`manager summaries failed: ${res.status}`);
  const data = (await res.json()) as { summaries: ManagerSummary[] };

  // Default mode (global lowest-factuality, requires the article to have at
  // least one summary with rougeL so we know an abstract was identifiable):
  // keep the original §6.7 bench behaviour exactly so the headline numbers
  // remain comparable when ARTICLE_IDS is not provided.
  if (ARTICLE_IDS.length === 0) {
    const articlesWithAbstract = new Set(data.summaries.filter(s => s.rougeL !== null).map(s => s.articleId));
    const flagged = data.summaries
      .filter(s => s.factualityScore !== null && s.factualityScore < 1.0 && articlesWithAbstract.has(s.articleId))
      .sort((a, b) => (a.factualityScore ?? 1) - (b.factualityScore ?? 1));
    return flagged.slice(0, N_PARENTS);
  }

  // Stratified mode: take the lowest-factuality eligible parent per
  // requested article. Drops the rougeL gate because articles that lack a
  // detected abstract should still be testable for regen factuality
  // (factuality verification doesn't need an abstract — it pairs each
  // claim against article paragraphs directly).
  const eligible = data.summaries.filter(
    s => s.factualityScore !== null && s.factualityScore < 1.0,
  );
  const picked: ManagerSummary[] = [];
  for (const articleId of ARTICLE_IDS) {
    const candidates = eligible
      .filter(s => s.articleId === articleId)
      .sort((a, b) => (a.factualityScore ?? 1) - (b.factualityScore ?? 1));
    if (candidates.length === 0) {
      console.warn(`[bench-regen] article ${articleId} has no eligible parent (skipped)`);
      continue;
    }
    picked.push(candidates[0]);
  }
  return picked;
}

async function fetchArticle(id: number): Promise<ArticleResp> {
  const res = await fetch(`${BASE_URL}/api/articles/${id}`, { headers: { 'x-access-code': ADMIN_CODE } });
  if (!res.ok) throw new Error(`article ${id}: ${res.status}`);
  return (await res.json()) as ArticleResp;
}

function buildRegenPrompt(profile: Profile, structure: ArticleStructure, rawText: string, flagged: FactualityResult[]): string {
  const evidenceLines: string[] = [];
  flagged.forEach((d, idx) => {
    const ctxs = findRelevantContexts(d.sentence, structure, rawText);
    const anchor = ctxs[0] || d.sourceSentence || '';
    const anchorText = anchor.trim().length > 0 ? anchor.trim() : '(nenhum trecho-âncora identificado)';
    evidenceLines.push(`${idx + 1}. Frase: "${d.sentence}"\n   Trecho-âncora: "${anchorText}"`);
  });

  const basePrompt = buildSummarizationPrompt(profile, structure, rawText, REGEN_PREFERENCES);
  return `${basePrompt}

ATENÇÃO: O resumo anterior continha afirmações sinalizadas como NÃO APOIADAS pelo artigo original. Reescreva o resumo evitando essas afirmações. Para cada uma das frases listadas a seguir, ou (a) reformule-a de modo a alinhá-la ao trecho-âncora correspondente, ou (b) remova-a se o trecho-âncora não a sustenta de forma direta. Não introduza novas afirmações sem suporte explícito no artigo.

FRASES SINALIZADAS E TRECHOS-ÂNCORA:
${evidenceLines.join('\n')}`;
}

async function runOne(parent: ParentInfo, modelId: string): Promise<BenchRow> {
  const start = Date.now();
  const prompt = buildRegenPrompt(parent.profile, parent.article.structuredContent, parent.article.rawText, parent.flagged);

  let raw: string;
  try {
    raw = await generateCompletion({ prompt, temperature: 0.1, maxTokens: 8192, model: modelId });
  } catch (e) {
    return {
      model: modelId, parent_summary_id: parent.summaryId, article_id: parent.articleId,
      parent_factuality: parent.parentFactuality, regen_factuality: 0, delta: -parent.parentFactuality,
      pct_supported: 0, pct_neutral: 0, pct_contradicted: 0, bert_score: null,
      summary_chars: 0, duration_ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const summary = stripThinking(raw);

  // checkFactuality returns score=null when no verifiable claims survive
  // the pre-NLI filter. The catch below maps a SERVICE FAILURE (NLI down,
  // network error) to a null score too, so the bench row is excluded from
  // aggregate statistics downstream instead of poisoning them with a
  // false-zero "catastrophic regression".
  const fact = await checkFactuality(summary, parent.article.structuredContent, parent.article.rawText).catch((err) => {
    console.warn(`  [bench] checkFactuality failed for ${modelId}: ${err instanceof Error ? err.message : String(err)} — score null`);
    return { score: null as number | null, results: [] as FactualityResult[] };
  });
  const total = fact.results.length || 1;
  const supported = fact.results.filter(r => r.label === 'supported').length;
  const neutral = fact.results.filter(r => r.label === 'neutral').length;
  const contradicted = fact.results.filter(r => r.label === 'contradicted').length;

  const reference = (parent.article.structuredContent.abstract || '').trim();
  let bert: number | null = null;
  if (reference.length > 0) {
    bert = await computeBertScore(summary, reference).catch(() => null);
  }

  // If the regen has no verifiable claims, factuality is "not measured" — log it
  // and emit NaN so the row is excluded from aggregate statistics downstream.
  const regenFactuality = fact.score;
  const delta = regenFactuality === null ? null : regenFactuality - parent.parentFactuality;

  return {
    model: modelId, parent_summary_id: parent.summaryId, article_id: parent.articleId,
    parent_factuality: Number(parent.parentFactuality.toFixed(4)),
    regen_factuality: regenFactuality === null ? null : Number(regenFactuality.toFixed(4)),
    delta: delta === null ? null : Number(delta.toFixed(4)),
    pct_supported: Number((100 * supported / total).toFixed(1)),
    pct_neutral: Number((100 * neutral / total).toFixed(1)),
    pct_contradicted: Number((100 * contradicted / total).toFixed(1)),
    bert_score: bert !== null ? Number(bert.toFixed(4)) : null,
    summary_chars: summary.length,
    duration_ms: Date.now() - start,
  };
}

async function main() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY not set in environment; aborting before any LLM calls are wasted.');
  }
  const invalidModels = MODELS.filter(id => !AVAILABLE_MODELS.some(m => m.id === id));
  if (invalidModels.length > 0) {
    throw new Error(`REGEN_MODELS contains unknown model id(s): ${invalidModels.join(', ')}. Allowed: ${AVAILABLE_MODELS.map(m => m.id).join(', ')}`);
  }
  console.log('\n=== Regen-with-evidence model benchmark ===');
  const candidates = await fetchParents();
  if (candidates.length === 0) {
    console.error('No parents found.');
    process.exit(1);
  }
  console.log(`Parents: ${candidates.map(c => c.id).join(', ')}`);
  console.log(`Models: ${MODELS.length}\n`);

  // Build ParentInfo: fetch article + recompute factuality on each parent to get fresh flagged sentences.
  const parents: ParentInfo[] = [];
  for (const c of candidates) {
    process.stdout.write(`  Preparing parent id=${c.id} (article ${c.articleId})…`);
    const article = await fetchArticle(c.articleId);
    const fact = await checkFactuality(c.content, article.structuredContent, article.rawText);
    const flagged = fact.results.filter(r => r.label !== 'supported');
    if (flagged.length === 0) {
      console.log(' (no flagged sentences after recompute, skipping)');
      continue;
    }
    if (fact.score === null) {
      console.log(' (no verifiable claims after recompute, skipping)');
      continue;
    }
    parents.push({
      summaryId: c.id,
      articleId: c.articleId,
      profile: PROFILE_BY_ID[c.profileId] ?? PROFILE_BY_ID[101],
      parentContent: c.content,
      parentFactuality: fact.score,
      flagged,
      article,
    });
    console.log(` ok (${flagged.length} flagged, score=${fact.score.toFixed(3)})`);
  }
  if (parents.length === 0) {
    console.error('No usable parents.');
    process.exit(1);
  }

  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const resultsDir = path.resolve(scriptDir, '../../../../scripts/results');
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(resultsDir, `benchmark-models-regen-${ts}.csv`);
  writeFileSync(csvPath, 'model,parent_summary_id,article_id,parent_factuality,regen_factuality,delta,pct_supported,pct_neutral,pct_contradicted,bert_score,summary_chars,duration_ms,error\n');

  const all: BenchRow[] = [];
  let idx = 0;
  const total = parents.length * MODELS.length;
  for (const parent of parents) {
    for (const modelId of MODELS) {
      idx++;
      process.stdout.write(`[${idx}/${total}] ${modelId.slice(0, 30)} on parent=${parent.summaryId}…`);
      const row = await runOne(parent, modelId);
      all.push(row);
      const csv = [
        JSON.stringify(row.model), row.parent_summary_id, row.article_id,
        row.parent_factuality, row.regen_factuality, row.delta,
        row.pct_supported, row.pct_neutral, row.pct_contradicted,
        row.bert_score ?? '', row.summary_chars, row.duration_ms,
        row.error ? JSON.stringify(row.error) : '',
      ].join(',');
      appendFileSync(csvPath, csv + '\n');
      if (row.error) {
        console.log(` ERR: ${row.error.slice(0, 50)}`);
      } else {
        if (row.regen_factuality === null || row.delta === null) {
          console.log(` ${row.parent_factuality.toFixed(2)}→n/a (no verifiable claims) bert=${row.bert_score ?? '?'} (${row.duration_ms}ms)`);
        } else {
          const arrow = row.delta > 0.001 ? '↑' : row.delta < -0.001 ? '↓' : '=';
          console.log(` ${row.parent_factuality.toFixed(2)}→${row.regen_factuality.toFixed(2)} ${arrow}${row.delta.toFixed(3)} bert=${row.bert_score ?? '?'} (${row.duration_ms}ms)`);
        }
      }
    }
  }

  console.log(`\n=== Aggregate per model (${parents.length} parents each) ===`);
  for (const m of MODELS) {
    const rows = all.filter(r => r.model === m && !r.error && r.regen_factuality !== null && r.delta !== null);
    if (rows.length === 0) {
      console.log(`  ${m}: no successful runs`);
      continue;
    }
    const facts = rows.map(r => r.regen_factuality as number);
    const deltas = rows.map(r => r.delta as number);
    const improved = rows.filter(r => (r.delta as number) > 0.001).length;
    const factMean = mean(facts);
    const factStd = stddev(facts);
    const deltaMean = mean(deltas);
    const bert = mean(rows.filter(r => r.bert_score !== null).map(r => r.bert_score as number));
    const dur = mean(rows.map(r => r.duration_ms));
    console.log(`  ${m.padEnd(45)} fact=${factMean.toFixed(3)}±${factStd.toFixed(3)}  Δ=${deltaMean >= 0 ? '+' : ''}${deltaMean.toFixed(3)}  improved=${improved}/${rows.length}  bert=${bert.toFixed(3)}  ${(dur / 1000).toFixed(1)}s`);
  }

  console.log(`\nCSV: ${csvPath}\n`);
}

main().catch(e => {
  console.error('Benchmark failed:', e);
  process.exit(1);
});
