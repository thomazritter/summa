/**
 * PILOT — end-to-end pipeline test with a local PDF.
 *
 * Purpose: validate that the article reaches the LLM cabo-a-rabo and that
 * the FineSurE 3-dim verification runs as expected, BEFORE we kick off the
 * full benchmark (5 prompts × 5 profiles × 2 articles + 6 models × ...).
 *
 * Reads a PDF from the local papers_pdf folder, runs the production pipeline
 * (extract → structure → V0 prompt → generate → FineSurE), and logs every
 * intermediate artifact to scripts/pilot_output/.
 *
 * Usage:
 *   GROQ_API_KEY=... npx tsx packages/api/src/scripts/pilot_test_pipeline.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { Profile } from '@summarizer/shared';
import { extractRawText, structureRawText } from '../services/pdfProcessor.js';
import { generateCompletion } from '../services/groqClient.js';
import { checkFactuality } from '../services/factualityChecker.js';
import { buildV0 } from './promptVariants.js';

// ─── Config ────────────────────────────────────────────────────────
const PDF_PATH = '/Users/thomazjusto/Documents/TCC/papers_pdf/vaswani2017attention.pdf';
const OUTPUT_DIR = '/Users/thomazjusto/Documents/TCC/project/summarizer/scripts/pilot_output';

const PROFILE: Profile = {
  id: 0,
  name: 'pleno_methodology_moderate_research',
  expertise: 'intermediate',
  focus: 'methodology',
  depth: 'moderate',
  context: 'research',
} as Profile;

// ─── Helpers ───────────────────────────────────────────────────────
const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;
const lineBreak = (label: string): string =>
  `\n${'━'.repeat(72)}\n  ${label}\n${'━'.repeat(72)}`;
const ts = (): string => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

async function main() {
  const runId = ts();
  console.log(`\n🚀 PILOT RUN ${runId}`);
  console.log(`PDF: ${PDF_PATH}`);
  console.log(`Output dir: ${OUTPUT_DIR}`);
  console.log(`Profile: ${PROFILE.name}`);
  console.log(`  expertise=${PROFILE.expertise} focus=${PROFILE.focus} depth=${PROFILE.depth} context=${PROFILE.context}`);

  // ─── ETAPA 1: Carregar PDF ─────────────────────────────────────────
  console.log(lineBreak('ETAPA 1/5 — Carregar PDF do disco'));
  const buffer = readFileSync(PDF_PATH);
  console.log(`✅ PDF carregado: ${(buffer.length / 1024).toFixed(1)} KB binário`);

  // ─── ETAPA 2: Extrair texto bruto (pdf-parse) ──────────────────────
  console.log(lineBreak('ETAPA 2/5 — Extração de texto via pdf-parse'));
  const t0 = Date.now();
  const extraction = await extractRawText(buffer);
  const rawText = extraction.rawText;
  console.log(`✅ Extração concluída em ${Date.now() - t0} ms`);
  console.log(`   Total chars: ${rawText.length}`);
  console.log(`   Total palavras: ${wordCount(rawText)}`);
  console.log(`   Tokens estimados (~4 chars/token): ${Math.ceil(rawText.length / 4)}`);
  console.log(`\n--- PRIMEIROS 400 CHARS DO TEXTO BRUTO ---`);
  console.log(rawText.slice(0, 400));
  console.log(`\n--- ÚLTIMOS 400 CHARS DO TEXTO BRUTO ---`);
  console.log(rawText.slice(-400));
  writeFileSync(path.join(OUTPUT_DIR, `${runId}_01_rawtext.txt`), rawText);
  console.log(`\n💾 Salvo: ${runId}_01_rawtext.txt`);

  // ─── ETAPA 3: Estruturação (1 chamada Groq) ─────────────────────────
  console.log(lineBreak('ETAPA 3/5 — Estruturação por LLM (Groq)'));
  const t1 = Date.now();
  const structure = await structureRawText(rawText);
  console.log(`✅ Estruturação concluída em ${Date.now() - t1} ms`);
  const detected = (['abstract', 'introduction', 'methodology', 'results', 'discussion', 'conclusion'] as const)
    .filter(k => (structure as any)[k]);
  console.log(`   Seções detectadas: [${detected.join(', ')}]`);
  detected.forEach(k => {
    const content = (structure as any)[k] as string;
    console.log(`     - ${k}: ${content.length} chars, ${wordCount(content)} palavras`);
  });
  writeFileSync(path.join(OUTPUT_DIR, `${runId}_02_structure.json`), JSON.stringify(structure, null, 2));
  console.log(`\n💾 Salvo: ${runId}_02_structure.json`);

  // ─── ETAPA 4: Construção do prompt V0 ──────────────────────────────
  console.log(lineBreak('ETAPA 4/5 — Construção do prompt V0'));
  const prompt = buildV0(PROFILE, structure, rawText);
  console.log(`✅ Prompt V0 montado`);
  console.log(`   Total chars: ${prompt.length}`);
  console.log(`   Tokens estimados: ${Math.ceil(prompt.length / 4)}`);

  // Validações críticas (a preocupação do usuário)
  const rawTextInPrompt = prompt.includes(rawText);
  const firstChunkInPrompt = prompt.includes(rawText.slice(0, 200));
  const lastChunkInPrompt = prompt.includes(rawText.slice(-200));
  console.log(`\n🔍 Validação do input que vai pra LLM:`);
  console.log(`   ✓ rawText COMPLETO embutido no prompt? ${rawTextInPrompt ? '✅ SIM' : '❌ NÃO'}`);
  console.log(`   ✓ Início do artigo presente no prompt? ${firstChunkInPrompt ? '✅ SIM' : '❌ NÃO'}`);
  console.log(`   ✓ Fim do artigo presente no prompt? ${lastChunkInPrompt ? '✅ SIM' : '❌ NÃO'}`);

  // Onde o rawText está dentro do prompt
  const rawTextStart = prompt.indexOf(rawText.slice(0, 200));
  const rawTextEnd = rawTextStart + rawText.length;
  console.log(`   Posição do rawText no prompt: chars ${rawTextStart}–${rawTextEnd} (de ${prompt.length})`);
  console.log(`   Conteúdo ANTES do rawText (instruções): ${rawTextStart} chars`);
  console.log(`   Conteúdo DEPOIS do rawText (instrução final): ${prompt.length - rawTextEnd} chars`);

  console.log(`\n--- PRIMEIROS 600 CHARS DO PROMPT (instruções + diretrizes) ---`);
  console.log(prompt.slice(0, 600));
  console.log(`\n--- 300 CHARS NA TRANSIÇÃO PARA O ARTIGO (ao redor do char ${rawTextStart}) ---`);
  console.log(prompt.slice(Math.max(0, rawTextStart - 150), rawTextStart + 150));
  console.log(`\n--- ÚLTIMOS 600 CHARS DO PROMPT (final do artigo + instrução final) ---`);
  console.log(prompt.slice(-600));

  writeFileSync(path.join(OUTPUT_DIR, `${runId}_03_prompt.txt`), prompt);
  console.log(`\n💾 Salvo: ${runId}_03_prompt.txt (prompt completo)`);

  // ─── ETAPA 5: Geração + FineSurE ───────────────────────────────────
  console.log(lineBreak('ETAPA 5a/5 — Geração do resumo (Groq, Llama 3.3 70B, T=0.3)'));
  const t2 = Date.now();
  const summary = await generateCompletion({ prompt, temperature: 0.3, maxTokens: 4000 });
  console.log(`✅ Resumo gerado em ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  console.log(`   Chars: ${summary.length}, palavras: ${wordCount(summary)}`);
  console.log(`\n--- RESUMO COMPLETO ---`);
  console.log(summary);
  console.log(`--- FIM DO RESUMO ---`);
  writeFileSync(path.join(OUTPUT_DIR, `${runId}_04_summary.md`), summary);
  console.log(`\n💾 Salvo: ${runId}_04_summary.md`);

  console.log(lineBreak('ETAPA 5b/5 — Verificação FineSurE 3-dim'));
  const t3 = Date.now();
  const fact = await checkFactuality(summary, structure, rawText);
  console.log(`✅ FineSurE concluído em ${((Date.now() - t3) / 1000).toFixed(1)}s`);
  console.log(`\n📊 RESULTADO FINESURE 3-DIM:`);
  console.log(`   Faithfulness (Eq.1): ${fact.score !== null ? fact.score.toFixed(3) : 'null'}`);
  console.log(`   Completeness (Eq.2a): ${fact.completeness !== null ? fact.completeness.toFixed(3) : 'null'}`);
  console.log(`   Conciseness (Eq.2b): ${fact.conciseness !== null ? fact.conciseness.toFixed(3) : 'null'}`);
  console.log(`   Frases analisadas: ${fact.results.length}`);
  console.log(`   Keyfacts extraídos do abstract: ${fact.keyfacts.length}`);

  const supportedCount = fact.results.filter(r => r.label === 'supported').length;
  const neutralCount = fact.results.filter(r => r.label === 'neutral').length;
  const contradictedCount = fact.results.filter(r => r.label === 'contradicted').length;
  console.log(`   Distribuição: supported=${supportedCount}, neutral=${neutralCount}, contradicted=${contradictedCount}`);

  console.log(`\n--- CLASSIFICAÇÃO POR FRASE ---`);
  fact.results.forEach((r, i) => {
    const sent = r.sentence.length > 90 ? r.sentence.slice(0, 87) + '...' : r.sentence;
    console.log(`  [${(i + 1).toString().padStart(2)}] ${r.label.padEnd(12)} ${(r.category || '').padEnd(22)} | ${sent}`);
  });

  console.log(`\n--- KEYFACTS EXTRAÍDOS DO ABSTRACT ---`);
  fact.keyfacts.forEach((kf, i) => {
    console.log(`  [${(i + 1).toString().padStart(2)}] ${kf}`);
  });

  console.log(`\n--- ALINHAMENTO DOS KEYFACTS COM O RESUMO ---`);
  fact.keyfactAlignment.forEach((kfa, i) => {
    const lines = kfa.lineNumbers.length > 0 ? `linhas ${kfa.lineNumbers.join(',')}` : '(NÃO COBERTO)';
    const covered = kfa.covered ? '✅' : '❌';
    console.log(`  [${(i + 1).toString().padStart(2)}] ${covered} ${lines.padEnd(28)} ${kfa.fact}`);
  });

  writeFileSync(path.join(OUTPUT_DIR, `${runId}_05_finesure.json`), JSON.stringify(fact, null, 2));
  console.log(`\n💾 Salvo: ${runId}_05_finesure.json`);

  // ─── Resumo final ──────────────────────────────────────────────────
  console.log(lineBreak('PILOT RUN COMPLETO'));
  console.log(`Run ID: ${runId}`);
  console.log(`Artefatos salvos em: ${OUTPUT_DIR}`);
  console.log(`  ${runId}_01_rawtext.txt     — texto extraído do PDF`);
  console.log(`  ${runId}_02_structure.json  — seções identificadas pela LLM`);
  console.log(`  ${runId}_03_prompt.txt      — prompt completo enviado à LLM`);
  console.log(`  ${runId}_04_summary.md      — resumo gerado`);
  console.log(`  ${runId}_05_finesure.json   — resultado FineSurE 3-dim`);
  console.log(`\nMétricas finais:`);
  console.log(`  Faithfulness=${fact.score?.toFixed(3) ?? '?'} | Completeness=${fact.completeness?.toFixed(3) ?? '?'} | Conciseness=${fact.conciseness?.toFixed(3) ?? '?'}`);
}

main().catch(e => {
  console.error('\n❌ PILOTO FALHOU:', e);
  process.exit(1);
});
