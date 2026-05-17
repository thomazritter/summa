import type { ArticleStructure } from '@summarizer/shared';
import { generateCompletion } from './groqClient.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];   // blocking errors
  warnings: string[]; // non-blocking warnings
}

const SECTION_KEYS = ['abstract', 'introduction', 'methodology', 'results', 'discussion', 'conclusion'] as const;
type SectionKey = typeof SECTION_KEYS[number];

const MIN_TEXT_LENGTH = 1500;
const MIN_SECTION_LENGTH = 50;
const SHORT_SECTION_THRESHOLD = 200;

/**
 * Phase 1: Pre-structuring validation (cheap, fast, blocking).
 * Checks raw text length only. Domain/language validation is delegated to
 * validateArticleScope, which runs an LLM call.
 */
export function validatePreStructuring(rawText: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Min 1500 chars (roughly 1 page of text)
  if (rawText.length < MIN_TEXT_LENGTH) {
    errors.push(
      'O texto extraído é muito curto (mínimo 1500 caracteres). ' +
      'Verifique se o PDF contém texto selecionável e não é uma imagem escaneada.'
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Phase 1b: Scope validation (LLM-based, blocking).
 * Two checks in a single Groq call:
 *   (1) Is the document a scientific article (not a report, manual, contract,
 *       essay, book, etc).
 *   (2) Is the article written in English.
 *
 * The scope reflects the experimental setup: the human study (Cap.6 of the
 * thesis) used English-language Computer Science papers, and the FineSurE
 * verification layer was calibrated cross-lingually for English-source +
 * Portuguese-summary. Articles outside this scope are blocked at upload time.
 */
export async function validateArticleScope(rawText: string): Promise<ValidationResult> {
  const prompt = `Analise o texto abaixo (excerto do início de um documento) e determine duas coisas:
1. Se é um artigo cientifico (publicado em conferencia, periodico ou similar) ou outro tipo de documento (relatorio tecnico, ensaio, manual, livro, contrato, currículo, post de blog, etc).
2. Qual o idioma principal do texto: ingles ("en"), portugues ("pt") ou outro ("other").

Retorne APENAS um JSON valido (sem markdown, sem \`\`\`, sem texto antes ou depois):

Se o documento FOR um artigo cientifico em ingles:
{
  "is_scientific_paper": true,
  "language": "en"
}

Caso contrario, retorne adicionalmente uma razao breve em portugues:
{
  "is_scientific_paper": true|false,
  "language": "en"|"pt"|"other",
  "rejection_reason": "explicacao breve em portugues"
}

Sinais de artigo cientifico: secoes como Abstract/Introduction/Methodology/Results/Discussion/Conclusion ou equivalentes; autores afiliados a instituicoes; citacoes no formato (Author, Year) ou [N]; lista de referencias bibliograficas.

Sinais de que NAO e artigo cientifico: receitas, manuais, contratos, capitulos de livro sem citacoes formais, posts de blog, slides, transcricoes de palestras.

TEXTO (excerto):
${rawText.slice(0, 5000)}`;

  let response: string;
  try {
    response = await generateCompletion({ prompt, temperature: 0.1, maxTokens: 256 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      valid: false,
      errors: [`Falha ao validar o documento via modelo de linguagem: ${message}`],
      warnings: [],
    };
  }

  let parsed: { is_scientific_paper?: boolean; language?: string; rejection_reason?: string };
  try {
    let cleaned = response.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const startIdx = cleaned.indexOf('{');
    const endIdx = cleaned.lastIndexOf('}');
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      throw new Error('No JSON object found');
    }
    parsed = JSON.parse(cleaned.slice(startIdx, endIdx + 1));
  } catch {
    return {
      valid: false,
      errors: ['Não foi possível validar o documento. Tente novamente em alguns instantes.'],
      warnings: [],
    };
  }

  const errors: string[] = [];

  if (parsed.is_scientific_paper === false) {
    const reason = parsed.rejection_reason || 'O documento enviado não parece ser um artigo científico.';
    errors.push(
      `O documento enviado não parece ser um artigo científico. ${reason} ` +
      'Este sistema aceita apenas artigos científicos.'
    );
  }

  if (parsed.language && parsed.language !== 'en') {
    const langLabel = parsed.language === 'pt' ? 'português' : 'um idioma diferente do inglês';
    errors.push(
      `O artigo enviado está em ${langLabel}. ` +
      'Este sistema aceita atualmente apenas artigos científicos em inglês.'
    );
  }

  return { valid: errors.length === 0, errors, warnings: [] };
}

/**
 * Phase 2: Post-structuring validation (informational, non-blocking).
 * Run AFTER structuring to check section quality.
 */
export function validatePostStructuring(
  _rawText: string,
  structuredContent: ArticleStructure,
): ValidationResult {
  const warnings: string[] = [];

  // Section-level warnings have been intentionally suppressed: the LLM
  // structurer's section detection is imprecise enough that "missing"
  // warnings often fire on articles where the section is actually present
  // but was misclassified, misleading the user. The structurer's output
  // still feeds factuality anchoring and metric selection, but is no
  // longer surfaced as guidance in the UI.
  const found: SectionKey[] = [];
  for (const section of SECTION_KEYS) {
    const content = structuredContent[section];
    if (content && content.length > MIN_SECTION_LENGTH) {
      found.push(section);
    }
  }

  // Only warn in the truly degenerate case where structuring extracted
  // nothing usable — that's a real signal that the summary may be weak.
  if (found.length === 0) {
    warnings.push(
      'Nenhuma seção pôde ser identificada com confiança no artigo enviado. ' +
      'A geração do resumo permanece habilitada, mas a verificação de factualidade ' +
      'pode ficar menos precisa.'
    );
  }

  return { valid: true, errors: [], warnings };
}
