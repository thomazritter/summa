/**
 * Regen-prompt variant benchmark.
 *
 * Holds the model fixed (Llama 4 Scout 17B, the production regen default
 * chosen in benchmark-models-regen.ts and documented in Apêndice F) and
 * varies the prompt structure across four variants. Goal: justify the
 * production regen prompt empirically, in the same way Apêndice E justifies
 * the first-gen prompt.
 *
 * Variants:
 *   R0 — production: first-gen prompt + 4th block with flagged sentences
 *        AND their anchor paragraphs. Baseline.
 *   R1 — no anchors: first-gen prompt + 4th block with flagged sentences
 *        ONLY (no anchor paragraphs). Isolates the contribution of
 *        evidence grounding (Chen 2025 / HaluMap).
 *   R2 — instruction-first: 4th block placed BEFORE the first-gen prompt,
 *        so the regen directive is read before the article body. Tests
 *        format/order effect (He 2024 / DoesPromptFormat).
 *   R3 — atomic-claim decomposition: same as R0 but the instruction asks
 *        the model to FIRST decompose each flagged sentence into atomic
 *        claims and only THEN rewrite. Tests whether explicit granularity
 *        helps (You 2025 / PlainQAFact).
 *
 * Flow per (parent summary, variant):
 *   1. Fetch parent.content + article
 *   2. Recompute checkFactuality on parent → flagged sentences + anchors
 *   3. Build prompt per variant
 *   4. Call Groq with Llama 4 Scout 17B at temp 0.1
 *   5. Strip <think>...</think>
 *   6. Re-run checkFactuality on regen output
 *   7. Record: new factuality, delta, BERTScore, latency
 *
 * Stratified by article (5 distinct article_ids) matching the layout of
 * benchmark-models-regen-stratified-2026-05-12.csv so the result rows are
 * directly comparable to the Apêndice F model-sweep table.
 *
 * Usage:
 *   ARTICLE_IDS="1,2,8,9,16" REGEN_PROMPT_VARIANTS="R0,R1,R2,R3" \
 *     tsx src/scripts/benchmark-regen-prompts.ts
 */

import { writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCompletion } from '../services/groqClient.js';
import { checkFactuality, findRelevantContexts } from '../services/factualityChecker.js';
import { computeBertScore } from '../services/metricsService.js';
import { buildSummarizationPrompt, type ParticipantPreferences } from '../services/promptBuilder.js';
import type { ArticleStructure, FactualityResult, Profile } from '@summarizer/shared';

const BASE_URL = process.env.BASE_URL || 'https://summa.thomazritter.com.br';
const ADMIN_CODE = process.env.ADMIN_CODE || 'SUMMA-ADMIN';

const MODEL_ID = process.env.REGEN_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
const TEMPERATURE = Number(process.env.REGEN_TEMPERATURE || 0.1);
const MAX_TOKENS = Number(process.env.REGEN_MAX_TOKENS || 8192);

type VariantId = 'R0' | 'R1' | 'R2' | 'R3';
const ALL_VARIANTS: VariantId[] = ['R0', 'R1', 'R2', 'R3'];
const requestedVariants = (process.env.REGEN_PROMPT_VARIANTS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean) as VariantId[];
const VARIANTS: VariantId[] = requestedVariants.length > 0 ? requestedVariants : ALL_VARIANTS;

const ARTICLE_IDS = (process.env.ARTICLE_IDS || '1,2,8,9,16')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => Number.isFinite(n) && n > 0);

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
  variant: VariantId;
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

// Match the model bench so the prompt structure is identical when comparing
// variant rows here against model rows in benchmark-models-regen output.
const PROFILE_BY_ID: Record<number, Profile> = {
  99: { id: 99, name: 'generic', expertise: 'intermediate', focus: 'all', depth: 'moderate', context: 'quick_review' } as Profile,
  100: { id: 100, name: 'junior', expertise: 'beginner', focus: 'concepts', depth: 'moderate', context: 'learning' } as Profile,
  101: { id: 101, name: 'pleno', expertise: 'intermediate', focus: 'methodology', depth: 'detailed', context: 'research' } as Profile,
  102: { id: 102, name: 'senior', expertise: 'advanced', focus: 'results', depth: 'comprehensive', context: 'research' } as Profile,
};

const REGEN_PREFERENCES: ParticipantPreferences = {
  structurePreference: 'prose',
  domain: 'software engineering',
  currentProject: undefined,
};

