/**
 * LLM-as-Judge selection benchmark.
 *
 * Production runs the second pass of factuality verification through a generic
 * `generateCompletion()` call (no model override), which means the judge
 * inherits whatever is active on the global Groq client (Llama 3.3 70B by
 * default). That choice was conventional, not empirical. This benchmark
 * supplies the empirical basis by treating the judge as a 3-class
 * classification task over a cross-lingual NLI dataset and measuring each
 * candidate model's agreement with ground-truth labels.
 *
 * Methodology (Mode B from the proposal):
 *   - Dataset: MoritzLaurer/multilingual-NLI-26lang-2mil7, split pt_mnli.
 *     This is a community-translated MNLI corpus by the same author who
 *     trained the mDeBERTa NLI model used in production, so the bench
 *     mirrors the conditions under which the production NLI step itself
 *     was tuned. Rows expose both the original EN texts and PT machine
 *     translations.
 *   - Cross-lingual pairing: premise = premise_original (EN), hypothesis
 *     = hypothesis (PT). This mirrors the production scenario in which
 *     the anchor is an English paragraph from the article and the
 *     sentence is in Portuguese from the generated summary.
 *   - Sample: 30 examples per class × 3 classes = 90 pairs, taken
 *     deterministically from the start of the split (no random seed) and
 *     stratified by label.
 *   - Prompts: TWO variants tested independently per model:
 *       1. verbatim — copied as-is from factualityChecker.ts, including
 *          the "NLI marcou esta frase como neutra" framing that reflects
 *          production conditions (judge only called on NLI-neutral cases).
 *       2. neutralized — same task but with the NLI hint removed, to
 *          test pure classification ability without the bias toward
 *          re-classifying as neutral.
 *   - Per candidate: temperature 0.1, maxTokens 300, parse JSON output.
 *   - Aggregates: accuracy, macro F1, per-class precision/recall,
 *     confusion matrix, parse-failure count.
 *
 * Result files: scripts/results/benchmark-llm-judge-{ts}.csv (per-model
 * × per-variant summary) and benchmark-llm-judge-detail-{ts}.csv
 * (per-prediction rows).
 *
 * Limitation: MNLI source data is general-domain (news, fiction,
 * conversation), not scientific. The metric here isolates classification
 * ability, not domain transfer; the Apêndice F narrative records this
 * caveat alongside the numbers.
 *
 * Usage:
 *   N_PER_CLASS=30 JUDGE_MODELS=llama-3.3-70b-versatile,qwen/qwen3-32b
 *     tsx src/scripts/benchmark-llm-judge.ts
 */

import { writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCompletion, AVAILABLE_MODELS } from '../services/groqClient.js';

// Anchor output paths to this script's location so the CSVs always land in
// the repo's scripts/results/ folder regardless of cwd. process.cwd() was
// fragile because running via railway ssh or npm run from another package
// would scatter files elsewhere.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.resolve(__dirname, '../../../../scripts/results');

