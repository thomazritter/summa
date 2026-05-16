/**
 * Injection sensitivity test for FineSurE.
 *
 * Takes a clean summary that scored faithfulness=1.000 on the T12 grid run
 * (Bornmann × Mestrando, summary id=108) and appends 8 hand-crafted false
 * sentences — one per FineSurE error category. Runs checkFactuality on the
 * tainted summary and reports how many injected falsehoods FineSurE catches
 * and whether it assigns the expected category.
 *
 * Does NOT persist anything to the DB — pure observation.
 *
 * Ground truth: the original 12 sentences are all factually grounded in the
 * Bornmann article; the 8 appended sentences are deliberate falsehoods whose
 * expected category is recorded in INJECTIONS below.
 *
 * Run with:  railway run -- npx tsx src/scripts/finesure-injection-test.ts
 */

import { Pool } from 'pg';
import type { ArticleStructure } from '@summarizer/shared';
import { checkFactuality } from '../services/factualityChecker.js';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

const SOURCE_SUMMARY_ID = 108;   // Bornmann × Mestrando, faith=1.0 (after bornmann-fix)
const SOURCE_ARTICLE_ID = 29;

/**
 * 8 hand-crafted injections, one per FineSurE error category.
 * Each sentence is written in the same prose style as the original summary so
 * the LLM can't distinguish them by surface signal.
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

async function main() {
  const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

  // Load summary + article
  const sumRow = await pool.query<{ content: string }>(
    'SELECT content FROM summaries WHERE id = $1',
    [SOURCE_SUMMARY_ID],
  );
  if (!sumRow.rows[0]) throw new Error(`Summary ${SOURCE_SUMMARY_ID} not found`);
  const originalContent = sumRow.rows[0].content;

  const artRow = await pool.query<{ raw_text: string; structured_content: string }>(
    'SELECT raw_text, structured_content FROM articles WHERE id = $1',
    [SOURCE_ARTICLE_ID],
  );
  if (!artRow.rows[0]) throw new Error(`Article ${SOURCE_ARTICLE_ID} not found`);
  const structure = JSON.parse(artRow.rows[0].structured_content) as ArticleStructure;
  const rawText = artRow.rows[0].raw_text;

  // Build tainted summary: original + new paragraph with the 8 injections
  const injectedParagraph = INJECTIONS.map((i) => i.sentence).join(' ');
  const taintedContent = `${originalContent.trim()}\n\n${injectedParagraph}`;

  console.log(`Original summary: ${originalContent.length} chars`);
  console.log(`Tainted summary:  ${taintedContent.length} chars`);
  console.log(`Injected:         ${INJECTIONS.length} false sentences\n`);

  // Run FineSurE on tainted version
  console.log('Running FineSurE on tainted summary…\n');
  const { score, results: details, completeness, conciseness, keyfacts } =
    await checkFactuality(taintedContent, structure, rawText);

  console.log(`Faithfulness: ${score === null ? 'n/a' : score.toFixed(3)}`);
  console.log(`Completeness: ${completeness === null ? 'n/a' : completeness.toFixed(3)}`);
  console.log(`Conciseness:  ${conciseness === null ? 'n/a' : conciseness.toFixed(3)}`);
  console.log(`Total sentences detected: ${details.length}  (expected: 12 original + 8 injected ≈ 20)`);
  console.log(`Keyfacts from abstract:   ${keyfacts.length}\n`);

  // Match each injection against the FineSurE output via substring containment
  // on the sentence text (LLM may re-emit slightly normalized whitespace/quotes).
  console.log('─── INJECTION DETECTION (per category) ───\n');
  let detected = 0;
  let correctlyCategorized = 0;
  for (const inj of INJECTIONS) {
    const key = inj.sentence.slice(0, 60).toLowerCase();
    const match = details.find((d) => d.sentence.toLowerCase().includes(key.slice(0, 40)));
    if (!match) {
      console.log(`  [MISSING] expected=${inj.expected.padEnd(22)} | "${inj.sentence.slice(0, 80)}..."`);
      continue;
    }
    const detectedAsError = match.label !== 'supported';
    const categoryMatch = match.category === inj.expected;
    if (detectedAsError) detected++;
    if (detectedAsError && categoryMatch) correctlyCategorized++;
    const detSym = detectedAsError ? '✓' : '✗';
    const catSym = categoryMatch ? '✓' : (detectedAsError ? '~' : '✗');
    console.log(`  [det ${detSym} cat ${catSym}] expected=${inj.expected.padEnd(22)} | got=${(match.category || '?').padEnd(22)} | label=${match.label}`);
    if (!detectedAsError) {
      console.log(`              "${inj.sentence.slice(0, 100)}..."`);
    } else if (!categoryMatch) {
      console.log(`              rationale: ${match.rationale.slice(0, 150)}`);
    }
  }

  console.log('\n─── SUMMARY ───');
  console.log(`Detection rate:        ${detected}/${INJECTIONS.length} (${((100 * detected) / INJECTIONS.length).toFixed(0)}%)`);
  console.log(`Category match rate:   ${correctlyCategorized}/${INJECTIONS.length} (${((100 * correctlyCategorized) / INJECTIONS.length).toFixed(0)}%)`);
  console.log(`Faithfulness expected: ~${(12 / 20).toFixed(3)} (12 clean / 20 total) if all 8 injections caught`);
  console.log(`Faithfulness actual:   ${score === null ? 'n/a' : score.toFixed(3)}`);

  // Check the 12 original sentences are still classified as 'supported'
  // (sanity: my injections shouldn't displace prior verdicts)
  const originalSentences = details.filter((d) => {
    const lc = d.sentence.toLowerCase();
    return !INJECTIONS.some((inj) => lc.includes(inj.sentence.slice(0, 40).toLowerCase()));
  });
  const originalSupported = originalSentences.filter((d) => d.label === 'supported').length;
  console.log(`Original (non-injected) sentences still supported: ${originalSupported}/${originalSentences.length}`);

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
