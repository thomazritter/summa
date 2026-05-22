/**
 * FineSurE 4×2 grid — standalone (no DB).
 *
 * Reproduces the matrix reported in Apêndice G of the TCC: 4 reader profiles
 * × 2 articles (Vaswani Transformer, Khurana Personalized Medicine) using the
 * production config (V2 XML prompt + Llama 4 Scout 17B for generation,
 * Llama 3.3 70B for FineSurE verification).
 *
 * Output: scripts/benchmark_output/matrix_<ts>/ with results.csv,
 * per-cell summary/finesure artifacts, and run.log.
 *
 * Usage:
 *   GROQ_API_KEY=... npx tsx packages/api/src/scripts/finesure-matrix.ts
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import type { Profile, ArticleStructure } from '@summarizer/shared';
import { extractRawText, structureRawText } from '../services/pdfProcessor.js';
import { checkFactuality } from '../services/factualityChecker.js';
import { generateCompletion, getActiveModel } from '../services/groqClient.js';
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

const PAPERS_DIR = '/Users/thomazjusto/Documents/TCC/papers_pdf';
const OUTPUT_BASE = '/Users/thomazjusto/Documents/TCC/project/summarizer/scripts/benchmark_output';

const VARIANT: VariantId = (process.env.BENCH_VARIANT as VariantId) || 'V2';

const ARTICLES: Array<{ id: string; file: string; label: string }> = [
  { id: 'vaswani',  file: 'vaswani2017attention.pdf',     label: 'Vaswani Transformer' },
  { id: 'khurana',  file: 'khurana2025personalized.pdf',  label: 'Khurana Personalized Medicine' },
];

const PROFILES: Array<Profile & { label: string }> = [
  { id: 0, name: 'estudante_grad',    label: 'Estudante grad',    expertise: 'beginner',     focus: 'concepts',     depth: 'brief',         context: 'learning'  } as Profile & { label: string },
  { id: 0, name: 'mestrando',         label: 'Mestrando',         expertise: 'intermediate', focus: 'all',          depth: 'moderate',      context: 'learning'  } as Profile & { label: string },
  { id: 0, name: 'pesquisador',       label: 'Pesquisador',       expertise: 'advanced',     focus: 'methodology',  depth: 'detailed',      context: 'research'  } as Profile & { label: string },
  { id: 0, name: 'revisor_par',       label: 'Revisor par',       expertise: 'expert',       focus: 'all',          depth: 'comprehensive', context: 'research'  } as Profile & { label: string },
];

const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;
const sep = (label: string): string => `\n${'━'.repeat(72)}\n  ${label}\n${'━'.repeat(72)}`;
const fmt = (n: number | null): string => (n === null ? ' n/a ' : n.toFixed(3));
const stripThinking = (raw: string): string => raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

interface BenchRow {
  article: string;
  article_label: string;
  profile: string;
  profile_label: string;
  expertise: string;
  focus: string;
  depth: string;
  context: string;
  summary_chars: number;
  summary_words: number;
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
  const outputDir = path.join(OUTPUT_BASE, `matrix_${runId}`);
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(path.join(outputDir, 'summaries'), { recursive: true });
  mkdirSync(path.join(outputDir, 'finesure'), { recursive: true });

  const csvPath = path.join(outputDir, 'results.csv');
  const csvHeader =
    'article,article_label,profile,profile_label,expertise,focus,depth,context,' +
    'summary_chars,summary_words,faithfulness,completeness,conciseness,' +
    'n_sentences,n_supported,n_neutral,n_contradicted,n_keyfacts,' +
    'generation_ms,finesure_ms,total_ms,error\n';
  writeFileSync(csvPath, csvHeader);

  const logPath = path.join(outputDir, 'run.log');
  const log = (msg: string): void => {
    console.log(msg);
    appendFileSync(logPath, msg + '\n');
  };

  const totalRuns = ARTICLES.length * PROFILES.length;
  const generationModel = getActiveModel();
  const gitRev = safeGitRev();
  const gitDirty = safeGitDirty();
  const finesureModel = process.env.FINESURE_MODEL || 'llama-3.3-70b-versatile';

  log(`\n🚀 FINESURE MATRIX 4×2 — run ${runId}`);
  log(`Output:           ${outputDir}`);
  log(`Generation model: ${generationModel}  (override via GROQ_MODEL)`);
  log(`Prompt variant:   ${VARIANT}  (override via BENCH_VARIANT)`);
  log(`FineSurE model:   ${finesureModel}  (override via FINESURE_MODEL)`);
  log(`Git commit:       ${gitRev} (${gitDirty})`);
  log(`Articles:         ${ARTICLES.map((a) => a.label).join(', ')}`);
  log(`Profiles:         ${PROFILES.map((p) => p.label).join(', ')}`);
  log(`Total cells:      ${totalRuns}  (${ARTICLES.length} × ${PROFILES.length})`);

  const metadataPath = path.join(outputDir, 'run.meta.json');
  writeFileSync(metadataPath, JSON.stringify({
    runId,
    generationModel,
    variant: VARIANT,
    finesureModel,
    gitRev,
    gitDirty,
    articles: ARTICLES.map((a) => ({ id: a.id, label: a.label, file: a.file })),
    profiles: PROFILES.map((p) => ({ name: p.name, label: p.label, expertise: p.expertise, focus: p.focus, depth: p.depth, context: p.context })),
    totalRuns,
  }, null, 2));

  log(sep('PRÉ-CARGA: extrair + estruturar artigos'));
  const articleCache: Record<string, { rawText: string; structure: ArticleStructure }> = {};
  for (const article of ARTICLES) {
    const fullPath = path.join(PAPERS_DIR, article.file);
    log(`\n📄 ${article.label} — ${article.file}`);
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

  log(sep(`LOOP DA MATRIZ (${totalRuns} cells)`));
  let idx = 0;
  const rows: BenchRow[] = [];

  for (const article of ARTICLES) {
    const { rawText, structure } = articleCache[article.id];
    for (const profile of PROFILES) {
      idx++;
      const runKey = `${article.id}_${profile.name}`;
      const totalStart = Date.now();
      const wrappedLlm: LlmCall = async (prompt, opts) =>
        generateCompletion({ prompt, temperature: opts.temperature, maxTokens: opts.maxTokens });

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

        const supported = fact.results.filter((r) => r.label === 'supported').length;
        const neutral = fact.results.filter((r) => r.label === 'neutral').length;
        const contradicted = fact.results.filter((r) => r.label === 'contradicted').length;

        row = {
          article: article.id,
          article_label: article.label,
          profile: profile.name,
          profile_label: profile.label,
          expertise: profile.expertise,
          focus: profile.focus,
          depth: profile.depth,
          context: profile.context,
          summary_chars: summary.length,
          summary_words: wordCount(summary),
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
          `[${String(idx).padStart(1)}/${totalRuns}] ${profile.label.padEnd(16)} × ${article.label.padEnd(30)}  ` +
            `F=${fmt(fact.score)} C=${fmt(fact.completeness)} Co=${fmt(fact.conciseness)}  ` +
            `${summary.length}c/${wordCount(summary)}w  ${(genMs / 1000).toFixed(1)}s+${(factMs / 1000).toFixed(1)}s`,
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        row = {
          article: article.id,
          article_label: article.label,
          profile: profile.name,
          profile_label: profile.label,
          expertise: profile.expertise,
          focus: profile.focus,
          depth: profile.depth,
          context: profile.context,
          summary_chars: 0,
          summary_words: 0,
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
        log(`[${String(idx)}/${totalRuns}] ${profile.label} × ${article.label}  ❌ ${errMsg.slice(0, 60)}`);
      }

      rows.push(row);
      const csvRow = [
        row.article,
        JSON.stringify(row.article_label),
        row.profile,
        JSON.stringify(row.profile_label),
        row.expertise,
        row.focus,
        row.depth,
        row.context,
        row.summary_chars,
        row.summary_words,
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

  log(sep('AGREGADOS POR PERFIL (média sobre 2 artigos)'));
  for (const profile of PROFILES) {
    const valid = rows.filter((r) => r.profile === profile.name && !r.error && r.faithfulness !== null);
    if (valid.length === 0) {
      log(`  ${profile.label}: nenhum run válido`);
      continue;
    }
    const f = valid.reduce((a, r) => a + (r.faithfulness ?? 0), 0) / valid.length;
    const c = valid.reduce((a, r) => a + (r.completeness ?? 0), 0) / valid.length;
    const co = valid.reduce((a, r) => a + (r.conciseness ?? 0), 0) / valid.length;
    log(`  ${profile.label.padEnd(16)}  F=${f.toFixed(3)}  C=${c.toFixed(3)}  Co=${co.toFixed(3)}  (n=${valid.length})`);
  }

  log(sep('AGREGADOS GERAIS'));
  const all = rows.filter((r) => !r.error && r.faithfulness !== null);
  if (all.length > 0) {
    const f = all.reduce((a, r) => a + (r.faithfulness ?? 0), 0) / all.length;
    const c = all.reduce((a, r) => a + (r.completeness ?? 0), 0) / all.length;
    const co = all.reduce((a, r) => a + (r.conciseness ?? 0), 0) / all.length;
    log(`  Média geral:  F=${f.toFixed(3)}  C=${c.toFixed(3)}  Co=${co.toFixed(3)}  (n=${all.length})`);
  }

  log(`\n✅ MATRIX CONCLUÍDA`);
  log(`Run ID: ${runId}`);
  log(`CSV:    ${csvPath}`);
  log(`Log:    ${logPath}`);
  log(`Dir:    ${outputDir}`);
}

main().catch((e) => {
  console.error('\n❌ MATRIX FALHOU:', e);
  process.exit(1);
});
