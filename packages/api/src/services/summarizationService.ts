import { getDb } from '../db/connection.js';
import { generateCompletion, OllamaError } from './ollamaClient.js';
import { buildSummarizationPrompt, buildGenericSummarizationPrompt, getMaxTokensForDepth } from './promptBuilder.js';
import { getProfileById } from './profileService.js';
import { checkFactuality } from './factualityChecker.js';
import { safeJsonParse } from '../utils/validation.js';
import type { Summary, ArticleStructure } from '@summarizer/shared';

const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

export class SummarizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SummarizationError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export const generateSummary = async (articleId: number, profileId: number): Promise<Summary> => {
  const db = getDb();

  // Get article
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId) as ArticleRow | undefined;
  if (!article) {
    throw new NotFoundError('Article not found');
  }

  // Get profile
  const profile = getProfileById(profileId);
  if (!profile) {
    throw new NotFoundError('Profile not found');
  }

  const structuredContent = safeJsonParse<ArticleStructure>(article.structured_content) || { sections: [] };

  // Build prompt and generate
  const prompt = buildSummarizationPrompt(profile, structuredContent, article.raw_text);

  let summaryContent: string;
  try {
    summaryContent = await generateCompletion({
      model: DEFAULT_MODEL,
      prompt,
      options: {
        temperature: 0.3, // Lower temperature for more focused output
        num_predict: getMaxTokensForDepth(profile.depth),
      },
    });
  } catch (error) {
    if (error instanceof OllamaError) {
      throw new SummarizationError(`Failed to generate summary: ${error.message}`);
    }
    throw error;
  }

  // Save summary
  const stmt = db.prepare(`
    INSERT INTO summaries (article_id, profile_id, content)
    VALUES (?, ?, ?)
  `);

  const result = stmt.run(articleId, profileId, summaryContent);
  const summary = getSummaryById(result.lastInsertRowid as number);
  if (!summary) {
    throw new SummarizationError('Failed to save summary');
  }
  return summary;
};

