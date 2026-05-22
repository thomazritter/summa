/**
 * Empirical model selection benchmark: models × profiles × articles,
 * FineSurE 3-dim. Holds the prompt variant fixed (defaults to V0; override
 * with BENCH_VARIANT env var to use the prompt-benchmark winner) and varies
 * the Groq model id across the catalog exposed by AVAILABLE_MODELS.
 *
 * Output: scripts/benchmark_output/models_<ts>/ with results.csv,
 * per-run summary/finesure artifacts, and run.log.
 *
 * Usage (default uses V0; override with the prompt-benchmark winner):
 *   GROQ_API_KEY=... npx tsx packages/api/src/scripts/benchmark-models.ts
 *   GROQ_API_KEY=... BENCH_VARIANT=<winner> npx tsx packages/api/src/scripts/benchmark-models.ts
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import type { Profile, ArticleStructure } from '@summarizer/shared';
import { extractRawText, structureRawText } from '../services/pdfProcessor.js';
import { checkFactuality } from '../services/factualityChecker.js';
import { generateCompletion, AVAILABLE_MODELS } from '../services/groqClient.js';
import { generateForVariant, type VariantId, type LlmCall } from './promptVariants.js';

const safeGitRev = (): string => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: '/Users/thomazjusto/Documents/TCC/project/summarizer' }).toString().trim();
  } catch {
    return 'unknown';
  }
};
const safeGitDirty = (): string => {
  try {
    const out = execSync('git status --porcelain', { cwd: '/Users/thomazjusto/Documents/TCC/project/summarizer' }).toString().trim();
    return out.length > 0 ? 'dirty' : 'clean';
  } catch {
    return 'unknown';
  }
};

// ─── Config ────────────────────────────────────────────────────────
const PAPERS_DIR = '/Users/thomazjusto/Documents/TCC/papers_pdf';
const OUTPUT_BASE = '/Users/thomazjusto/Documents/TCC/project/summarizer/scripts/benchmark_output';

const VARIANT: VariantId = (process.env.BENCH_VARIANT as VariantId) || 'V0';

const ARTICLES: Array<{ id: string; file: string; title: string }> = [
  { id: 'vaswani', file: 'vaswani2017attention.pdf', title: 'Attention Is All You Need' },
  { id: 'bart',    file: 'lewis2020bart.pdf',         title: 'BART: Denoising Sequence-to-Sequence Pre-training for Natural Language Generation, Translation, and Comprehension' },
];

const PROFILES: Profile[] = [
  { id: 0, name: 'estudante_iniciante',       expertise: 'beginner',     focus: 'concepts',     depth: 'brief',         context: 'learning'     } as Profile,
  { id: 0, name: 'pleno_revisao_rapida',      expertise: 'intermediate', focus: 'applications', depth: 'brief',         context: 'quick_review' } as Profile,
  { id: 0, name: 'pleno_estudando',           expertise: 'intermediate', focus: 'all',          depth: 'moderate',      context: 'learning'     } as Profile,
  { id: 0, name: 'pesquisador_metodologia',   expertise: 'advanced',     focus: 'methodology',  depth: 'detailed',      context: 'research'     } as Profile,
  { id: 0, name: 'pesquisador_resultados',    expertise: 'advanced',     focus: 'results',      depth: 'detailed',      context: 'research'     } as Profile,
  { id: 0, name: 'especialista_revisao_par',  expertise: 'expert',       focus: 'all',          depth: 'comprehensive', context: 'research'     } as Profile,
];

const MODELS = AVAILABLE_MODELS.map((m) => ({ id: m.id, name: m.name }));

// Target word counts per depth (drives depth_adherence). Aligned with the
// numeric targets in promptVariants.DEPTH_TEXT.
const TARGET_DEPTH_WORDS: Record<Profile['depth'], number> = {
  brief: 100,
  moderate: 250,
  detailed: 500,
  comprehensive: 900,
};

const ANOMALY_CHAR_LIMIT = 15000;

// Strip Qwen-style chain-of-thought tags so reasoning models compare fairly.
const stripThinking = (raw: string): string => raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

// ─── Helpers ───────────────────────────────────────────────────────
const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const stddev = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const sep = (label: string): string => `\n${'━'.repeat(72)}\n  ${label}\n${'━'.repeat(72)}`;
const fmt = (n: number | null): string => (n === null ? ' n/a ' : n.toFixed(3));

interface BenchRow {
  model: string;
  model_name: string;
  article: string;
  profile: string;
  expertise: string;
  focus: string;
  depth: string;
  context: string;
  summary_chars: number;
  summary_words: number;
  target_words: number;
  depth_adherence: number;
  anomaly: boolean;
  faithfulness: number | null;
  completeness: number | null;
  conciseness: number | null;
  n_sentences: number;
  n_supported: number;
  n_neutral: number;
  n_contradicted: number;
  n_keyfacts: number;
  generation_ms: number;
  finesure_ms: number;
  total_ms: number;
  error: string;
}

async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputDir = path.join(OUTPUT_BASE, `models_${runId}`);
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(path.join(outputDir, 'summaries'), { recursive: true });
  mkdirSync(path.join(outputDir, 'finesure'), { recursive: true });

  const csvPath = path.join(outputDir, 'results.csv');
  const csvHeader =
    'model,model_name,article,profile,expertise,focus,depth,context,' +
    'summary_chars,summary_words,target_words,depth_adherence,anomaly,' +
    'faithfulness,completeness,conciseness,' +
    'n_sentences,n_supported,n_neutral,n_contradicted,n_keyfacts,' +
    'generation_ms,finesure_ms,total_ms,error\n';
  writeFileSync(csvPath, csvHeader);

  const logPath = path.join(outputDir, 'run.log');
  const log = (msg: string): void => {
    console.log(msg);
    appendFileSync(logPath, msg + '\n');
  };

  const totalRuns = MODELS.length * PROFILES.length * ARTICLES.length;
  const gitRev = safeGitRev();
  const gitDirty = safeGitDirty();
  const finesureModel = process.env.FINESURE_MODEL || 'llama-3.3-70b-versatile';
  log(`\n🚀 BENCHMARK MODELS — run ${runId}`);
  log(`Output:               ${outputDir}`);
  log(`Prompt variant fixed: ${VARIANT}  (override via BENCH_VARIANT)`);
  log(`FineSurE model:       ${finesureModel}  (override via FINESURE_MODEL)`);
  log(`Git commit:           ${gitRev} (${gitDirty})`);
  log(`Articles:             ${ARTICLES.map((a) => a.id).join(', ')}`);
  log(`Profiles:             ${PROFILES.map((p) => p.name).join(', ')}`);
  log(`Models:               ${MODELS.map((m) => m.id).join(', ')}`);
  log(`Total runs:           ${totalRuns}  (${MODELS.length} × ${PROFILES.length} × ${ARTICLES.length})`);

  const metadataPath = path.join(outputDir, 'run.meta.json');
  writeFileSync(metadataPath, JSON.stringify({
    runId,
    variant: VARIANT,
    finesureModel,
    gitRev,
    gitDirty,
    articles: ARTICLES.map((a) => a.id),
    profiles: PROFILES.map((p) => p.name),
    models: MODELS.map((m) => m.id),
    totalRuns,
  }, null, 2));

  // ─── Pré-carregar artigos ──────────────────────────────────────────
  log(sep('PRÉ-CARGA: extrair + estruturar artigos (1 vez por artigo)'));
  const articleCache: Record<string, { rawText: string; structure: ArticleStructure }> = {};
  for (const article of ARTICLES) {
    const fullPath = path.join(PAPERS_DIR, article.file);
    log(`\n📄 ${article.id} — ${article.file}`);
    const buf = readFileSync(fullPath);
    log(`   Binário: ${(buf.length / 1024).toFixed(1)} KB`);

    const tExtract = Date.now();
    const { rawText } = await extractRawText(buf);
    log(`   Extração:    ${rawText.length} chars / ${wordCount(rawText)} palavras  (${Date.now() - tExtract} ms)`);

    const tStruct = Date.now();
    const structure = await structureRawText(rawText);
    const abstractLen = structure.abstract?.length ?? 0;
    log(`   Estruturação: abstract ${abstractLen > 0 ? `✅ ${abstractLen} chars` : '❌ NÃO IDENTIFICADO'}  (${Date.now() - tStruct} ms)`);

    articleCache[article.id] = { rawText, structure };
  }

  // ─── Loop principal ────────────────────────────────────────────────
  log(sep(`LOOP DE GERAÇÕES (${totalRuns} total)`));
  log(`fmt: F=faithfulness  C=completeness  Co=conciseness  chars/words(target)  gen+finesure`);
  let idx = 0;
  const rows: BenchRow[] = [];

  for (const article of ARTICLES) {
    const { rawText, structure } = articleCache[article.id];
    for (const profile of PROFILES) {
      for (const model of MODELS) {
        idx++;
        const runKey = `${model.id.replace(/[^a-zA-Z0-9]/g, '_')}_${article.id}_${profile.name}`;
        const totalStart = Date.now();
        const wrappedLlm: LlmCall = async (prompt, opts) =>
          generateCompletion({ prompt, temperature: opts.temperature, maxTokens: opts.maxTokens, model: model.id });

        const targetWords = TARGET_DEPTH_WORDS[profile.depth];
        let row: BenchRow;
        try {
          const tGen = Date.now();
          const rawSummary = await generateForVariant(VARIANT, profile, structure, rawText, wrappedLlm);
          const summary = stripThinking(rawSummary);
          const genMs = Date.now() - tGen;
          writeFileSync(path.join(outputDir, 'summaries', `${runKey}.md`), summary);

          const tFact = Date.now();
          const fact = await checkFactuality(summary, structure, rawText);
          const factMs = Date.now() - tFact;
          writeFileSync(path.join(outputDir, 'finesure', `${runKey}.json`), JSON.stringify(fact, null, 2));

          const words = wordCount(summary);
          const supported = fact.results.filter((r) => r.label === 'supported').length;
          const neutral = fact.results.filter((r) => r.label === 'neutral').length;
          const contradicted = fact.results.filter((r) => r.label === 'contradicted').length;

          row = {
            model: model.id,
            model_name: model.name,
            article: article.id,
            profile: profile.name,
            expertise: profile.expertise,
            focus: profile.focus,
            depth: profile.depth,
            context: profile.context,
            summary_chars: summary.length,
            summary_words: words,
            target_words: targetWords,
            depth_adherence: Number((words / targetWords).toFixed(3)),
            anomaly: summary.length > ANOMALY_CHAR_LIMIT,
            faithfulness: fact.score,
            completeness: fact.completeness,
            conciseness: fact.conciseness,
            n_sentences: fact.results.length,
            n_supported: supported,
            n_neutral: neutral,
            n_contradicted: contradicted,
            n_keyfacts: fact.keyfacts.length,
            generation_ms: genMs,
            finesure_ms: factMs,
            total_ms: Date.now() - totalStart,
            error: '',
          };

          log(
            `[${String(idx).padStart(2)}/${totalRuns}] ${model.name.padEnd(20)} × ${article.id.padEnd(15)} × ${profile.name.padEnd(28)}  ` +
              `F=${fmt(fact.score)} C=${fmt(fact.completeness)} Co=${fmt(fact.conciseness)}  ` +
              `${summary.length}c/${words}w(t${targetWords})  ${(genMs / 1000).toFixed(1)}s+${(factMs / 1000).toFixed(1)}s` +
              `${summary.length > ANOMALY_CHAR_LIMIT ? '  ⚠️ ANOMALY' : ''}`,
          );
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          row = {
            model: model.id,
            model_name: model.name,
            article: article.id,
            profile: profile.name,
            expertise: profile.expertise,
            focus: profile.focus,
            depth: profile.depth,
            context: profile.context,
            summary_chars: 0,
            summary_words: 0,
            target_words: targetWords,
            depth_adherence: 0,
            anomaly: false,
            faithfulness: null,
            completeness: null,
            conciseness: null,
            n_sentences: 0,
            n_supported: 0,
            n_neutral: 0,
            n_contradicted: 0,
            n_keyfacts: 0,
            generation_ms: 0,
            finesure_ms: 0,
            total_ms: Date.now() - totalStart,
            error: errMsg,
          };
          log(`[${String(idx).padStart(2)}/${totalRuns}] ${model.name.padEnd(20)} × ${article.id.padEnd(15)} × ${profile.name.padEnd(28)}  ❌ ${errMsg.slice(0, 60)}`);
        }

        rows.push(row);
        const csvRow = [
          JSON.stringify(row.model),
          JSON.stringify(row.model_name),
          row.article,
          row.profile,
          row.expertise,
          row.focus,
          row.depth,
          row.context,
          row.summary_chars,
          row.summary_words,
          row.target_words,
          row.depth_adherence,
          row.anomaly ? 'true' : 'false',
          row.faithfulness ?? '',
          row.completeness ?? '',
          row.conciseness ?? '',
          row.n_sentences,
          row.n_supported,
          row.n_neutral,
          row.n_contradicted,
          row.n_keyfacts,
          row.generation_ms,
          row.finesure_ms,
          row.total_ms,
          row.error ? JSON.stringify(row.error) : '',
        ].join(',');
        appendFileSync(csvPath, csvRow + '\n');
      }
    }
  }

  // ─── Agregados por modelo ──────────────────────────────────────────
  log(sep('AGREGADOS POR MODELO'));
  for (const model of MODELS) {
    const valid = rows.filter((r) => r.model === model.id && !r.error && r.faithfulness !== null);
    if (valid.length === 0) {
      log(`  ${model.name}: nenhum run válido`);
      continue;
    }
    const faiths = valid.map((r) => r.faithfulness as number);
    const f = mean(faiths);
    const fStd = stddev(faiths);
    const cVals = valid.filter((r) => r.completeness !== null).map((r) => r.completeness as number);
    const coVals = valid.filter((r) => r.conciseness !== null).map((r) => r.conciseness as number);
    const c = cVals.length ? mean(cVals) : null;
    const co = coVals.length ? mean(coVals) : null;
    const adher = mean(valid.map((r) => r.depth_adherence));
    const lat = mean(valid.map((r) => r.generation_ms)) / 1000;
    const anomalies = valid.filter((r) => r.anomaly).length;
    log(`  ${model.name.padEnd(22)}  F=${f.toFixed(3)}±${fStd.toFixed(3)}  C=${fmt(c)}  Co=${fmt(co)}  adher=${adher.toFixed(2)}  ${lat.toFixed(1)}s  (n=${valid.length}, anom=${anomalies})`);
  }

  log(`\n✅ BENCHMARK CONCLUÍDO`);
  log(`Run ID: ${runId}`);
  log(`CSV:    ${csvPath}`);
  log(`Log:    ${logPath}`);
  log(`Dir:    ${outputDir}`);
}

main().catch((e) => {
  console.error('\n❌ BENCHMARK FALHOU:', e);
  process.exit(1);
});
