/**
 * FineSurE injection sensitivity test — standalone (no DB).
 *
 * Reproduces the test reported in Apêndice E of the TCC. Generates a clean
 * baseline summary (Bornmann × Mestrando, V2 XML prompt, Llama 4 Scout 17B),
 * then appends 8 hand-crafted false sentences — one per FineSurE error category
 * (entity/predicate/circumstantial/grammatical/coreference/linking/out-of-context/other).
 * Runs checkFactuality on the tainted summary and reports how many injections
 * were caught and whether the category labels match.
 *
 * Output: scripts/benchmark_output/injection_<ts>/ with results.json,
 * tainted_summary.md, original_summary.md, finesure.json, run.log.
 *
 * Usage:
 *   GROQ_API_KEY=... npx tsx packages/api/src/scripts/finesure-injection.ts
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

// Bornmann × Mestrando — reused verbatim from scripts_archive/finesure-injection-test.ts.
const ARTICLE_FILE = 'bornmann2021growth.pdf';
const PROFILE: Profile = {
  id: 0,
  name: 'mestrando',
  expertise: 'intermediate',
  focus: 'all',
  depth: 'moderate',
  context: 'learning',
} as Profile;

/**
 * 8 hand-crafted injections, one per FineSurE error category. Sentences are
 * written in the same prose style as the original summary so the LLM cannot
 * distinguish them by surface signal. Verbatim from the original archived
 * script (scripts_archive/finesure-injection-test.ts).
 */
const INJECTIONS: Array<{ expected: string; sentence: string; rationale: string }> = [
  {
    expected: 'entity error',
    sentence: 'A pesquisa utiliza dados das bases PubMed, Scopus, ArXiv e Dimensions para reconstruir o histórico de publicações.',
    rationale: 'As 4 bases reais são Web of Science, Scopus, Microsoft Academic e Dimensions — PubMed e ArXiv não estão entre elas.',
  },
  {
    expected: 'predicate error',
    sentence: 'Os autores demonstram que a taxa de crescimento da ciência diminuiu de forma consistente ao longo do século XX.',
    rationale: 'O paper documenta crescimento (não diminuição) — verbo invertido.',
  },
  {
    expected: 'circumstantial error',
    sentence: 'O tempo de duplicação da produção científica encontrado pelos autores é de 27,3 anos, correspondendo a uma taxa anual de 2,54%.',
    rationale: 'Números reais: 17,3 anos e 4,10% — circunstanciais (quantidades) errados.',
  },
  {
    expected: 'grammatical error',
    sentence: 'Os modelo de regressão que aplicado pelos autores capturam variações em as taxa de crescimento ao longo de séculos.',
    rationale: 'Concordância grosseira: "Os modelo", "que aplicado", "em as taxa".',
  },
  {
    expected: 'coreference error',
    sentence: 'Bornmann e Haunschild colaboraram com Mutz no desenvolvimento original das quatro bases de dados; ele é o autor principal do trabalho.',
    rationale: 'Pronome "ele" sem antecedente claro — pode referir Haunschild ou Mutz; também claim falso de "desenvolveram as bases".',
  },
  {
    expected: 'linking error',
    sentence: 'O período pós-guerra apresenta a menor taxa de crescimento dentre os segmentos, em decorrência direta da crise econômica de 2008.',
    rationale: 'Linkagem causal e temporal errada: pós-guerra tem a maior taxa; crise de 2008 não é mencionada como causa.',
  },
  {
    expected: 'out-of-context error',
    sentence: 'O estudo identifica que a inteligência artificial generativa será responsável por dobrar a produção científica global até 2030.',
    rationale: 'Conteúdo inexistente no artigo — IA generativa e projeção até 2030 não são tópicos do paper.',
  },
  {
    expected: 'other error',
    sentence: 'Com base em suas descobertas, os autores propõem que o financiamento público à ciência deve ser triplicado para sustentar as taxas de crescimento observadas.',
    rationale: 'O paper é descritivo (mede crescimento), não prescritivo (não propõe política de financiamento).',
  },
];

const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;
const stripThinking = (raw: string): string => raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
const sep = (label: string): string => `\n${'─'.repeat(72)}\n  ${label}\n${'─'.repeat(72)}`;