export const generateSummaryWithFactuality = async (articleId: number, profileId: number): Promise<Summary> => {
  const db = getDb();
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId) as ArticleRow | undefined;
  if (!article) throw new NotFoundError('Article not found');

  const profile = getProfileById(profileId);
  if (!profile) throw new NotFoundError('Profile not found');

  const structuredContent = safeJsonParse<ArticleStructure>(article.structured_content) || { sections: [] };
  const prompt = buildSummarizationPrompt(profile, structuredContent, article.raw_text);

  let summaryContent: string;
  try {
    summaryContent = await generateCompletion({
      model: DEFAULT_MODEL, prompt,
      options: { temperature: 0.3, num_predict: getMaxTokensForDepth(profile.depth) },
    });
  } catch (error) {
    if (error instanceof OllamaError) throw new SummarizationError(`Failed to generate summary: ${error.message}`);
    throw error;
  }

  const { score, results } = await checkFactuality(summaryContent, structuredContent, article.raw_text);

  const stmt = db.prepare(`
    INSERT INTO summaries (article_id, profile_id, content, factuality_score, factuality_details)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(articleId, profileId, summaryContent, score, JSON.stringify(results));
  const summary = getSummaryById(result.lastInsertRowid as number);
  if (!summary) throw new SummarizationError('Failed to save summary');
  return summary;
};

export const getSummaryById = (id: number): Summary | null => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM summaries WHERE id = ?').get(id) as SummaryRow | undefined;
  if (!row) {
    return null;
  }
  return mapRowToSummary(row);
};

export const getSummariesByArticle = (articleId: number): Summary[] => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM summaries WHERE article_id = ?').all(articleId) as SummaryRow[];
  return rows.map(mapRowToSummary);
};

export const getSummariesByProfile = (profileId: number): Summary[] => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM summaries WHERE profile_id = ?').all(profileId) as SummaryRow[];
  return rows.map(mapRowToSummary);
};

export const regenerateSummary = async (summaryId: number): Promise<Summary> => {
  const existing = getSummaryById(summaryId);
  if (!existing) {
    throw new NotFoundError('Summary not found');
  }

  // Generate new summary first (preserves old one if generation fails)
  const newSummary = await generateSummary(existing.articleId, existing.profileId);

  // Only delete old summary after new one is successfully created
  const db = getDb();
  db.prepare('DELETE FROM summaries WHERE id = ?').run(summaryId);

  return newSummary;
};

export const updateSummaryFactuality = (
  summaryId: number,
  factualityScore: number,
  factualityDetails: unknown[]
): Summary | null => {
  const db = getDb();

  db.prepare(`
    UPDATE summaries
    SET factuality_score = ?, factuality_details = ?
    WHERE id = ?
  `).run(factualityScore, JSON.stringify(factualityDetails), summaryId);

  return getSummaryById(summaryId);
};

/**
 * Generate a generic summary (no profile parameterization).
 * Used as the control condition in the experiment.
 */
export const generateGenericSummary = async (articleId: number): Promise<Summary> => {
  const db = getDb();

  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId) as ArticleRow | undefined;
  if (!article) {
    throw new NotFoundError('Article not found');
  }

  const structuredContent = safeJsonParse<ArticleStructure>(article.structured_content) || { sections: [] };
  const prompt = buildGenericSummarizationPrompt(structuredContent, article.raw_text);

  let summaryContent: string;
  try {
    summaryContent = await generateCompletion({
      model: DEFAULT_MODEL,
      prompt,
      options: {
        temperature: 0.3,
        num_predict: 600,
      },
    });
  } catch (error) {
    if (error instanceof OllamaError) {
      throw new SummarizationError(`Failed to generate generic summary: ${error.message}`);
    }
    throw error;
  }

  const GENERIC_PROFILE_ID = 99;

  const stmt = db.prepare(`
    INSERT INTO summaries (article_id, profile_id, content)
    VALUES (?, ?, ?)
  `);

  const result = stmt.run(articleId, GENERIC_PROFILE_ID, summaryContent);
  const summary = getSummaryById(result.lastInsertRowid as number);
  if (!summary) {
    throw new SummarizationError('Failed to save generic summary');
  }
  return summary;
};

/**
 * Regenerate a summary incorporating user feedback text.
 * Used in Phase 2 of the experiment.
 */
export const regenerateSummaryWithFeedback = async (
  summaryId: number,
  feedbackText: string
): Promise<Summary> => {
  const db = getDb();
  const existing = getSummaryById(summaryId);
  if (!existing) {
    throw new NotFoundError('Summary not found');
  }

  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(existing.articleId) as ArticleRow | undefined;
  if (!article) {
    throw new NotFoundError('Article not found');
  }

  const profile = getProfileById(existing.profileId);
  if (!profile) {
    throw new NotFoundError('Profile not found');
  }

  const structuredContent = safeJsonParse<ArticleStructure>(article.structured_content) || { sections: [] };
  const basePrompt = buildSummarizationPrompt(profile, structuredContent, article.raw_text);

  const feedbackPrompt = `${basePrompt}

IMPORTANTE: O leitor forneceu o seguinte feedback sobre a versão anterior deste resumo. Por favor, incorpore o feedback e gere uma versão melhorada:

FEEDBACK DO LEITOR: "${feedbackText}"

Gere o resumo melhorado agora:`;

  let summaryContent: string;
  try {
    summaryContent = await generateCompletion({
      model: DEFAULT_MODEL,
      prompt: feedbackPrompt,
      options: {
        temperature: 0.3,
        num_predict: getMaxTokensForDepth(profile.depth),
      },
    });
  } catch (error) {
    if (error instanceof OllamaError) {
      throw new SummarizationError(`Failed to regenerate summary with feedback: ${error.message}`);
    }
    throw error;
  }

  const stmt = db.prepare(`
    INSERT INTO summaries (article_id, profile_id, content)
    VALUES (?, ?, ?)
  `);

  const result = stmt.run(existing.articleId, existing.profileId, summaryContent);
  const summary = getSummaryById(result.lastInsertRowid as number);
  if (!summary) {
    throw new SummarizationError('Failed to save regenerated summary');
  }
  return summary;
};

// Internal types
interface ArticleRow {
  id: number;
  title: string;
  authors: string | null;
  year: number | null;
  doi: string | null;
  url: string | null;
  raw_text: string;
  structured_content: string;
  created_at: string;
}

interface SummaryRow {
  id: number;
  article_id: number;
  profile_id: number;
  content: string;
  factuality_score: number | null;
  factuality_details: string | null;
  generated_at: string;
}

const mapRowToSummary = (row: SummaryRow): Summary => {
  return {
    id: row.id,
    articleId: row.article_id,
    profileId: row.profile_id,
    content: row.content,
    factualityScore: row.factuality_score,
    factualityDetails: safeJsonParse(row.factuality_details) || null,
    generatedAt: new Date(row.generated_at),
  };
};
