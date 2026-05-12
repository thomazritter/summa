import type { ArticleStructure } from '@summarizer/shared';

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
 * Run BEFORE LLM structuring to avoid wasting API calls.
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

  // Language detection: must contain common EN or PT academic terms
  const enTerms = /\b(abstract|introduction|methodology|methods|results|conclusion|discussion|references)\b/i;
  const ptTerms = /\b(resumo|introdução|metodologia|métodos|resultados|conclusão|discussão|referências)\b/i;
  if (!enTerms.test(rawText) && !ptTerms.test(rawText)) {
    errors.push(
      'O documento não parece ser um artigo científico em inglês ou português. ' +
      'Nenhum termo acadêmico padrão foi detectado.'
    );
  }

  return { valid: errors.length === 0, errors, warnings };
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
