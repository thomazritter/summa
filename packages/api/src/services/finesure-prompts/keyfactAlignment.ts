/**
 * FineSurE — Task 2: Keyfact Alignment (Completeness & Conciseness)
 *
 * Source:
 *   Repo: https://github.com/DISL-Lab/FineSurE-ACL24
 *   File: finesure/utils.py
 *   Lines 155-188 (prompt), 191-230 (parser), 240-246 (score functions)
 *   License: Apache 2.0
 *
 * Paper:
 *   Song, H., Su, H., Shalyminov, I., Cai, J., Mansour, S. (2024).
 *   FineSurE: Fine-grained Summarization Evaluation using LLMs.
 *   arXiv:2407.00908v3. §3.2 (Task 2) + Appendix B Figure 4.
 *
 * Fidelity:
 *   Prompt text reproduced VERBATIM from utils.py. The upstream function name
 *   `get_keyfact_alighment_prompt` contains a typo ("alighment" instead of
 *   "alignment"); the corrected spelling is used here only in the public
 *   identifier. Prompt body and parser logic are unchanged.
 */

export interface KeyfactAlignmentParseResult {
  /** 0 = keyfact not inferred from summary, 1 = inferred (one entry per keyfact) */
  predLabels: number[];
  /** Unique sentence line numbers (1-indexed) that align with at least one keyfact */
  matchedLines: number[];
}

/**
 * Verbatim port of get_keyfact_alighment_prompt(keyfacts, sentences) from utils.py L155-188.
 * Summary sentences are 1-indexed in the prompt body, matching the upstream behavior.
 */
export function buildKeyfactAlignmentPrompt(keyfacts: string[], sentences: string[]): string {
  const summary = sentences.map((sentence, idx) => `[${idx + 1}] ${sentence}`).join('\n');
  const numKeyFacts = String(keyfacts.length);
  const keyFactsBlock = keyfacts.join('\n');

  return `
You will receive a summary and a set of key facts for the same transcript. Your task is to assess if each key fact is inferred from the summary.

Instruction:
First, compare each key fact with the summary.
Second, check if the key fact is inferred from the summary and then response "Yes" or "No" for each key fact. If "Yes", specify the line number(s) of the summary sentence(s) relevant to each key fact.

Provide your answer in JSON format. The answer should be a list of dictionaries whose keys are "key fact", "response", and "line number":
[{"key fact": "first key fact", "response": "Yes", "line number": [1]}, {"key fact": "second key fact", "response": "No", "line number": []}, {"key fact": "third key fact", "response": "Yes", "line number": [1, 2, 3]}]

Summary:
${summary}

${numKeyFacts} key facts:
${keyFactsBlock}
`;
}

function sanitizeJsonish(raw: string): string {
  return raw
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .replace(/'/g, '"')
    .replace(/,(\s*[\]\}])/g, '$1');
}

/**
 * Verbatim port of parsing_llm_keyfact_alighment_output from utils.py L191-230.
 */
export function parseKeyfactAlignmentOutput(output: string): KeyfactAlignmentParseResult {
  try {
    const startIdx = output.indexOf('[');
    const endIdx = output.lastIndexOf(']');
    if (startIdx === -1 || endIdx === -1) {
      throw new Error('No JSON array found in keyfact alignment output');
    }
    const slice = sanitizeJsonish(output.slice(startIdx, endIdx + 1).replace(/\n/g, ''));
    const parsed = JSON.parse(slice) as Array<{ response?: string; 'line number'?: Array<number | string> }>;

    const matchedLines = new Set<number>();
    const predLabels: number[] = [];

    for (const item of parsed) {
      const response = String(item.response ?? '').toLowerCase();
      predLabels.push(response === 'yes' ? 1 : 0);

      const lineNums = item['line number'];
      if (Array.isArray(lineNums)) {
        for (const lineNum of lineNums) {
          const normalized = typeof lineNum === 'string'
            ? lineNum.replace(/[\[\]]/g, '')
            : String(lineNum);
          const parsedNum = parseInt(normalized, 10);
          if (!Number.isNaN(parsedNum)) {
            matchedLines.add(parsedNum);
          }
        }
      }
    }

    return { predLabels, matchedLines: Array.from(matchedLines) };
  } catch {
    return { predLabels: [], matchedLines: [] };
  }
}

/** Equation 2a from §3.2: completeness = |{k : (k,s) in E}| / |K|. */
export function computeCompletenessScore(predLabels: number[]): number {
  if (predLabels.length === 0) return 0;
  return predLabels.reduce((a, b) => a + b, 0) / predLabels.length;
}

/** Equation 2b from §3.2: conciseness = |{s : (k,s) in E}| / |S|. */
export function computeConcisenessScore(matchedLines: number[], numSentences: number): number {
  if (numSentences === 0) return 0;
  return matchedLines.length / numSentences;
}