const N_PER_CLASS = Number(process.env.N_PER_CLASS || 30);
const requestedJudges = (process.env.JUDGE_MODELS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const JUDGE_MODELS = requestedJudges.length > 0
  ? requestedJudges
  : AVAILABLE_MODELS.map(m => m.id);

// Two prompt variants are evaluated to disentangle classification ability
// from the production prompt's pre-filter framing.
//
//   - verbatim: pulled exactly as factualityChecker.ts:198–223 uses it in
//     production. It declares to the model that "o modelo NLI marcou esta
//     frase como neutra" — testing the judge under the same conditions in
//     which production calls it (which is only on NLI-neutral cases).
//
//   - neutralized: the same task framing minus the NLI-marked-as-neutral
//     hint. Tests pure classification ability without the bias toward
//     re-classifying as neutral.
//
// The macro F1 / accuracy gap between the two answers the methodological
// question: is the production prompt's hint load-bearing, or is the model
// classifying on the textual evidence alone? Either result is publishable.
const LLM_JUDGE_PROMPT_VERBATIM = `Você é um avaliador de factualidade em sumários de artigos científicos.

Receberá um TRECHO-ÂNCORA do artigo original (em inglês) e uma FRASE do resumo (em português) que pode ou não estar suportada pelo trecho. O modelo NLI marcou esta frase como "neutra", o que pode significar paráfrase legítima OU afirmação sem suporte direto.

Sua tarefa:
1. Decomponha a frase em afirmações atômicas independentes (1 a 4 claims).
2. Para cada claim, verifique se está suportado pelo trecho-âncora — paráfrases, simplificações e reformulações fiéis CONTAM como suportadas.
3. Retorne um veredito agregado para a frase inteira:
   - "supported": todas as claims atômicas estão suportadas (paráfrases/simplificações fiéis incluem-se aqui).
   - "contradicted": ao menos uma claim contradiz o trecho-âncora.
   - "neutral": ao menos uma claim não pode ser nem confirmada nem refutada pelo trecho.

Retorne APENAS um JSON válido, sem markdown, sem explicação fora do JSON:
{"label":"supported|contradicted|neutral","rationale":"justificativa em 1-2 linhas, em português"}

TRECHO-ÂNCORA (artigo original, EN):
"""
{{anchor}}
"""

FRASE (resumo, PT):
"""
{{sentence}}
"""

JSON:`;

const LLM_JUDGE_PROMPT_NEUTRALIZED = `Você é um avaliador de factualidade em sumários de artigos científicos.

Receberá um TRECHO-ÂNCORA do artigo original (em inglês) e uma FRASE do resumo (em português). Decida se a frase é suportada, contradita ou neutra em relação ao trecho.

Sua tarefa:
1. Decomponha a frase em afirmações atômicas independentes (1 a 4 claims).
2. Para cada claim, verifique se está suportado pelo trecho-âncora — paráfrases, simplificações e reformulações fiéis CONTAM como suportadas.
3. Retorne um veredito agregado para a frase inteira:
   - "supported": todas as claims atômicas estão suportadas (paráfrases/simplificações fiéis incluem-se aqui).
   - "contradicted": ao menos uma claim contradiz o trecho-âncora.
   - "neutral": ao menos uma claim não pode ser nem confirmada nem refutada pelo trecho.

Retorne APENAS um JSON válido, sem markdown, sem explicação fora do JSON:
{"label":"supported|contradicted|neutral","rationale":"justificativa em 1-2 linhas, em português"}

TRECHO-ÂNCORA (artigo original, EN):
"""
{{anchor}}
"""

FRASE (resumo, PT):
"""
{{sentence}}
"""

JSON:`;

type PromptVariant = 'verbatim' | 'neutralized';
const PROMPT_TEMPLATES: Record<PromptVariant, string> = {
  verbatim: LLM_JUDGE_PROMPT_VERBATIM,
  neutralized: LLM_JUDGE_PROMPT_NEUTRALIZED,
};
const PROMPT_VARIANTS: PromptVariant[] = ['verbatim', 'neutralized'];

type NliLabel = 0 | 1 | 2;
const LABEL_NAMES: Record<NliLabel, 'supported' | 'neutral' | 'contradicted'> = {
  0: 'supported',     // entailment
  1: 'neutral',
  2: 'contradicted',  // contradiction
};

interface NliRow {
  row: {
    premise_original: string;  // EN
    hypothesis_original: string; // EN
    premise: string;             // PT
    hypothesis: string;          // PT
    label: NliLabel;
  };
  row_idx: number;
}

interface JoinedPair {
  rowIdx: number;
  premise_en: string;
  hypothesis_pt: string;
  trueLabel: 'supported' | 'neutral' | 'contradicted';
}

interface PredictionRow {
  model: string;
  variant: PromptVariant;
  rowIdx: number;
  trueLabel: 'supported' | 'neutral' | 'contradicted';
  predLabel: 'supported' | 'neutral' | 'contradicted' | 'parse_error';
  durationMs: number;
}

async function fetchNliRows(total: number): Promise<NliRow[]> {
  const out: NliRow[] = [];
  let offset = 0;
  const pageSize = 100;
  const datasetParam = encodeURIComponent('MoritzLaurer/multilingual-NLI-26lang-2mil7');
  while (out.length < total) {
    const url = `https://datasets-server.huggingface.co/rows?dataset=${datasetParam}&config=default&split=pt_mnli&offset=${offset}&length=${pageSize}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HF API offset=${offset}: HTTP ${res.status}`);
    }
    const json = await res.json() as { rows: NliRow[] };
    if (!json.rows || json.rows.length === 0) break;
    out.push(...json.rows);
    offset += json.rows.length;
    if (json.rows.length < pageSize) break;
  }
  return out.slice(0, total);
}

