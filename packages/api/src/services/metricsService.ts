/**
 * ROUGE metrics computation service.
 *
 * Pure synchronous functions extracted from compute-metrics.ts
 * so they can be called inline after summary generation.
 */

// ─── Tokenization helpers (private) ──────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function getNgrams(tokens: string[], n: number): string[] {
  const result: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    result.push(tokens.slice(i, i + n).join(' '));
  }
  return result;
}

function countNgrams(ngramList: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ng of ngramList) {
    counts.set(ng, (counts.get(ng) || 0) + 1);
  }
  return counts;
}

function rougeN(summary: string, reference: string, n: number): number {
  const sumTokens = tokenize(summary);
  const refTokens = tokenize(reference);
  const sumNgrams = getNgrams(sumTokens, n);
  const refNgrams = getNgrams(refTokens, n);

  if (sumNgrams.length === 0 || refNgrams.length === 0) return 0;

  const refCounts = countNgrams(refNgrams);
  const sumCounts = countNgrams(sumNgrams);

  let overlap = 0;
  for (const [ng, count] of sumCounts) {
    overlap += Math.min(count, refCounts.get(ng) || 0);
  }

  const precision = overlap / sumNgrams.length;
  const recall = overlap / refNgrams.length;

  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function lcsLength(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return prev[n];
}

function rougeL(summary: string, reference: string): number {
  const sumTokens = tokenize(summary);
  const refTokens = tokenize(reference);

  if (sumTokens.length === 0 || refTokens.length === 0) return 0;

  const lcsLen = lcsLength(sumTokens, refTokens);
  const precision = lcsLen / sumTokens.length;
  const recall = lcsLen / refTokens.length;

  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

// ─── Public API ──────────────────────────────────────────────────────

export interface RougeScores {
  rouge1: number;
  rouge2: number;
  rougeL: number;
}

/**
 * Compute ROUGE-1, ROUGE-2, and ROUGE-L F1 scores between a summary and a reference text.
 * Returns zeroes if either string is empty.
 */
export function computeRouge(summary: string, reference: string): RougeScores {
  if (!summary || !reference) {
    return { rouge1: 0, rouge2: 0, rougeL: 0 };
  }

  return {
    rouge1: rougeN(summary, reference, 1),
    rouge2: rougeN(summary, reference, 2),
    rougeL: rougeL(summary, reference),
  };
}

export interface PairwiseDetail {
  profileA: string;
  profileB: string;
  rougeLScore: number;
}

export interface PAccuracyResult {
  pAccuracy: number;
  avgPairwiseRougeL: number;
  pairwiseDetails: PairwiseDetail[];
}

/**
 * Compute P-Accuracy for a set of summaries from the same article.
 *
 * P-Accuracy = 1 - avg(pairwise ROUGE-L between all profile pairs).
 * Lower similarity between different profiles means higher personalization accuracy.
 *
 * Requires at least 2 summaries with distinct profileLabel values.
 * Returns null if fewer than 2 distinct profiles are provided.
 */
export function computePAccuracy(
  summaries: Array<{ profileLabel: string; content: string }>
): PAccuracyResult | null {
  // Deduplicate by profileLabel (keep first occurrence)
  const byProfile = new Map<string, string>();
  for (const s of summaries) {
    if (!byProfile.has(s.profileLabel)) {
      byProfile.set(s.profileLabel, s.content);
    }
  }

  const profiles = Array.from(byProfile.keys());
  if (profiles.length < 2) return null;

  const pairwiseDetails: PairwiseDetail[] = [];

  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const contentA = byProfile.get(profiles[i])!;
      const contentB = byProfile.get(profiles[j])!;

      const score = rougeL(contentA, contentB);
      pairwiseDetails.push({
        profileA: profiles[i],
        profileB: profiles[j],
        rougeLScore: score,
      });
    }
  }

  const avgPairwiseRougeL =
    pairwiseDetails.reduce((sum, p) => sum + p.rougeLScore, 0) / pairwiseDetails.length;

  // P-Accuracy = 1 - avg pairwise ROUGE-L
  const pAccuracy = 1 - avgPairwiseRougeL;

  return { pAccuracy, avgPairwiseRougeL, pairwiseDetails };
}