async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputDir = path.join(OUTPUT_BASE, `injection_${runId}`);
  mkdirSync(outputDir, { recursive: true });

  const logPath = path.join(outputDir, 'run.log');
  const log = (msg: string): void => {
    console.log(msg);
    appendFileSync(logPath, msg + '\n');
  };

  const generationModel = getActiveModel();
  const gitRev = safeGitRev();
  const gitDirty = safeGitDirty();
  const finesureModel = process.env.FINESURE_MODEL || 'llama-3.3-70b-versatile';

  log(`\n🚀 FINESURE INJECTION TEST — run ${runId}`);
  log(`Output:           ${outputDir}`);
  log(`Generation model: ${generationModel}  (override via GROQ_MODEL)`);
  log(`Prompt variant:   ${VARIANT}  (override via BENCH_VARIANT)`);
  log(`FineSurE model:   ${finesureModel}  (override via FINESURE_MODEL)`);
  log(`Git commit:       ${gitRev} (${gitDirty})`);
  log(`Article:          ${ARTICLE_FILE}`);
  log(`Profile:          ${PROFILE.name} (${PROFILE.expertise}/${PROFILE.focus}/${PROFILE.depth}/${PROFILE.context})`);
  log(`Injections:       ${INJECTIONS.length}`);

  log(sep('STEP 1 — extract + structure article'));
  const fullPath = path.join(PAPERS_DIR, ARTICLE_FILE);
  const buf = readFileSync(fullPath);
  log(`Binário: ${(buf.length / 1024).toFixed(1)} KB`);
  const tExtract = Date.now();
  const { rawText } = await extractRawText(buf);
  log(`Extração:     ${rawText.length} chars / ${wordCount(rawText)} palavras  (${Date.now() - tExtract} ms)`);
  const tStruct = Date.now();
  const structure = await structureRawText(rawText);
  const abstractLen = structure.abstract?.length ?? 0;
  log(`Estruturação: abstract ${abstractLen > 0 ? `✅ ${abstractLen} chars` : '❌ NÃO IDENTIFICADO'}  (${Date.now() - tStruct} ms)`);

  log(sep('STEP 2 — generate baseline summary (clean)'));
  const wrappedLlm: LlmCall = async (prompt, opts) =>
    generateCompletion({ prompt, temperature: opts.temperature, maxTokens: opts.maxTokens });
  const tGen = Date.now();
  const rawSummary = await generateForVariant(VARIANT, PROFILE, structure, rawText, wrappedLlm);
  const originalContent = stripThinking(rawSummary);
  log(`Gerado em ${(Date.now() - tGen) / 1000}s — ${originalContent.length} chars / ${wordCount(originalContent)} palavras`);
  writeFileSync(path.join(outputDir, 'original_summary.md'), originalContent);

  log(sep('STEP 3 — run FineSurE on baseline'));
  const tBase = Date.now();
  const baseFact = await checkFactuality(originalContent, structure, rawText);
  log(`Baseline: F=${baseFact.score?.toFixed(3)} C=${baseFact.completeness?.toFixed(3)} Co=${baseFact.conciseness?.toFixed(3)} (${(Date.now() - tBase) / 1000}s)`);
  log(`Frases baseline: ${baseFact.results.length} (supported=${baseFact.results.filter((r) => r.label === 'supported').length})`);
  writeFileSync(path.join(outputDir, 'baseline_finesure.json'), JSON.stringify(baseFact, null, 2));

  log(sep('STEP 4 — build tainted summary (baseline + 8 injections)'));
  const injectedParagraph = INJECTIONS.map((i) => i.sentence).join(' ');
  const taintedContent = `${originalContent.trim()}\n\n${injectedParagraph}`;
  log(`Tainted: ${taintedContent.length} chars / ${wordCount(taintedContent)} palavras (baseline + ${INJECTIONS.length} injeções)`);
  writeFileSync(path.join(outputDir, 'tainted_summary.md'), taintedContent);

  log(sep('STEP 5 — run FineSurE on tainted version'));
  const tTaint = Date.now();
  const taintFact = await checkFactuality(taintedContent, structure, rawText);
  log(`Tainted:  F=${taintFact.score?.toFixed(3)} C=${taintFact.completeness?.toFixed(3)} Co=${taintFact.conciseness?.toFixed(3)} (${(Date.now() - tTaint) / 1000}s)`);
  log(`Frases tainted: ${taintFact.results.length}`);
  writeFileSync(path.join(outputDir, 'tainted_finesure.json'), JSON.stringify(taintFact, null, 2));

  log(sep('STEP 6 — match injections against FineSurE output'));
  const details = taintFact.results;
  let detected = 0;
  let correctlyCategorized = 0;
  const injectionResults: Array<{
    expected: string;
    detected: boolean;
    categoryMatch: boolean;
    actualCategory: string | null;
    actualLabel: string | null;
    rationale: string | null;
  }> = [];

  for (const inj of INJECTIONS) {
    const key = inj.sentence.slice(0, 40).toLowerCase();
    const match = details.find((d) => d.sentence.toLowerCase().includes(key));
    if (!match) {
      log(`  [MISSING ] expected=${inj.expected.padEnd(22)} | "${inj.sentence.slice(0, 80)}..."`);
      injectionResults.push({ expected: inj.expected, detected: false, categoryMatch: false, actualCategory: null, actualLabel: null, rationale: null });
      continue;
    }
    const detectedAsError = match.label !== 'supported';
    const categoryMatch = match.category === inj.expected;
    if (detectedAsError) detected++;
    if (detectedAsError && categoryMatch) correctlyCategorized++;
    const detSym = detectedAsError ? '✓' : '✗';
    const catSym = categoryMatch ? '✓' : (detectedAsError ? '~' : '✗');
    log(`  [det ${detSym} cat ${catSym}] expected=${inj.expected.padEnd(22)} | got=${(match.category || '?').padEnd(22)} | label=${match.label}`);
    injectionResults.push({
      expected: inj.expected,
      detected: detectedAsError,
      categoryMatch,
      actualCategory: match.category,
      actualLabel: match.label,
      rationale: match.rationale,
    });
  }

  log(sep('SUMMARY'));
  const detectionRate = detected / INJECTIONS.length;
  const categoryRate = correctlyCategorized / INJECTIONS.length;
  log(`Detection rate:        ${detected}/${INJECTIONS.length} (${(100 * detectionRate).toFixed(1)}%)`);
  log(`Category match rate:   ${correctlyCategorized}/${INJECTIONS.length} (${(100 * categoryRate).toFixed(1)}%)`);
  log(`Faithfulness baseline: ${baseFact.score?.toFixed(3)}`);
  log(`Faithfulness tainted:  ${taintFact.score?.toFixed(3)}`);
  const expectedTaint = (taintFact.results.length - INJECTIONS.length) / taintFact.results.length;
  log(`Faithfulness esperado se todas as 8 fossem detectadas: ${expectedTaint.toFixed(3)}`);

  const report = {
    runId,
    generationModel,
    variant: VARIANT,
    finesureModel,
    gitRev,
    gitDirty,
    article: ARTICLE_FILE,
    profile: { ...PROFILE },
    baseline: {
      faithfulness: baseFact.score,
      completeness: baseFact.completeness,
      conciseness: baseFact.conciseness,
      n_sentences: baseFact.results.length,
      summary_chars: originalContent.length,
      summary_words: wordCount(originalContent),
    },
    tainted: {
      faithfulness: taintFact.score,
      completeness: taintFact.completeness,
      conciseness: taintFact.conciseness,
      n_sentences: taintFact.results.length,
    },
    injections: INJECTIONS.map((inj, i) => ({
      ...inj,
      detected: injectionResults[i].detected,
      categoryMatch: injectionResults[i].categoryMatch,
      actualCategory: injectionResults[i].actualCategory,
      actualLabel: injectionResults[i].actualLabel,
    })),
    metrics: {
      detected,
      total: INJECTIONS.length,
      detectionRate,
      correctlyCategorized,
      categoryRate,
      expectedTaintFaithfulness: expectedTaint,
    },
  };
  writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(report, null, 2));

  log(`\n✅ INJECTION TEST CONCLUÍDO`);
  log(`Run ID: ${runId}`);
  log(`Dir:    ${outputDir}`);
}

main().catch((e) => {
  console.error('\n❌ INJECTION TEST FALHOU:', e);
  process.exit(1);
});
