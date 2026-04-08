/**
 * Compute ROUGE metrics and P-Accuracy for all pre-generated summaries.
 *
 * Pure Node.js implementation - no external dependencies or services needed.
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx packages/api/src/scripts/compute-metrics.ts
 */

import { queryAll, execute, closeDb } from '../db/connection.js';

// ─── Types ───────────────────────────────────────────────────────────

interface ArticleRow {
  id: number;
  title: string;
  structured_content: string;
  raw_text: string;
}

interface SummaryRow {
  id: number;
  article_id: number;
  profile_id: number;
  content: string;
}

const PROFILE_NAMES: Record<number, string> = {
  99: 'generic',
  100: 'junior',
  101: 'pleno',
  102: 'senior',
};

const PROFILE_DISPLAY: Record<number, string> = {
  99: 'Generic',
  100: 'Junior ',
  101: 'Pleno  ',
  102: 'Senior ',
};

// ─── ROUGE Implementation (pure Node.js) ─────────────────────────────

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
  return prev.reduce((max, v) => Math.max(max, v), 0);
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

// ─── Reference text extraction ───────────────────────────────────────

function extractReference(article: ArticleRow): string {
  try {
    const sc = JSON.parse(article.structured_content);

    // Try common abstract field names
    if (sc.abstract && typeof sc.abstract === 'string' && sc.abstract.trim().length > 0) {
      return sc.abstract.trim();
    }

    // Try nested sections structure
    if (Array.isArray(sc.sections)) {
      for (const section of sc.sections) {
        if (
          typeof section.title === 'string' &&
          section.title.toLowerCase().includes('abstract') &&
          typeof section.content === 'string'
        ) {
          return section.content.trim();
        }
      }
    }

    // Try object keys case-insensitively
    for (const key of Object.keys(sc)) {
      if (key.toLowerCase() === 'abstract' || key.toLowerCase() === 'resumo') {
        const val = sc[key];
        if (typeof val === 'string' && val.trim().length > 0) {
          return val.trim();
        }
      }
    }
  } catch {
    // JSON parse failed, fall through to raw_text fallback
  }

  // Fallback: first 2000 characters of raw_text
  if (article.raw_text && article.raw_text.trim().length > 0) {
    return article.raw_text.trim().substring(0, 2000);
  }

  return '';
}

// ─── P-Accuracy computation ──────────────────────────────────────────

interface PairwiseResult {
  profileA: string;
  profileB: string;
  rougeLScore: number;
}

interface PAccuracyResult {
  pAccuracyRouge: number;
  avgPairwiseRougeL: number;
  pairwiseDetails: PairwiseResult[];
}

function computePAccuracy(articleSummaries: SummaryRow[]): PAccuracyResult | null {
  if (articleSummaries.length < 2) return null;

  const profileIds = [99, 100, 101, 102];
  const summaryByProfile = new Map<number, SummaryRow>();
  for (const s of articleSummaries) {
    if (profileIds.includes(s.profile_id)) {
      summaryByProfile.set(s.profile_id, s);
    }
  }

  const availableProfiles = Array.from(summaryByProfile.keys()).sort((a, b) => a - b);
  if (availableProfiles.length < 2) return null;

  const pairwiseDetails: PairwiseResult[] = [];

  for (let i = 0; i < availableProfiles.length; i++) {
    for (let j = i + 1; j < availableProfiles.length; j++) {
      const profileA = availableProfiles[i];
      const profileB = availableProfiles[j];
      const summaryA = summaryByProfile.get(profileA)!;
      const summaryB = summaryByProfile.get(profileB)!;

      const score = rougeL(summaryA.content, summaryB.content);
      pairwiseDetails.push({
        profileA: PROFILE_NAMES[profileA] || `id:${profileA}`,
        profileB: PROFILE_NAMES[profileB] || `id:${profileB}`,
        rougeLScore: score,
      });
    }
  }

  const avgPairwiseRougeL =
    pairwiseDetails.reduce((sum, p) => sum + p.rougeLScore, 0) / pairwiseDetails.length;

  // P-Accuracy = 1 - avg pairwise ROUGE-L
  // Lower similarity between profiles = higher personalization accuracy
  const pAccuracyRouge = 1 - avgPairwiseRougeL;

  return { pAccuracyRouge, avgPairwiseRougeL, pairwiseDetails };
}

