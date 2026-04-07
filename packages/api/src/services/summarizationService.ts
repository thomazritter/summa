import { queryOne, queryAll, execute } from '../db/connection.js';
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
  // Get article
  const article = await queryOne<ArticleRow>('SELECT * FROM articles WHERE id = $1', [articleId]);
  if (!article) {
    throw new NotFoundError('Article not found');
  }

  // Get profile
  const profile = await getProfileById(profileId);
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
  const row = await queryOne<SummaryRow>(
    `INSERT INTO summaries (article_id, profile_id, content)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [articleId, profileId, summaryContent],
  );

  if (!row) {
    throw new SummarizationError('Failed to save summary');
  }
  return mapRowToSummary(row);
};

export const generateSummaryWithFactuality = async (articleId: number, profileId: number): Promise<Summary> => {
  const article = await queryOne<ArticleRow>('SELECT * FROM articles WHERE id = $1', [articleId]);
  if (!article) throw new NotFoundError('Article not found');

  const profile = await getProfileById(profileId);
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

  const row = await queryOne<SummaryRow>(
    `INSERT INTO summaries (article_id, profile_id, content, factuality_score, factuality_details)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [articleId, profileId, summaryContent, score, JSON.stringify(results)],
  );

  if (!row) throw new SummarizationError('Failed to save summary');
  return mapRowToSummary(row);
};

export const getSummaryById = async (id: number): Promise<Summary | null> => {
  const row = await queryOne<SummaryRow>('SELECT * FROM summaries WHERE id = $1', [id]);
  if (!row) {
    return null;
  }
  return mapRowToSummary(row);
};

export const getSummariesByArticle = async (articleId: number): Promise<Summary[]> => {
  const rows = await queryAll<SummaryRow>('SELECT * FROM summaries WHERE article_id = $1', [articleId]);
  return rows.map(mapRowToSummary);
};

export const getSummariesByProfile = async (profileId: number): Promise<Summary[]> => {
  const rows = await queryAll<SummaryRow>('SELECT * FROM summaries WHERE profile_id = $1', [profileId]);
  return rows.map(mapRowToSummary);
};

export const regenerateSummary = async (summaryId: number): Promise<Summary> => {
  const existing = await getSummaryById(summaryId);
  if (!existing) {
    throw new NotFoundError('Summary not found');
  }

  // Generate new summary first (preserves old one if generation fails)
  const newSummary = await generateSummary(existing.articleId, existing.profileId);

  // Only delete old summary after new one is successfully created
  await execute('DELETE FROM summaries WHERE id = $1', [summaryId]);

  return newSummary;
};

export const updateSummaryFactuality = async (
  summaryId: number,
  factualityScore: number,
  factualityDetails: unknown[]
): Promise<Summary | null> => {
  await execute(
    `UPDATE summaries
     SET factuality_score = $1, factuality_details = $2
     WHERE id = $3`,
    [factualityScore, JSON.stringify(factualityDetails), summaryId],
  );

  return getSummaryById(summaryId);
};

/**
 * Generate a generic summary (no profile parameterization).
 * Used as the control condition in the experiment.
 */
export const generateGenericSummary = async (articleId: number): Promise<Summary> => {
  const article = await queryOne<ArticleRow>('SELECT * FROM articles WHERE id = $1', [articleId]);
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

  const row = await queryOne<SummaryRow>(
    `INSERT INTO summaries (article_id, profile_id, content)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [articleId, GENERIC_PROFILE_ID, summaryContent],
  );

  if (!row) {
    throw new SummarizationError('Failed to save generic summary');
  }
  return mapRowToSummary(row);
};

/**
 * Regenerate a summary incorporating user feedback text.
 * Used in Phase 2 of the experiment.
 */
export const regenerateSummaryWithFeedback = async (
  summaryId: number,
  feedbackText: string
): Promise<Summary> => {
  const existing = await getSummaryById(summaryId);
  if (!existing) {
    throw new NotFoundError('Summary not found');
  }

  const article = await queryOne<ArticleRow>('SELECT * FROM articles WHERE id = $1', [existing.articleId]);
  if (!article) {
    throw new NotFoundError('Article not found');
  }

  const profile = await getProfileById(existing.profileId);
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

  const row = await queryOne<SummaryRow>(
    `INSERT INTO summaries (article_id, profile_id, content)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [existing.articleId, existing.profileId, summaryContent],
  );

  if (!row) {
    throw new SummarizationError('Failed to save regenerated summary');
  }
  return mapRowToSummary(row);
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
