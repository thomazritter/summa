/**
 * Empirical ablation: prompt variants × profiles × articles, FineSurE 3-dim.
 *
 * Runs locally against PDFs in papers_pdf/. No production database, no
 * Railway endpoints — only Groq for LLM calls. Captures faithfulness,
 * completeness, and conciseness per generation (Eq. 1, 2a, 2b of
 * Song et al. 2024). Output: scripts/benchmark_output/prompts_<ts>/
 * with results.csv + per-run summary/finesure artifacts + run.log.
 *
 * Usage:
 *   GROQ_API_KEY=... npx tsx packages/api/src/scripts/benchmark-prompts.ts
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import type { Profile, ArticleStructure } from '@summarizer/shared';
import { extractRawText, structureRawText } from '../services/pdfProcessor.js';
import { checkFactuality } from '../services/factualityChecker.js';
import { generateCompletion } from '../services/groqClient.js';
import { generateForVariant, VARIANT_LABELS, type VariantId } from './promptVariants.js';

// ─── Config ────────────────────────────────────────────────────────
const PAPERS_DIR = '/Users/thomazjusto/Documents/TCC/papers_pdf';
const OUTPUT_BASE = '/Users/thomazjusto/Documents/TCC/project/summarizer/scripts/benchmark_output';

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

const VARIANTS: VariantId[] = ['V0', 'V1', 'V2', 'V3', 'V4'];

// ─── Helpers ───────────────────────────────────────────────────────
const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const sep = (label: string): string => `\n${'━'.repeat(72)}\n  ${label}\n${'━'.repeat(72)}`;
const fmt = (n: number | null): string => (n === null ? ' n/a ' : n.toFixed(3));

interface BenchRow {
  variant: VariantId;
  article: string;
  profile: string;
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
  const outputDir = path.join(OUTPUT_BASE, `prompts_${runId}`);
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(path.join(outputDir, 'summaries'), { recursive: true });
  mkdirSync(path.join(outputDir, 'finesure'), { recursive: true });

  const csvPath = path.join(outputDir, 'results.csv');
  const csvHeader =
    'variant,article,profile,expertise,focus,depth,context,' +
    'summary_chars,summary_words,faithfulness,completeness,conciseness,' +
    'n_sentences,n_supported,n_neutral,n_contradicted,n_keyfacts,' +
    'generation_ms,finesure_ms,total_ms,error\n';
  writeFileSync(csvPath, csvHeader);

  const logPath = path.join(outputDir, 'run.log');
  const log = (msg: string): void => {
    console.log(msg);
    appendFileSync(logPath, msg + '\n');
  };

  const totalRuns = VARIANTS.length * PROFILES.length * ARTICLES.length;
  log(`\n🚀 BENCHMARK PROMPTS — run ${runId}`);
  log(`Output: ${outputDir}`);
  log(`Articles: ${ARTICLES.map((a) => a.id).join(', ')}`);
  log(`Profiles: ${PROFILES.map((p) => p.name).join(', ')}`);
  log(`Variants: ${VARIANTS.join(', ')}`);
  log(`Total runs: ${totalRuns}  (${VARIANTS.length} × ${PROFILES.length} × ${ARTICLES.length})`);

  // ─── Pré-carregar artigos (extract + structure) ────────────────────
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
  log(`fmt: F=faithfulness  C=completeness  Co=conciseness  chars/words  gen+finesure`);
  let idx = 0;
  const rows: BenchRow[] = [];

  for (const article of ARTICLES) {
    const { rawText, structure } = articleCache[article.id];
    for (const profile of PROFILES) {
      for (const variant of VARIANTS) {
        idx++;
        const runKey = `${variant}_${article.id}_${profile.name}`;
        const totalStart = Date.now();
        const wrappedLlm = async (prompt: string, opts: { temperature: number; maxTokens: number }) =>
          generateCompletion({ prompt, temperature: opts.temperature, maxTokens: opts.maxTokens });

        let row: BenchRow;
        try {
          const tGen = Date.now();
          const summary = await generateForVariant(variant, profile, structure, rawText, wrappedLlm);
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
            variant,
            article: article.id,
            profile: profile.name,
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
            `[${String(idx).padStart(2)}/${totalRuns}] ${variant.padEnd(3)} × ${article.id.padEnd(15)} × ${profile.name.padEnd(28)}  ` +
              `F=${fmt(fact.score)} C=${fmt(fact.completeness)} Co=${fmt(fact.conciseness)}  ` +
              `${summary.length}c/${wordCount(summary)}w  ${(genMs / 1000).toFixed(1)}s+${(factMs / 1000).toFixed(1)}s`,
          );
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          row = {
            variant,
            article: article.id,
            profile: profile.name,
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
          log(`[${String(idx).padStart(2)}/${totalRuns}] ${variant.padEnd(3)} × ${article.id.padEnd(15)} × ${profile.name.padEnd(28)}  ❌ ${errMsg.slice(0, 60)}`);
        }

        rows.push(row);
        const csvRow = [
          row.variant,
          row.article,
          row.profile,
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
  }

  // ─── Agregados ──────────────────────────────────────────────────────
  log(sep('AGREGADOS POR VARIANTE'));
  for (const variant of VARIANTS) {
    const valid = rows.filter((r) => r.variant === variant && !r.error && r.faithfulness !== null);
    if (valid.length === 0) {
      log(`  ${variant}: nenhum run válido`);
      continue;
    }
    const f = mean(valid.map((r) => r.faithfulness as number));
    const cVals = valid.filter((r) => r.completeness !== null).map((r) => r.completeness as number);
    const coVals = valid.filter((r) => r.conciseness !== null).map((r) => r.conciseness as number);
    const c = cVals.length ? mean(cVals) : null;
    const co = coVals.length ? mean(coVals) : null;
    const words = mean(valid.map((r) => r.summary_words));
    const lat = mean(valid.map((r) => r.generation_ms)) / 1000;
    log(`  ${variant} (${VARIANT_LABELS[variant]}):`);
    log(`     F=${f.toFixed(3)}  C=${fmt(c)}  Co=${fmt(co)}  palavras=${words.toFixed(0)}  geração=${lat.toFixed(1)}s  (n=${valid.length})`);
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
