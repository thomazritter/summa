import type { FactualityResult, ArticleStructure } from '@summarizer/shared';

const NLI_SERVICE_URL = process.env.NLI_SERVICE_URL || 'http://127.0.0.1:5050';

export const checkFactuality = async (
  summaryContent: string,
  articleStructure: ArticleStructure,
  rawText: string
): Promise<{ score: number; results: FactualityResult[] }> => {
  const sentences = splitIntoSentences(summaryContent);
  const results: FactualityResult[] = [];

  for (const sentence of sentences) {
    if (sentence.length < 20 || !containsFactualClaim(sentence)) {
      continue;
    }
    const result = await verifySentence(sentence, articleStructure, rawText);
    results.push(result);
  }

  return { score: calculateFactualityScore(results), results };
};

const splitIntoSentences = (text: string): string[] => {
  return text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 0);
};

const containsFactualClaim = (sentence: string): boolean => {
  const patterns = [/\d+/, /percent|%/i, /found|showed|demonstrated|revealed|reported/i,
    /increased|decreased|improved|reduced/i, /significant|correlation|effect/i,
    /comparado|resultado|aumento|redução|mostrou|encontrou|demonstrou/i];
  return patterns.some(p => p.test(sentence));
};

const verifySentence = async (
  sentence: string,
  structure: ArticleStructure,
  rawText: string
): Promise<FactualityResult> => {
  const context = findRelevantContext(sentence, structure, rawText);

  try {
    const response = await fetch(`${NLI_SERVICE_URL}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ premise: context, hypothesis: sentence }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`NLI service returned ${response.status}`);
    }

    const data = await response.json() as {
      label: 'supported' | 'contradicted' | 'neutral';
      confidence: number;
      scores: Record<string, number>;
    };

    return {
      sentence,
      label: data.label,
      confidence: data.confidence,
      sourceSentence: context.slice(0, 200),
    };
  } catch (error) {
    console.error(`NLI service error for sentence: "${sentence.slice(0, 50)}..."`, error);
    return {
      sentence,
      label: 'neutral',
      confidence: 0.0,
      sourceSentence: context.slice(0, 200),
    };
  }
};

const findRelevantContext = (sentence: string, structure: ArticleStructure, rawText: string): string => {
  const terms = sentence.toLowerCase().split(/\W+/).filter(t => t.length > 4);
  const sections = [structure.abstract, structure.results, structure.methodology,
    structure.discussion, structure.conclusion].filter(Boolean).join('\n\n');
  const searchText = sections || rawText;
  const paragraphs = searchText.split(/\n\n+/);

  let bestPara = paragraphs[0] || '';
  let bestScore = 0;
  for (const para of paragraphs) {
    const score = terms.filter(t => para.toLowerCase().includes(t)).length;
    if (score > bestScore) { bestScore = score; bestPara = para; }
  }
  return bestPara.slice(0, 1000);
};

const calculateFactualityScore = (results: FactualityResult[]): number => {
  if (results.length === 0) return 1.0;
  const weights = { supported: 1, neutral: 0.5, contradicted: 0 };
  return results.reduce((sum, r) => sum + weights[r.label], 0) / results.length;
};

export const checkNliServiceHealth = async (): Promise<{ available: boolean; model?: string }> => {
  try {
    const response = await fetch(`${NLI_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json() as { status: string; model: string };
      return { available: true, model: data.model };
    }
    return { available: false };
  } catch {
    return { available: false };
  }
};
