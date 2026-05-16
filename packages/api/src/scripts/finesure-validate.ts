/**
 * FineSurE fidelity validation against FRANK + REALSumm.
 *
 * Runs the local FineSurE pipeline (factualityChecker.ts → finesure-prompts/*) on
 * the official upstream samples and compares predictions against human ground
 * truth, computing balanced accuracy (bACC) per the paper's Eq. (3).
 *
 * Usage:
 *   tsx src/scripts/finesure-validate.ts                    # both datasets, 10 items each
 *   tsx src/scripts/finesure-validate.ts frank   --limit 50
 *   tsx src/scripts/finesure-validate.ts realsumm --limit 20
 *
 * Dataset paths default to the cloned upstream repo at /tmp/FineSurE-ACL24/.
 *
 * Reference numbers (Song et al. 2024, arXiv:2407.00908v3):
 *   - FRANK bACC with Llama 3-70B-Inst basic prompt (Tab. 11): 92.9%
 *   - FRANK bACC with Inst + Cat + Rea (our prompt, Tab. 11):  92.0%
 *   - REALSumm completeness alignment with GPT-4 (Tab. 1):     B-ACC 93.3%
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { checkFaithfulness, alignKeyfacts } from '../services/factualityChecker.js';

interface FrankItem {
  doc_id: string;
  source: string;
  model: string;
  transcript: string;
  reference: string;
  sentences: string[];
  raw_annotations: Record<string, { factuality_labels: number[]; factuality_types: string[] }>;
}

interface RealsummItem {
  doc_id: string;
  source: string;
  model: string;
  transcript: string;
  reference: string;
  sentences: string[];
  raw_annotations: Record<string, { key_fact_labels: number[]; sentence_labels: number[] }>;
}

interface KeyfactItem {
  doc_id: string;
  transcript: string;
  reference: string;
  key_facts: string[];
}

const FRANK_PATH = process.env.FRANK_DATA ?? '/tmp/FineSurE-ACL24/dataset/frank/frank-data-sample-10.json';
const REALSUMM_PATH = process.env.REALSUMM_DATA ?? '/tmp/FineSurE-ACL24/dataset/realsumm/realsumm-data-sample-10.json';
const KEYFACTS_PATH = process.env.REALSUMM_KEYFACTS ?? '/tmp/FineSurE-ACL24/dataset/realsumm/human-keyfact-list.json';
const OUT_DIR = resolve(process.cwd(), 'scripts/results');

const readJsonl = <T>(path: string): T[] => {
  const content = readFileSync(path, 'utf-8');
  return content
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
};

const majorityVote = (perAnnotator: Record<string, number[]>): number[] => {
  const annotators = Object.values(perAnnotator);
  if (annotators.length === 0) return [];
  const length = annotators[0].length;
  const result: number[] = [];
  for (let i = 0; i < length; i++) {
    const votes = annotators.map((a) => a[i] ?? 0);
    const ones = votes.filter((v) => v === 1).length;
    result.push(ones > votes.length / 2 ? 1 : 0);
  }
  return result;
};

interface AccuracyMetrics {
  bACC: number;
  sensitivity: number;
  specificity: number;
  accuracy: number;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  n: number;
}

const computeMetrics = (pred: number[], gt: number[]): AccuracyMetrics => {
  if (pred.length !== gt.length) {
    throw new Error(`Length mismatch: pred=${pred.length} gt=${gt.length}`);
  }
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  for (let i = 0; i < gt.length; i++) {
    if (gt[i] === 1 && pred[i] === 1) tp += 1;
    else if (gt[i] === 1 && pred[i] === 0) fn += 1;
    else if (gt[i] === 0 && pred[i] === 1) fp += 1;
    else tn += 1;
  }
  const sensitivity = tp + fn > 0 ? tp / (tp + fn) : 0;
  const specificity = tn + fp > 0 ? tn / (tn + fp) : 0;
  const accuracy = pred.length > 0 ? (tp + tn) / pred.length : 0;
  return {
    bACC: (sensitivity + specificity) / 2,
    sensitivity,
    specificity,
    accuracy,
    tp,
    tn,
    fp,
    fn,
    n: pred.length,
  };
};

const writeCsv = (path: string, header: string, rows: string[]): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${header}\n${rows.join('\n')}\n`, 'utf-8');
};

const validateFrank = async (limit: number, items: FrankItem[]): Promise<void> => {
  console.log(`\n--- FRANK faithfulness validation (n=${items.length}, limit=${limit}) ---`);
  const allPred: number[] = [];
  const allGt: number[] = [];
  const rows: string[] = [];

  for (const [i, item] of items.entries()) {
    const tag = `[${i + 1}/${items.length}] ${item.doc_id.slice(0, 10)} (${item.model})`;
    console.log(`${tag} sentences=${item.sentences.length} transcript=${item.transcript.length}ch`);

    const gtPerAnnotator: Record<string, number[]> = {};
    for (const [annotator, ann] of Object.entries(item.raw_annotations)) {
      gtPerAnnotator[annotator] = ann.factuality_labels;
    }
    const gtLabels = majorityVote(gtPerAnnotator);

    try {
      const result = await checkFaithfulness(item.sentences, item.transcript);
      const n = Math.min(gtLabels.length, result.predLabels.length);
      for (let j = 0; j < n; j++) {
        allPred.push(result.predLabels[j]);
        allGt.push(gtLabels[j]);
        rows.push([
          item.doc_id,
          item.model,
          j,
          gtLabels[j],
          result.predLabels[j],
          `"${(result.predTypes[j] ?? '').replace(/"/g, '""')}"`,
        ].join(','));
      }
      if (result.predLabels.length !== gtLabels.length) {
        console.warn(`  length mismatch: pred=${result.predLabels.length} gt=${gtLabels.length}`);
      }
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : err}`);
    }
  }

  const metrics = computeMetrics(allPred, allGt);
  console.log('\n--- FRANK results ---');
  console.log(
    `  bACC=${(metrics.bACC * 100).toFixed(2)}%  sens=${(metrics.sensitivity * 100).toFixed(2)}%  spec=${(metrics.specificity * 100).toFixed(2)}%  acc=${(metrics.accuracy * 100).toFixed(2)}%`,
  );
  console.log(`  TP=${metrics.tp} TN=${metrics.tn} FP=${metrics.fp} FN=${metrics.fn}  N=${metrics.n}`);
  console.log(`  Paper Llama 3-70B-Inst Cat+Rea target (Tab. 11): bACC ≈ 92.0%`);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const out = `${OUT_DIR}/finesure-validate-frank-${ts}.csv`;
  writeCsv(out, 'doc_id,model,sentence_idx,gt_label,pred_label,pred_type', rows);
  console.log(`  CSV: ${out}`);
};

const validateRealsumm = async (
  limit: number,
  items: RealsummItem[],
  keyfactsByDoc: Map<string, string[]>,
): Promise<void> => {
  console.log(`\n--- REALSumm completeness + conciseness validation (n=${items.length}, limit=${limit}) ---`);
  const compPred: number[] = [];
  const compGt: number[] = [];
  const concPred: number[] = [];
  const concGt: number[] = [];
  const rows: string[] = [];

  for (const [i, item] of items.entries()) {
    const keyfacts = keyfactsByDoc.get(item.doc_id);
    if (!keyfacts) {
      console.log(`[${i + 1}/${items.length}] ${item.doc_id} — no human keyfacts available, skipping`);
      continue;
    }
    const tag = `[${i + 1}/${items.length}] ${item.doc_id} (${item.model})`;
    console.log(`${tag} sentences=${item.sentences.length} keyfacts=${keyfacts.length}`);

    const gtKfPerAnn: Record<string, number[]> = {};
    const gtSentPerAnn: Record<string, number[]> = {};
    for (const [annotator, ann] of Object.entries(item.raw_annotations)) {
      gtKfPerAnn[annotator] = ann.key_fact_labels;
      gtSentPerAnn[annotator] = ann.sentence_labels;
    }
    const gtKf = majorityVote(gtKfPerAnn);
    const gtSent = majorityVote(gtSentPerAnn);

    try {
      const align = await alignKeyfacts(keyfacts, item.sentences);
      const predKf = align.predLabels;
      const predSent = item.sentences.map((_, idx) => (align.matchedLines.includes(idx + 1) ? 1 : 0));

      const kfN = Math.min(gtKf.length, predKf.length);
      for (let j = 0; j < kfN; j++) {
        compPred.push(predKf[j]);
        compGt.push(gtKf[j]);
        rows.push([item.doc_id, item.model, 'keyfact', j, gtKf[j], predKf[j]].join(','));
      }
      const sentN = Math.min(gtSent.length, predSent.length);
      for (let j = 0; j < sentN; j++) {
        concPred.push(predSent[j]);
        concGt.push(gtSent[j]);
        rows.push([item.doc_id, item.model, 'sentence', j, gtSent[j], predSent[j]].join(','));
      }
      if (predKf.length !== gtKf.length) {
        console.warn(`  keyfact length mismatch: pred=${predKf.length} gt=${gtKf.length}`);
      }
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (compPred.length > 0) {
    const compMetrics = computeMetrics(compPred, compGt);
    console.log('\n--- REALSumm completeness (keyfact alignment) ---');
    console.log(
      `  bACC=${(compMetrics.bACC * 100).toFixed(2)}%  sens=${(compMetrics.sensitivity * 100).toFixed(2)}%  spec=${(compMetrics.specificity * 100).toFixed(2)}%`,
    );
    console.log(`  TP=${compMetrics.tp} TN=${compMetrics.tn} FP=${compMetrics.fp} FN=${compMetrics.fn}  N=${compMetrics.n}`);
  }
  if (concPred.length > 0) {
    const concMetrics = computeMetrics(concPred, concGt);
    console.log('\n--- REALSumm conciseness (sentence alignment) ---');
    console.log(
      `  bACC=${(concMetrics.bACC * 100).toFixed(2)}%  sens=${(concMetrics.sensitivity * 100).toFixed(2)}%  spec=${(concMetrics.specificity * 100).toFixed(2)}%`,
    );
    console.log(`  TP=${concMetrics.tp} TN=${concMetrics.tn} FP=${concMetrics.fp} FN=${concMetrics.fn}  N=${concMetrics.n}`);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const out = `${OUT_DIR}/finesure-validate-realsumm-${ts}.csv`;
  writeCsv(out, 'doc_id,model,level,index,gt_label,pred_label', rows);
  console.log(`  CSV: ${out}`);
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const dataset = args.find((a) => !a.startsWith('--')) ?? 'both';
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : 10;

  if (!process.env.GROQ_API_KEY) {
    console.error('GROQ_API_KEY not set; aborting.');
    process.exit(1);
  }

  console.log(`FineSurE validation — dataset=${dataset} limit=${limit}`);
  console.log(`Backbone: ${process.env.FINESURE_MODEL ?? 'llama-3.3-70b-versatile (default)'}`);

  if (dataset === 'frank' || dataset === 'both') {
    const frankItems = readJsonl<FrankItem>(FRANK_PATH).slice(0, limit);
    await validateFrank(limit, frankItems);
  }
  if (dataset === 'realsumm' || dataset === 'both') {
    const realsummItems = readJsonl<RealsummItem>(REALSUMM_PATH).slice(0, limit);
    const keyfactsAll = readJsonl<KeyfactItem>(KEYFACTS_PATH);
    const keyfactsByDoc = new Map<string, string[]>();
    for (const k of keyfactsAll) keyfactsByDoc.set(k.doc_id, k.key_facts);
    await validateRealsumm(limit, realsummItems, keyfactsByDoc);
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
