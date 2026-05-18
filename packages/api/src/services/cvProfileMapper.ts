import pdf from 'pdf-parse';
import { z } from 'zod';
import { generateCompletion } from './groqClient.js';

// ─── Zod Schemas ────────────────────────────────────────────────────

const cvProfileSchema = z.object({
  is_cv: z.boolean(),
  not_cv_reason: z.string().max(500).optional(),
  expertise: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
  focus: z.enum(['concepts', 'methodology', 'results', 'applications', 'all']).optional(),
  depth: z.enum(['brief', 'moderate', 'detailed', 'comprehensive']).optional(),
  context: z.enum(['quick_review', 'learning', 'research', 'teaching']).optional(),
  domain: z.string().max(500).optional(),
  reasoning: z.record(z.string(), z.string()).optional(),
});

// ─── Public Interface ───────────────────────────────────────────────

export interface CvProfileResult {
  dimensions: {
    expertise: 'beginner' | 'intermediate' | 'advanced' | 'expert';
    focus: 'concepts' | 'methodology' | 'results' | 'applications' | 'all';
    depth: 'brief' | 'moderate' | 'detailed' | 'comprehensive';
    context: 'quick_review' | 'learning' | 'research' | 'teaching';
  };
  domain: string | null;
  reasoning: Record<string, string>;
}

export type CvInferenceOutcome =
  | { kind: 'ok'; profile: CvProfileResult }
  | { kind: 'not_cv'; reason: string }
  | { kind: 'insufficient_text' }
  | { kind: 'parse_failed' };

// ─── Prompt ─────────────────────────────────────────────────────────

const CV_ANALYSIS_PROMPT = `Analise o documento abaixo e determine se é um currículo profissional. Se for, infira o perfil de leitura acadêmica da pessoa.

Retorne APENAS um JSON válido (sem markdown, sem \`\`\`, sem explicação antes ou depois).

Se o documento NÃO for um currículo profissional (ex: é um artigo científico, contrato, manual, carta, etc.), retorne:
{
  "is_cv": false,
  "not_cv_reason": "explicação breve sobre por que o documento não é um currículo (ex: 'Trata-se de um artigo científico sobre X')"
}

Se o documento FOR um currículo profissional, retorne:
{
  "is_cv": true,
  "expertise": "beginner|intermediate|advanced|expert",
  "focus": "concepts|methodology|results|applications|all",
  "depth": "brief|moderate|detailed|comprehensive",
  "context": "quick_review|learning|research|teaching",
  "domain": "domínio profissional inferido (ex: backend engineering, data science, machine learning)",
  "reasoning": {
    "expertise": "explicação breve de por que escolheu este nível",
    "focus": "explicação breve",
    "depth": "explicação breve",
    "context": "explicação breve"
  }
}

Sinais de que é um currículo: seções como Experiência, Formação, Habilidades, Idiomas, Projetos; cargos com datas e empresas; histórico profissional ou acadêmico organizado.
Sinais de que NÃO é um currículo: abstract/resumo acadêmico no início, citações bibliográficas, seções como Methodology/Results/Discussion/Conclusion, capítulos numerados, prosa contínua de várias páginas.

Regras para inferir o perfil (apenas quando is_cv = true):
- expertise: baseie-se na formação e anos de experiência. Graduando/recém-formado = beginner. 2-5 anos = intermediate. 5+ anos ou mestrado = advanced. PhD ou pesquisador sênior = expert.
- focus: baseie-se na área atual. Desenvolvedor = applications. Pesquisador = methodology ou results. Estudante = concepts. Gestão = all.
- depth: baseie-se no cargo. Cargo executivo/gestão = brief. Operacional = moderate. Técnico especializado = detailed. Pesquisador = comprehensive.
- context: Estudante = learning. Pesquisador/professor = research ou teaching. Profissional = quick_review.
- domain: infira o domínio profissional principal com base no cargo, área de atuação e habilidades. Use termos curtos em inglês (ex: "backend engineering", "data science", "frontend development", "machine learning", "devops", "product management"). Se não for possível inferir, omita o campo.

CURRÍCULO:
`;

