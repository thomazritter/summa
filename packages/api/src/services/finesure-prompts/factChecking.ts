/**
 * FineSurE — Task 1: Fact Checking (Faithfulness)
 *
 * Source:
 *   Repo: https://github.com/DISL-Lab/FineSurE-ACL24
 *   File: finesure/utils.py
 *   Lines 6, 32-73 (prompt + ERROR_TYPES), 76-149 (parser)
 *   License: Apache 2.0
 *
 * Paper:
 *   Song, H., Su, H., Shalyminov, I., Cai, J., Mansour, S. (2024).
 *   FineSurE: Fine-grained Summarization Evaluation using LLMs.
 *   arXiv:2407.00908v3. §3.2 (Task 1) + Appendix B Figure 3.
 *
 * Fidelity:
 *   Prompt text reproduced VERBATIM from utils.py. Parser ported with the same
 *   three-tier fallback strategy. Do not edit prompt text without paper review.
 *   The caller (checkFactuality) is responsible for filtering out heading-only
 *   sentences before invoking this prompt and for reconciling the LLM's output
 *   array against the input sentence list by content (a positional mismatch
 *   between LLM-emitted and input sentence counts is the documented Llama-side
 *   failure mode — handled outside the prompt to keep the FineSurE wording
 *   unchanged).
 */

export const ERROR_TYPES = [
  'out-of-context error',
  'entity error',
  'predicate error',
  'circumstantial error',
  'grammatical error',
  'coreference error',
  'linking error',
  'other error',
] as const;

export type ErrorCategory = (typeof ERROR_TYPES)[number] | 'no error';

export interface FactCheckParseResult {
  /** 0 = no error, 1 = error (one entry per summary sentence) */
  predLabels: number[];
  /** Category name as reported by the LLM */
  predTypes: string[];
  /** Per-sentence reason text as emitted by the LLM (parallel array; empty string if missing) */
  reasons: string[];
  /** Per-sentence echoed sentence text as emitted by the LLM (parallel array) */
  sentences: string[];
}

/**
 * Verbatim port of get_fact_checking_prompt(input, sentences) from utils.py L32-73.
 */
export function buildFactCheckingPrompt(input: string, sentences: string[]): string {
  const numSentences = String(sentences.length);
  const joinedSentences = sentences.join('\n');

  return `
You will receive a transcript followed by a corresponding summary. Your task is to assess the factuality of each summary sentence across nine categories:
* no error: the statement aligns explicitly with the content of the transcript and is factually consistent with it.
* out-of-context error: the statement contains information not present in the transcript.
* entity error: the primary arguments (or their attributes) of the predicate are wrong.
* predicate error: the predicate in the summary statement is inconsistent with the transcript.
* circumstantial error: the additional information (like location or time) specifying the circumstance around a predicate is wrong.
* grammatical error: the grammar of the sentence is so wrong that it becomes meaningless.
* coreference error: a pronoun or reference with wrong or non-existing antecedent.
* linking error: error in how multiple statements are linked together in the discourse (for example temporal ordering or causal link).
* other error: the statement contains any factuality error which is not defined here.

Instruction:
First, compare each summary sentence with the transcript.
Second, provide a single sentence explaining which factuality error the sentence has.
Third, answer the classified error category for each sentence in the summary.

Provide your answer in JSON format. The answer should be a list of dictionaries whose keys are "sentence", "reason", and "category":
[{"sentence": "first sentence", "reason": "your reason", "category": "no error"}, {"sentence": "second sentence", "reason": "your reason", "category": "out-of-context error"}, {"sentence": "third sentence", "reason": "your reason", "category": "entity error"},]

Transcript:
${input}

Summary with ${numSentences} sentences:
${joinedSentences}
`;
}

/** Strip common LLM-output noise so a JSON-like payload can be parsed.
 * Note: we deliberately do NOT replace apostrophes with double quotes — Llama
 * emits valid JSON with double-quote delimiters, and a naive replace would
 * corrupt apostrophes inside string values (e.g. "Karo's lawsuit"). */
function sanitizeJsonish(raw: string): string {
  return raw
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .replace(/,(\s*[\]\}])/g, '$1');
}

/**
 * Verbatim port of parsing_llm_fact_checking_output from utils.py L76-149.
 * Preserves the three-tier fallback strategy of the original implementation.
 */
export function parseFactCheckingOutput(output: string): FactCheckParseResult {
  try {
    const startIdx = output.indexOf('[');
    if (startIdx !== -1) {
      const endIdx = output.lastIndexOf(']');
      const slice = sanitizeJsonish(output.slice(startIdx, endIdx + 1).replace(/\n/g, ''));
      const parsed = JSON.parse(slice) as Array<{ category?: string; reason?: string; sentence?: string }>;

      const predLabels: number[] = [];
      const predTypes: string[] = [];
      const reasons: string[] = [];
      const sentences: string[] = [];
      for (const item of parsed) {
        const category = String(item.category ?? '').replace(/[\[\]\n]/g, '');
        predLabels.push(category.toLowerCase() === 'no error' ? 0 : 1);
        predTypes.push(category);
        reasons.push(typeof item.reason === 'string' ? item.reason : '');
        sentences.push(typeof item.sentence === 'string' ? item.sentence : '');
      }
      return { predLabels, predTypes, reasons, sentences };
    }

    const startObj = output.indexOf('{');
    const endObj = output.lastIndexOf('}');
    if (startObj !== -1 && endObj !== -1) {
      const slice = sanitizeJsonish(output.slice(startObj, endObj + 1).replace(/\n/g, ''));
      const parsed = JSON.parse(slice) as { category?: string; reason?: string; sentence?: string };
      const category = String(parsed.category ?? '').replace(/[\[\]\n]/g, '');
      const label = category.toLowerCase() === 'no error' ? 0 : 1;
      return {
        predLabels: [label],
        predTypes: [category],
        reasons: [typeof parsed.reason === 'string' ? parsed.reason : ''],
        sentences: [typeof parsed.sentence === 'string' ? parsed.sentence : ''],
      };
    }

    throw new Error('No JSON structure found in fact-checking output');
  } catch {
    try {
      const subseqs = output.split('category');
      const predLabels: number[] = [];
      const predTypes: string[] = [];
      for (const subseq of subseqs) {
        let detected = false;
        let detectedType: string = 'no error';
        for (const errorType of ERROR_TYPES) {
          if (subseq.includes(errorType)) {
            detected = true;
            detectedType = errorType;
          }
        }
        predLabels.push(detected ? 1 : 0);
        predTypes.push(detectedType);
      }
      return {
        predLabels,
        predTypes,
        reasons: predLabels.map(() => ''),
        sentences: predLabels.map(() => ''),
      };
    } catch {
      return { predLabels: [], predTypes: [], reasons: [], sentences: [] };
    }
  }
}

/** Equation 1 from §3.2: faithfulness = |S_fact| / |S|. */
export function computeFaithfulnessScore(predLabels: number[]): number {
  if (predLabels.length === 0) return 0;
  return 1 - predLabels.reduce((a, b) => a + b, 0) / predLabels.length;
}