// ─── Main ────────────────────────────────────────────────────────────

async function computeMetrics(): Promise<void> {
  console.log('Loading data from database...\n');

  const articles = await queryAll<ArticleRow>(
    'SELECT id, title, structured_content, raw_text FROM articles'
  );
  const summaries = await queryAll<SummaryRow>(
    'SELECT id, article_id, profile_id, content FROM summaries WHERE profile_id IN (99, 100, 101, 102) ORDER BY article_id, profile_id'
  );

  if (articles.length === 0) {
    console.error('No articles found in the database.');
    process.exit(1);
  }
  if (summaries.length === 0) {
    console.error('No summaries found. Run pregenerate.ts first.');
    process.exit(1);
  }

  console.log(`Found ${articles.length} article(s) and ${summaries.length} summary(ies).\n`);

  // ─── 1. Compute ROUGE scores per summary ─────────────────────────

  console.log('=== ROUGE Scores ===\n');

  for (const article of articles) {
    const reference = extractReference(article);

    if (!reference) {
      console.log(`Article ${article.id}: No abstract/reference found, skipping ROUGE.\n`);
      continue;
    }

    const titlePreview =
      article.title.length > 60 ? article.title.substring(0, 57) + '...' : article.title;
    console.log(`Article ${article.id}: "${titlePreview}"`);
    console.log(`  Reference length: ${reference.length} chars\n`);

    const articleSummaries = summaries.filter((s) => s.article_id === article.id);

    for (const summary of articleSummaries) {
      const r1 = rougeN(summary.content, reference, 1);
      const r2 = rougeN(summary.content, reference, 2);
      const rL = rougeL(summary.content, reference);

      // Save to database
      await execute(
        'UPDATE summaries SET rouge_1 = $1, rouge_2 = $2, rouge_l = $3 WHERE id = $4',
        [r1, r2, rL, summary.id]
      );

      const profileLabel = PROFILE_DISPLAY[summary.profile_id] || `id:${summary.profile_id}`;
      console.log(
        `  ${profileLabel} (id=${summary.id}):  R1=${r1.toFixed(4)}  R2=${r2.toFixed(4)}  RL=${rL.toFixed(4)}`
      );
    }

    console.log('');
  }

  // ─── 2. Compute P-Accuracy per article ────────────────────────────

  console.log('=== P-Accuracy ===\n');

  for (const article of articles) {
    const articleSummaries = summaries.filter((s) => s.article_id === article.id);
    const result = computePAccuracy(articleSummaries);

    if (!result) {
      console.log(`Article ${article.id}: Not enough summaries for P-Accuracy.\n`);
      continue;
    }

    // Save to database
    await execute(
      `INSERT INTO p_accuracy_scores (article_id, p_accuracy_rouge, avg_pairwise_rouge_l, pairwise_details)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (article_id) DO UPDATE SET
         p_accuracy_rouge = $2, avg_pairwise_rouge_l = $3, pairwise_details = $4, computed_at = NOW()`,
      [
        article.id,
        result.pAccuracyRouge,
        result.avgPairwiseRougeL,
        JSON.stringify(result.pairwiseDetails),
      ]
    );

    const titlePreview =
      article.title.length > 60 ? article.title.substring(0, 57) + '...' : article.title;
    console.log(
      `Article ${article.id}: "${titlePreview}"`
    );
    console.log(
      `  P-Accuracy=${result.pAccuracyRouge.toFixed(4)} (avg pairwise RL=${result.avgPairwiseRougeL.toFixed(4)})`
    );
    console.log('  Pairwise details:');
    for (const pair of result.pairwiseDetails) {
      console.log(
        `    ${pair.profileA} vs ${pair.profileB}: RL=${pair.rougeLScore.toFixed(4)}`
      );
    }
    console.log('');
  }

  console.log('Metrics computation complete!');
}

computeMetrics()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Error:', err);
    await closeDb();
    process.exit(1);
  });