const STRICT_RETRY_PROMPT = `Sua resposta anterior não era um JSON válido. Tente novamente.

Retorne SOMENTE o JSON, sem nenhum texto antes ou depois, sem markdown.

Se NÃO for currículo: {"is_cv":false,"not_cv_reason":"..."}
Se FOR currículo: {"is_cv":true,"expertise":"...","focus":"...","depth":"...","context":"...","domain":"...","reasoning":{"expertise":"...","focus":"...","depth":"...","context":"..."}}

Valores permitidos:
- expertise: beginner, intermediate, advanced, expert
- focus: concepts, methodology, results, applications, all
- depth: brief, moderate, detailed, comprehensive
- context: quick_review, learning, research, teaching

DOCUMENTO:
`;

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Strips markdown code fences and extracts the first JSON object
 * from an LLM response string.
 */
function extractJsonFromResponse(raw: string): string | null {
  // Strip markdown fences
  const cleaned = raw.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();

  // Find first '{' to last '}'
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return cleaned.slice(firstBrace, lastBrace + 1);
}

/**
 * Parses and validates an LLM response string. Returns one of:
 *  - { kind: 'ok', profile }       — document is a CV; profile inferred
 *  - { kind: 'not_cv', reason }    — model classified the document as not a CV
 *  - { kind: 'parse_failed' }      — invalid JSON or missing required fields
 */
function parseLlmProfileResponse(raw: string): CvInferenceOutcome {
  const jsonStr = extractJsonFromResponse(raw);
  if (!jsonStr) {
    return { kind: 'parse_failed' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { kind: 'parse_failed' };
  }

  const validation = cvProfileSchema.safeParse(parsed);
  if (!validation.success) {
    return { kind: 'parse_failed' };
  }

  const data = validation.data;

  if (data.is_cv === false) {
    return {
      kind: 'not_cv',
      reason: data.not_cv_reason || 'O documento não foi reconhecido como um currículo profissional.',
    };
  }

  // is_cv === true; require all profile fields
  if (!data.expertise || !data.focus || !data.depth || !data.context || !data.reasoning) {
    return { kind: 'parse_failed' };
  }

  return {
    kind: 'ok',
    profile: {
      dimensions: {
        expertise: data.expertise,
        focus: data.focus,
        depth: data.depth,
        context: data.context,
      },
      domain: data.domain || null,
      reasoning: data.reasoning,
    },
  };
}

// ─── Main Export ────────────────────────────────────────────────────

const MIN_CV_TEXT_LENGTH = 100;
const MAX_CV_TEXT_FOR_PROMPT = 8000;

/**
 * Extracts text from a CV PDF buffer and calls the LLM to (a) verify the
 * document is a CV and (b) infer profile dimensions when it is.
 *
 * Returns a discriminated union so the route can produce specific HTTP
 * responses for "not a CV" vs "insufficient text" vs "LLM failed to parse".
 */
export async function inferProfileFromCv(pdfBuffer: Buffer): Promise<CvInferenceOutcome> {
  const parsed = await pdf(pdfBuffer);
  const cvText = parsed.text;

  if (!cvText || cvText.length < MIN_CV_TEXT_LENGTH) {
    return { kind: 'insufficient_text' };
  }

  const truncatedCv = cvText.slice(0, MAX_CV_TEXT_FOR_PROMPT);

  const firstResponse = await generateCompletion({
    prompt: CV_ANALYSIS_PROMPT + truncatedCv,
    temperature: 0.2,
    maxTokens: 1000,
  });

  const firstResult = parseLlmProfileResponse(firstResponse);
  if (firstResult.kind !== 'parse_failed') {
    return firstResult;
  }

  const retryResponse = await generateCompletion({
    prompt: STRICT_RETRY_PROMPT + truncatedCv,
    temperature: 0.1,
    maxTokens: 800,
  });

  return parseLlmProfileResponse(retryResponse);
}