async function buildStratifiedSample(nPerClass: number): Promise<JoinedPair[]> {
  // We don't know the class distribution a priori in pt_mnli; in MNLI the
  // 3 classes are roughly balanced, so pulling 20x the target per class
  // is a safe headroom that lets stratification finish in one fetch loop.
  const target = Math.max(600, nPerClass * 20);
  console.log(`[bench-judge] fetching MoritzLaurer multilingual-NLI pt_mnli rows (target=${target})…`);
  const rows = await fetchNliRows(target);
  console.log(`[bench-judge] fetched: ${rows.length} rows`);

  const byClass: Record<'supported' | 'neutral' | 'contradicted', JoinedPair[]> = {
    supported: [],
    neutral: [],
    contradicted: [],
  };
  for (const r of rows) {
    const trueLabel = LABEL_NAMES[r.row.label];
    if (!trueLabel) continue;
    byClass[trueLabel].push({
      rowIdx: r.row_idx,
      premise_en: r.row.premise_original,
      hypothesis_pt: r.row.hypothesis,
      trueLabel,
    });
  }

  const sample = [
    ...byClass.supported.slice(0, nPerClass),
    ...byClass.neutral.slice(0, nPerClass),
    ...byClass.contradicted.slice(0, nPerClass),
  ];
  console.log(`[bench-judge] sample built: supported=${Math.min(byClass.supported.length, nPerClass)} neutral=${Math.min(byClass.neutral.length, nPerClass)} contradicted=${Math.min(byClass.contradicted.length, nPerClass)}`);
  return sample;
}

function parseJudgeOutput(raw: string): 'supported' | 'neutral' | 'contradicted' | 'parse_error' {
  const cleaned = raw.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return 'parse_error';
  try {
    const parsed = JSON.parse(cleaned.slice(first, last + 1));
    if (parsed.label === 'supported' || parsed.label === 'contradicted' || parsed.label === 'neutral') {
      return parsed.label;
    }
    return 'parse_error';
  } catch {
    return 'parse_error';
  }
}

async function runOne(pair: JoinedPair, model: string, variant: PromptVariant): Promise<PredictionRow> {
  const prompt = PROMPT_TEMPLATES[variant]
    .replace('{{anchor}}', pair.premise_en.slice(0, 1500))
    .replace('{{sentence}}', pair.hypothesis_pt);
  const start = Date.now();
  let raw: string;
  try {
    raw = await generateCompletion({ prompt, temperature: 0.1, maxTokens: 300, model });
  } catch {
    return {
      model,
      variant,
      rowIdx: pair.rowIdx,
      trueLabel: pair.trueLabel,
      predLabel: 'parse_error',
      durationMs: Date.now() - start,
    };
  }
  // Strip Qwen-style chain-of-thought blocks if present (Qwen returns
  // <think>...</think> wrappers that confuse the JSON parser).
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const predLabel = parseJudgeOutput(cleaned);
  return {
    model,
    variant,
    rowIdx: pair.rowIdx,
    trueLabel: pair.trueLabel,
    predLabel,
    durationMs: Date.now() - start,
  };
}

function aggregate(preds: PredictionRow[], labels: Array<'supported' | 'neutral' | 'contradicted'>) {
  // Confusion matrix: rows = true label, cols = predicted label (parse_error tracked separately)
  const matrix: Record<string, Record<string, number>> = {};
  for (const t of labels) matrix[t] = { supported: 0, neutral: 0, contradicted: 0, parse_error: 0 };
  for (const p of preds) {
    matrix[p.trueLabel][p.predLabel] = (matrix[p.trueLabel][p.predLabel] || 0) + 1;
  }
  // Accuracy
  const total = preds.length;
  let correct = 0;
  for (const t of labels) correct += matrix[t][t] || 0;
  const accuracy = total === 0 ? 0 : correct / total;
  // Per-class precision/recall/F1
  const perClass: Record<string, { precision: number; recall: number; f1: number; support: number }> = {};
  for (const c of labels) {
    const tp = matrix[c][c] || 0;
    const fp = labels.reduce((s, t) => (t === c ? s : s + (matrix[t][c] || 0)), 0);
    const fn = labels.reduce((s, p) => (p === c ? s : s + (matrix[c][p] || 0)), 0);
    const support = labels.reduce((s, p) => s + (matrix[c][p] || 0), 0);
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    perClass[c] = { precision, recall, f1, support };
  }
  const macroF1 = labels.reduce((s, c) => s + perClass[c].f1, 0) / labels.length;
  const parseErrors = preds.filter(p => p.predLabel === 'parse_error').length;
  return { accuracy, macroF1, perClass, matrix, parseErrors, total };
}

