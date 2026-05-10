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

/**
 * Skip non-verifiable sentences (meta/transitional/opinion).
 * Based on FactCC/SummaC approach: verify everything except obvious non-claims.
 */
const isSkippable = (sentence: string): boolean => {
  const trimmed = sentence.trim();

  // Remove markdown formatting for analysis
  const clean = trimmed.replace(/\*\*/g, '').replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim();

  // Too short to be a meaningful claim
  if (clean.length < 30) return true;

  // Section headers (not claims)
  if (/^(resumo|método|resultado|conclus|introduç|recomendaç|limitaç|implica)/i.test(clean) && clean.length < 60) return true;

  // Meta/discourse sentences about the paper itself
  const metaPatterns = [
    /^(this|the) (paper|article|study|summary|section) (presents|discusses|describes|covers|examines|reviews|outlines)/i,
    /^(em resumo|neste artigo|o artigo apresenta|este estudo|o presente trabalho|a seguir|o estudo conclui que)/i,
    /^(in summary|in conclusion|to summarize|overall|in this paper)/i,
  ];
  if (metaPatterns.some(p => p.test(clean))) return true;

  // Pure opinion/recommendation (should, must — normative, not factual)
  if (/^(as recomendações|recomenda-se|é necessário|é importante|deve-se|devem ser)/i.test(clean)) return true;

  return false;
};

// Keep old function name for compatibility
const containsFactualClaim = (sentence: string): boolean => {
  return !isSkippable(sentence);
};

/**
 * Verify a sentence against the article using multiple context candidates.
 * Takes the best (most supported) result across candidates (SummaC-inspired).
 */
const verifySentence = async (
  sentence: string,
  structure: ArticleStructure,
  rawText: string
): Promise<FactualityResult> => {
  const contexts = findRelevantContexts(sentence, structure, rawText);
  if (contexts.length === 0) {
    return { sentence, label: 'neutral', confidence: 0.0, sourceSentence: '' };
  }

  let bestResult: FactualityResult = {
    sentence, label: 'neutral', confidence: 0.0, sourceSentence: contexts[0].slice(0, 200),
  };
  let bestSupportedScore = 0;

  for (const context of contexts) {
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

      // Keep the result with highest supported score (SummaC max aggregation)
      const supportedScore = data.scores?.supported ?? (data.label === 'supported' ? data.confidence : 0);
      if (supportedScore > bestSupportedScore) {
        bestSupportedScore = supportedScore;
        bestResult = {
          sentence,
          label: data.label,
          confidence: data.confidence,
          sourceSentence: context.slice(0, 200),
        };
      }
    } catch (error) {
      console.error(`NLI service error for sentence: "${sentence.slice(0, 50)}..."`, error);
    }
  }

  return bestResult;
};

/**
 * Find the top relevant contexts from the article for NLI comparison.
 * Returns multiple candidates (SummaC-inspired) for better matching.
 */
export const findRelevantContexts = (sentence: string, structure: ArticleStructure, rawText: string): string[] => {
  const terms = sentence.toLowerCase().split(/\W+/).filter(t => t.length > 2);
  const sections = [structure.abstract, structure.results, structure.methodology,
    structure.discussion, structure.conclusion, structure.introduction].filter(Boolean).join('\n\n');
  const searchText = sections || rawText;
  const paragraphs = searchText.split(/\n\n+/).filter(p => p.trim().length > 50);

  const scored = paragraphs.map(para => ({
    para,
    score: terms.filter(t => para.toLowerCase().includes(t)).length,
  }));
  scored.sort((a, b) => b.score - a.score);

  // Return top 3 candidates
  return scored.slice(0, 3).filter(s => s.score > 0).map(s => s.para.slice(0, 1000));
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
