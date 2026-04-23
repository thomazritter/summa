/**
 * Helper to compute P-Accuracy across all articles.
 *
 * Extracted from manager.ts to avoid duplication between
 * GET /results and GET /summaries endpoints.
 */

import { queryAll } from '../db/connection.js';
import { computePAccuracy } from './metricsService.js';

const PROFILE_LABELS: Record<number, string> = {
  98: 'Generico (Traduzido)',
  99: 'Generico',
  100: 'Junior',
  101: 'Pleno',
  102: 'Senior',
};

export interface ArticlePAccuracy {
  articleId: number;
  articleTitle: string;
  pAccuracyRouge: number;
  avgPairwiseRougeL: number;
  pairwiseDetails: Array<{
    profileA: string;
    profileB: string;
    rougeLScore: number;
  }>;
}

/**
 * Fetches all summaries from the database, groups them by article,
 * and computes P-Accuracy for each article that has at least 2 distinct profiles.
 */
export async function computePAccuracyForArticles(): Promise<ArticlePAccuracy[]> {
  const allSummaries = await queryAll<{
    article_id: number;
    article_title: string;
    profile_id: number;
    content: string;
  }>(`
    SELECT s.article_id, a.title as article_title, s.profile_id, s.content
    FROM summaries s
    JOIN articles a ON s.article_id = a.id
    ORDER BY s.article_id
  `);

  const byArticle = new Map<number, { title: string; sums: Array<{ profileLabel: string; content: string }> }>();
  for (const s of allSummaries) {
    if (!byArticle.has(s.article_id)) {
      byArticle.set(s.article_id, { title: s.article_title, sums: [] });
    }
    const entry = byArticle.get(s.article_id);
    if (entry) {
      entry.sums.push({
        profileLabel: PROFILE_LABELS[s.profile_id] ?? `Profile ${s.profile_id}`,
        content: s.content,
      });
    }
  }

  const results: ArticlePAccuracy[] = [];
  for (const [articleId, { title, sums }] of byArticle) {
    if (sums.length < 2) continue;
    const result = computePAccuracy(sums);
    if (!result) continue;
    results.push({
      articleId,
      articleTitle: title,
      pAccuracyRouge: result.pAccuracy,
      avgPairwiseRougeL: result.avgPairwiseRougeL,
      pairwiseDetails: result.pairwiseDetails,
    });
  }

  return results;
}

export { PROFILE_LABELS };