async function main() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY not set in environment; aborting before any LLM calls are wasted.');
  }
  const invalid = JUDGE_MODELS.filter(id => !AVAILABLE_MODELS.some(m => m.id === id));
  if (invalid.length > 0) {
    throw new Error(`JUDGE_MODELS contains unknown model id(s): ${invalid.join(', ')}. Allowed: ${AVAILABLE_MODELS.map(m => m.id).join(', ')}`);
  }
  console.log(`[bench-judge] candidates: ${JUDGE_MODELS.join(', ')}`);
  console.log(`[bench-judge] N_PER_CLASS=${N_PER_CLASS}`);
  const sample = await buildStratifiedSample(N_PER_CLASS);
  console.log(`[bench-judge] total sample: ${sample.length} pairs`);

  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const detailPath = path.join(RESULTS_DIR, `benchmark-llm-judge-detail-${ts}.csv`);
  const summaryPath = path.join(RESULTS_DIR, `benchmark-llm-judge-${ts}.csv`);
  writeFileSync(detailPath, 'model,variant,row_idx,true_label,pred_label,duration_ms\n');
  writeFileSync(summaryPath, 'model,variant,n,accuracy,macro_f1,parse_errors,precision_supported,recall_supported,f1_supported,precision_neutral,recall_neutral,f1_neutral,precision_contradicted,recall_contradicted,f1_contradicted\n');

  const labels: Array<'supported' | 'neutral' | 'contradicted'> = ['supported', 'neutral', 'contradicted'];

  for (const model of JUDGE_MODELS) {
    for (const variant of PROMPT_VARIANTS) {
      console.log(`\n=== model: ${model} | variant: ${variant} ===`);
      const preds: PredictionRow[] = [];
      let i = 0;
      for (const pair of sample) {
        i += 1;
        const row = await runOne(pair, model, variant);
        preds.push(row);
        appendFileSync(
          detailPath,
          `${row.model},${row.variant},${row.rowIdx},${row.trueLabel},${row.predLabel},${row.durationMs}\n`,
        );
        if (i % 10 === 0 || i === sample.length) {
          console.log(`  [${i}/${sample.length}] last=${row.trueLabel}→${row.predLabel} (${row.durationMs}ms)`);
        }
      }
      const agg = aggregate(preds, labels);
      console.log(`  accuracy=${agg.accuracy.toFixed(3)} macroF1=${agg.macroF1.toFixed(3)} parseErrors=${agg.parseErrors}`);
      console.log('  confusion (rows=true, cols=pred):');
      for (const t of labels) {
        const row = agg.matrix[t];
        console.log(`    ${t.padEnd(13)}: supported=${row.supported || 0} neutral=${row.neutral || 0} contradicted=${row.contradicted || 0} parse_error=${row.parse_error || 0}`);
      }
      appendFileSync(
        summaryPath,
        [
          model,
          variant,
          agg.total,
          agg.accuracy.toFixed(4),
          agg.macroF1.toFixed(4),
          agg.parseErrors,
          agg.perClass.supported.precision.toFixed(4),
          agg.perClass.supported.recall.toFixed(4),
          agg.perClass.supported.f1.toFixed(4),
          agg.perClass.neutral.precision.toFixed(4),
          agg.perClass.neutral.recall.toFixed(4),
          agg.perClass.neutral.f1.toFixed(4),
          agg.perClass.contradicted.precision.toFixed(4),
          agg.perClass.contradicted.recall.toFixed(4),
          agg.perClass.contradicted.f1.toFixed(4),
        ].join(',') + '\n',
      );
    }
  }

  console.log(`\n[bench-judge] summary written to ${summaryPath}`);
  console.log(`[bench-judge] detail written to ${detailPath}`);
}

main().catch(err => {
  console.error('[bench-judge] fatal:', err);
  process.exit(1);
});
