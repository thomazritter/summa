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
import type { ArticleStructure, FactualityResult, Profile } from '@summarizer/shared';
import { buildV0 } from './promptVariants.js';

const BASE_URL = process.env.BASE_URL || 'https://summa.thomazritter.com.br';
const ADMIN_CODE = process.env.ADMIN_CODE || 'SUMMA-ADMIN';
const N_PARENTS = Number(process.env.N_PARENTS || 5);
const MODELS = AVAILABLE_MODELS.map(m => m.id);

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
  regen_factuality: number;
  delta: number;
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

async function fetchParents(): Promise<ManagerSummary[]> {
  const res = await fetch(`${BASE_URL}/api/manager/summaries`, { headers: { 'x-access-code': ADMIN_CODE } });
  if (!res.ok) throw new Error(`manager summaries failed: ${res.status}`);
  const data = (await res.json()) as { summaries: ManagerSummary[] };
  // Filter: factualityScore < 1.0 + article has abstract (proxy: another summary of same article has rougeL)
  const articlesWithAbstract = new Set(data.summaries.filter(s => s.rougeL !== null).map(s => s.articleId));
  const flagged = data.summaries
    .filter(s => s.factualityScore !== null && s.factualityScore < 1.0 && articlesWithAbstract.has(s.articleId))
    .sort((a, b) => (a.factualityScore ?? 1) - (b.factualityScore ?? 1));
  return flagged.slice(0, N_PARENTS);
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

  const basePrompt = buildV0(profile, structure, rawText);
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

  const fact = await checkFactuality(summary, parent.article.structuredContent, parent.article.rawText).catch(() => ({
    score: 0, results: [] as FactualityResult[],
  }));
  const total = fact.results.length || 1;
  const supported = fact.results.filter(r => r.label === 'supported').length;
  const neutral = fact.results.filter(r => r.label === 'neutral').length;
  const contradicted = fact.results.filter(r => r.label === 'contradicted').length;

  const reference = (parent.article.structuredContent.abstract || '').trim();
  let bert: number | null = null;
  if (reference.length > 0) {
    bert = await computeBertScore(summary, reference).catch(() => null);
  }

  return {
    model: modelId, parent_summary_id: parent.summaryId, article_id: parent.articleId,
    parent_factuality: Number(parent.parentFactuality.toFixed(4)),
    regen_factuality: Number(fact.score.toFixed(4)),
    delta: Number((fact.score - parent.parentFactuality).toFixed(4)),
    pct_supported: Number((100 * supported / total).toFixed(1)),
    pct_neutral: Number((100 * neutral / total).toFixed(1)),
    pct_contradicted: Number((100 * contradicted / total).toFixed(1)),
    bert_score: bert !== null ? Number(bert.toFixed(4)) : null,
    summary_chars: summary.length,
    duration_ms: Date.now() - start,
  };
}

async function main() {
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
        const arrow = row.delta > 0.001 ? '↑' : row.delta < -0.001 ? '↓' : '=';
        console.log(` ${row.parent_factuality.toFixed(2)}→${row.regen_factuality.toFixed(2)} ${arrow}${row.delta.toFixed(3)} bert=${row.bert_score ?? '?'} (${row.duration_ms}ms)`);
      }
    }
  }

  console.log(`\n=== Aggregate per model (${parents.length} parents each) ===`);
  for (const m of MODELS) {
    const rows = all.filter(r => r.model === m && !r.error);
    if (rows.length === 0) {
      console.log(`  ${m}: no successful runs`);
      continue;
    }
    const facts = rows.map(r => r.regen_factuality);
    const deltas = rows.map(r => r.delta);
    const improved = rows.filter(r => r.delta > 0.001).length;
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