async function fetchParents(): Promise<ManagerSummary[]> {
  const res = await fetch(`${BASE_URL}/api/manager/summaries`, { headers: { 'x-access-code': ADMIN_CODE } });
  if (!res.ok) throw new Error(`manager summaries failed: ${res.status}`);
  const data = (await res.json()) as { summaries: ManagerSummary[] };

  const eligible = data.summaries.filter(
    s => s.factualityScore !== null && s.factualityScore < 1.0,
  );
  const picked: ManagerSummary[] = [];
  for (const articleId of ARTICLE_IDS) {
    const candidates = eligible
      .filter(s => s.articleId === articleId)
      .sort((a, b) => (a.factualityScore ?? 1) - (b.factualityScore ?? 1));
    if (candidates.length === 0) {
      console.warn(`[bench-regen-prompts] article ${articleId} has no eligible parent (skipped)`);
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

// --- Variant prompt builders ---------------------------------------------

const buildEvidenceBlock = (
  flagged: FactualityResult[],
  structure: ArticleStructure,
  rawText: string,
  includeAnchor: boolean,
): string => {
  const lines: string[] = [];
  flagged.forEach((d, idx) => {
    if (includeAnchor) {
      const ctxs = findRelevantContexts(d.sentence, structure, rawText);
      const anchor = ctxs[0] || d.sourceSentence || '';
      const anchorText = anchor.trim().length > 0 ? anchor.trim() : '(nenhum trecho-âncora identificado)';
      lines.push(`${idx + 1}. Frase: "${d.sentence}"\n   Trecho-âncora: "${anchorText}"`);
    } else {
      lines.push(`${idx + 1}. Frase: "${d.sentence}"`);
    }
  });
  return lines.join('\n');
};

const R0_INSTRUCTION =
  'ATENÇÃO: O resumo anterior continha afirmações sinalizadas como NÃO APOIADAS pelo artigo original. ' +
  'Reescreva o resumo evitando essas afirmações. Para cada uma das frases listadas a seguir, ou (a) reformule-a ' +
  'de modo a alinhá-la ao trecho-âncora correspondente, ou (b) remova-a se o trecho-âncora não a sustenta de ' +
  'forma direta. Não introduza novas afirmações sem suporte explícito no artigo.';

const R1_INSTRUCTION =
  'ATENÇÃO: O resumo anterior continha afirmações sinalizadas como NÃO APOIADAS pelo artigo original. ' +
  'Reescreva o resumo evitando essas afirmações. Para cada uma das frases listadas a seguir, ou (a) reformule-a ' +
  'de modo a alinhá-la ao conteúdo verificável do artigo, ou (b) remova-a se o artigo não a sustenta de forma ' +
  'direta. Não introduza novas afirmações sem suporte explícito no artigo.';

const R3_INSTRUCTION =
  'ATENÇÃO: O resumo anterior continha afirmações sinalizadas como NÃO APOIADAS pelo artigo original. ' +
  'Para cada uma das frases listadas a seguir, execute o seguinte procedimento ANTES de reescrever:\n' +
  '  1. Decomponha a frase em afirmações atômicas independentes (1 a 4 claims).\n' +
  '  2. Para cada claim, verifique se o trecho-âncora a sustenta diretamente.\n' +
  '  3. Mantenha apenas as claims sustentadas; descarte ou reformule as não sustentadas.\n' +
  'Ao final, reescreva o resumo integrando apenas claims sustentadas pelo artigo. Não introduza novas ' +
  'afirmações sem suporte explícito.';

function buildPromptR0(parent: ParentInfo): string {
  const basePrompt = buildSummarizationPrompt(parent.profile, parent.article.structuredContent, parent.article.rawText, REGEN_PREFERENCES);
  const evidence = buildEvidenceBlock(parent.flagged, parent.article.structuredContent, parent.article.rawText, true);
  return `${basePrompt}\n\n${R0_INSTRUCTION}\n\nFRASES SINALIZADAS E TRECHOS-ÂNCORA:\n${evidence}`;
}

function buildPromptR1(parent: ParentInfo): string {
  const basePrompt = buildSummarizationPrompt(parent.profile, parent.article.structuredContent, parent.article.rawText, REGEN_PREFERENCES);
  const evidence = buildEvidenceBlock(parent.flagged, parent.article.structuredContent, parent.article.rawText, false);
  return `${basePrompt}\n\n${R1_INSTRUCTION}\n\nFRASES SINALIZADAS:\n${evidence}`;
}

function buildPromptR2(parent: ParentInfo): string {
  const basePrompt = buildSummarizationPrompt(parent.profile, parent.article.structuredContent, parent.article.rawText, REGEN_PREFERENCES);
  const evidence = buildEvidenceBlock(parent.flagged, parent.article.structuredContent, parent.article.rawText, true);
  // Instruction block moved to BEFORE the base prompt so the regen directive
  // is read prior to the article body.
  return `${R0_INSTRUCTION}\n\nFRASES SINALIZADAS E TRECHOS-ÂNCORA:\n${evidence}\n\n--- CONTEXTO COMPLETO PARA A REESCRITA ---\n\n${basePrompt}`;
}

function buildPromptR3(parent: ParentInfo): string {
  const basePrompt = buildSummarizationPrompt(parent.profile, parent.article.structuredContent, parent.article.rawText, REGEN_PREFERENCES);
  const evidence = buildEvidenceBlock(parent.flagged, parent.article.structuredContent, parent.article.rawText, true);
  return `${basePrompt}\n\n${R3_INSTRUCTION}\n\nFRASES SINALIZADAS E TRECHOS-ÂNCORA:\n${evidence}`;
}

function buildPrompt(variant: VariantId, parent: ParentInfo): string {
  switch (variant) {
    case 'R0': return buildPromptR0(parent);
    case 'R1': return buildPromptR1(parent);
    case 'R2': return buildPromptR2(parent);
    case 'R3': return buildPromptR3(parent);
  }
}

// --- Bench loop ----------------------------------------------------------

async function runOne(parent: ParentInfo, variant: VariantId): Promise<BenchRow> {
  const start = Date.now();
  const prompt = buildPrompt(variant, parent);

  let raw: string;
  try {
    raw = await generateCompletion({ prompt, temperature: TEMPERATURE, maxTokens: MAX_TOKENS, model: MODEL_ID });
  } catch (e) {
    return {
      variant, model: MODEL_ID, parent_summary_id: parent.summaryId, article_id: parent.articleId,
      parent_factuality: parent.parentFactuality, regen_factuality: 0, delta: -parent.parentFactuality,
      pct_supported: 0, pct_neutral: 0, pct_contradicted: 0, bert_score: null,
      summary_chars: 0, duration_ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const summary = stripThinking(raw);

  const fact = await checkFactuality(summary, parent.article.structuredContent, parent.article.rawText).catch((err) => {
    console.warn(`  [bench] checkFactuality failed for ${variant}: ${err instanceof Error ? err.message : String(err)} — score null`);
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

  const regenFactuality = fact.score;
  const delta = regenFactuality === null ? null : regenFactuality - parent.parentFactuality;

  return {
    variant, model: MODEL_ID, parent_summary_id: parent.summaryId, article_id: parent.articleId,
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
    throw new Error('GROQ_API_KEY not set; aborting before any LLM calls are wasted.');
  }
  console.log('\n=== Regen-prompt variant benchmark ===');
  console.log(`Model: ${MODEL_ID}`);
  console.log(`Variants: ${VARIANTS.join(', ')}`);
  console.log(`Articles: ${ARTICLE_IDS.join(', ')}\n`);

  const candidates = await fetchParents();
  if (candidates.length === 0) {
    console.error('No parents found.');
    process.exit(1);
  }

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

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const resultsDir = path.resolve(__dirname, '../../../../scripts/results');
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(resultsDir, `benchmark-regen-prompts-${ts}.csv`);
  writeFileSync(csvPath, 'variant,model,parent_summary_id,article_id,parent_factuality,regen_factuality,delta,pct_supported,pct_neutral,pct_contradicted,bert_score,summary_chars,duration_ms,error\n');

  const all: BenchRow[] = [];
  let idx = 0;
  const total = parents.length * VARIANTS.length;
  for (const parent of parents) {
    for (const variant of VARIANTS) {
      idx++;
      process.stdout.write(`[${idx}/${total}] ${variant} on parent=${parent.summaryId}…`);
      const row = await runOne(parent, variant);
      all.push(row);
      const csv = [
        row.variant, JSON.stringify(row.model), row.parent_summary_id, row.article_id,
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
          console.log(` ${row.parent_factuality.toFixed(2)}→n/a (no verifiable claims) (${row.duration_ms}ms)`);
        } else {
          const arrow = row.delta > 0.001 ? '↑' : row.delta < -0.001 ? '↓' : '=';
          console.log(` ${row.parent_factuality.toFixed(2)}→${row.regen_factuality.toFixed(2)} ${arrow}${row.delta.toFixed(3)} (${row.duration_ms}ms)`);
        }
      }
    }
  }

  console.log(`\n=== Aggregate per variant (${parents.length} parents each) ===`);
  for (const v of VARIANTS) {
    const rows = all.filter(r => r.variant === v && !r.error && r.regen_factuality !== null && r.delta !== null);
    if (rows.length === 0) {
      console.log(`  ${v}: no successful runs`);
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
    console.log(`  ${v}  fact=${factMean.toFixed(3)}±${factStd.toFixed(3)}  Δ=${deltaMean >= 0 ? '+' : ''}${deltaMean.toFixed(3)}  improved=${improved}/${rows.length}  bert=${bert.toFixed(3)}  ${(dur / 1000).toFixed(1)}s`);
  }

  console.log(`\nCSV: ${csvPath}\n`);
}

main().catch(e => {
  console.error('Benchmark failed:', e);
  process.exit(1);
});
