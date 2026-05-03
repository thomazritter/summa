import pdf from 'pdf-parse';
import { z } from 'zod';
import { generateCompletion } from './groqClient.js';

// ─── Zod Schemas ────────────────────────────────────────────────────

const cvProfileSchema = z.object({
  expertise: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
  focus: z.enum(['concepts', 'methodology', 'results', 'applications', 'all']),
  depth: z.enum(['brief', 'moderate', 'detailed', 'comprehensive']),
  context: z.enum(['quick_review', 'learning', 'research', 'teaching']),
  experienceLevel: z.enum(['junior', 'pleno', 'senior']),
  reasoning: z.record(z.string(), z.string()),
});

// ─── Public Interface ───────────────────────────────────────────────

export interface CvProfileResult {
  dimensions: {
    expertise: 'beginner' | 'intermediate' | 'advanced' | 'expert';
    focus: 'concepts' | 'methodology' | 'results' | 'applications' | 'all';
    depth: 'brief' | 'moderate' | 'detailed' | 'comprehensive';
    context: 'quick_review' | 'learning' | 'research' | 'teaching';
  };
  experienceLevel: 'junior' | 'pleno' | 'senior';
  reasoning: Record<string, string>;
}

// ─── Prompt ─────────────────────────────────────────────────────────

const CV_ANALYSIS_PROMPT = `Analise este currículo e determine o perfil de leitura acadêmica da pessoa.

Retorne APENAS um JSON válido (sem markdown, sem \`\`\`, sem explicação antes ou depois):
{
  "expertise": "beginner|intermediate|advanced|expert",
  "focus": "concepts|methodology|results|applications|all",
  "depth": "brief|moderate|detailed|comprehensive",
  "context": "quick_review|learning|research|teaching",
  "experienceLevel": "junior|pleno|senior",
  "reasoning": {
    "expertise": "explicação breve de por que escolheu este nível",
    "focus": "explicação breve",
    "depth": "explicação breve",
    "context": "explicação breve",
    "experienceLevel": "explicação breve"
  }
}

Regras para inferir:
- expertise: baseie-se na formação e anos de experiência. Graduando/recém-formado = beginner. 2-5 anos = intermediate. 5+ anos ou mestrado = advanced. PhD ou pesquisador sênior = expert.
- focus: baseie-se na área atual. Desenvolvedor = applications. Pesquisador = methodology ou results. Estudante = concepts. Gestão = all.
- depth: baseie-se no cargo. Cargo executivo/gestão = brief. Operacional = moderate. Técnico especializado = detailed. Pesquisador = comprehensive.
- context: Estudante = learning. Pesquisador/professor = research ou teaching. Profissional = quick_review.
- experienceLevel: 0-2 anos = junior. 3-7 anos = pleno. 8+ anos = senior.

CURRÍCULO:
`;

const STRICT_RETRY_PROMPT = `Sua resposta anterior não era um JSON válido. Tente novamente.

Retorne SOMENTE o JSON, sem nenhum texto antes ou depois, sem markdown:
{"expertise":"...","focus":"...","depth":"...","context":"...","experienceLevel":"...","reasoning":{"expertise":"...","focus":"...","depth":"...","context":"...","experienceLevel":"..."}}

Valores permitidos:
- expertise: beginner, intermediate, advanced, expert
- focus: concepts, methodology, results, applications, all
- depth: brief, moderate, detailed, comprehensive
- context: quick_review, learning, research, teaching
- experienceLevel: junior, pleno, senior

CURRÍCULO:
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
 * Parses and validates an LLM response string into a CvProfileResult.
 * Returns null if the response is not valid JSON or fails schema validation.
 */
function parseLlmProfileResponse(raw: string): CvProfileResult | null {
  const jsonStr = extractJsonFromResponse(raw);
  if (!jsonStr) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  const validation = cvProfileSchema.safeParse(parsed);
  if (!validation.success) {
    return null;
  }

  const data = validation.data;
  return {
    dimensions: {
      expertise: data.expertise,
      focus: data.focus,
      depth: data.depth,
      context: data.context,
    },
    experienceLevel: data.experienceLevel,
    reasoning: data.reasoning,
  };
}

// ─── Main Export ────────────────────────────────────────────────────

const MIN_CV_TEXT_LENGTH = 100;
const MAX_CV_TEXT_FOR_PROMPT = 8000;

/**
 * Extracts text from a CV PDF buffer and calls the LLM to infer
 * profile dimensions for the experiment cold-start flow.
 *
 * Returns null if the PDF has insufficient text or the LLM fails
 * to produce a valid response after two attempts.
 */
export async function inferProfileFromCv(pdfBuffer: Buffer): Promise<CvProfileResult | null> {
  // 1. Extract text from PDF
  const parsed = await pdf(pdfBuffer);
  const cvText = parsed.text;

  if (!cvText || cvText.length < MIN_CV_TEXT_LENGTH) {
    return null;
  }

  const truncatedCv = cvText.slice(0, MAX_CV_TEXT_FOR_PROMPT);

  // 2. First attempt with standard prompt
  const firstResponse = await generateCompletion({
    prompt: CV_ANALYSIS_PROMPT + truncatedCv,
    temperature: 0.2,
    maxTokens: 1000,
  });

  const firstResult = parseLlmProfileResponse(firstResponse);
  if (firstResult) {
    return firstResult;
  }

  // 3. Retry with stricter prompt
  const retryResponse = await generateCompletion({
    prompt: STRICT_RETRY_PROMPT + truncatedCv,
    temperature: 0.1,
    maxTokens: 800,
  });

  return parseLlmProfileResponse(retryResponse);
}
