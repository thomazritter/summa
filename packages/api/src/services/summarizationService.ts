import { queryOne, queryAll, execute } from '../db/connection.js';
import { generateCompletion, getActiveModel, LLMError } from './groqClient.js';
import { buildSummarizationPrompt, buildGenericSummarizationPrompt, getMaxOutputTokens } from './promptBuilder.js';
import type { ParticipantPreferences } from './promptBuilder.js';
import { getProfileById } from './profileService.js';
import { checkFactuality, checkNliServiceHealth, findRelevantContexts } from './factualityChecker.js';
import { computeRouge, computeBertScore } from './metricsService.js';
import { recomputePAccuracyForArticle } from './pAccuracyHelper.js';
import { safeJsonParse } from '../utils/validation.js';
import { GENERIC_PROFILE_ID } from '../types/rows.js';
import type { ArticleRow, SummaryRow } from '../types/rows.js';
import type { Summary, ArticleStructure, Profile } from '@summarizer/shared';

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

export class NoFlaggedSentencesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoFlaggedSentencesError';
  }
}

export const generateSummary = async (articleId: number, profileId: number, modelId?: string): Promise<Summary> => {
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

  const effectiveModel = modelId || getActiveModel();
  let summaryContent: string;
  try {
    summaryContent = await generateCompletion({
      prompt,
      temperature: 0.3,
      maxTokens: getMaxOutputTokens(),
      model: effectiveModel,
    });
  } catch (error) {
    if (error instanceof LLMError) {
      throw new SummarizationError(`Failed to generate summary: ${error.message}`);
    }
    throw error;
  }

  // Save summary
  const row = await queryOne<SummaryRow>(
    `INSERT INTO summaries (article_id, profile_id, content, model_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [articleId, profileId, summaryContent, effectiveModel],
  );

  if (!row) {
    throw new SummarizationError('Failed to save summary');
  }
  return mapRowToSummary(row);
};

export const generateSummaryWithFactuality = async (articleId: number, profileId: number, modelId?: string): Promise<Summary> => {
  const article = await queryOne<ArticleRow>('SELECT * FROM articles WHERE id = $1', [articleId]);
  if (!article) throw new NotFoundError('Article not found');

  const profile = await getProfileById(profileId);
  if (!profile) throw new NotFoundError('Profile not found');

  const structuredContent = safeJsonParse<ArticleStructure>(article.structured_content) || { sections: [] };
  const prompt = buildSummarizationPrompt(profile, structuredContent, article.raw_text);

  const effectiveModel = modelId || getActiveModel();
  let summaryContent: string;
  try {
    summaryContent = await generateCompletion({
      prompt,
      temperature: 0.3,
      maxTokens: getMaxOutputTokens(),
      model: effectiveModel,
    });
  } catch (error) {
    if (error instanceof LLMError) throw new SummarizationError(`Failed to generate summary: ${error.message}`);
    throw error;
  }

  const { score, results } = await checkFactuality(summaryContent, structuredContent, article.raw_text);

  const row = await queryOne<SummaryRow>(
    `INSERT INTO summaries (article_id, profile_id, content, factuality_score, factuality_details, model_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [articleId, profileId, summaryContent, score, JSON.stringify(results), effectiveModel],
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
 * Run factuality verification in the background without blocking the response.
 * If the NLI service is unavailable or the check fails, it logs a warning and skips.
 */
const checkFactualityInBackground = (
  summaryId: number,
  summaryContent: string,
  structuredContent: ArticleStructure,
  rawText: string
): void => {
  // Fire-and-forget: do not await
  (async () => {
    try {
      const health = await checkNliServiceHealth();
      if (!health.available) {
        console.warn(`[factuality] NLI service unavailable – skipping factuality check for summary ${summaryId}`);
        return;
      }

      const { score, results } = await checkFactuality(summaryContent, structuredContent, rawText);

      await execute(
        'UPDATE summaries SET factuality_score = $1, factuality_details = $2 WHERE id = $3',
        [score, JSON.stringify(results), summaryId],
      );

      console.info(`[factuality] Summary ${summaryId} scored ${score.toFixed(3)} (${results.length} claims checked)`);
    } catch (error) {
      console.warn(`[factuality] Background check failed for summary ${summaryId}:`, error);
    }
  })();
};

/**
 * Compute BERTScore F1 in the background and persist it on the summary row.
 * Silent no-op if the metrics service is unavailable or the call fails.
 */
const computeBertInBackground = (
  summaryId: number,
  summary: string,
  reference: string | null,
): void => {
  if (!reference) return;
  (async () => {
    try {
      const f1 = await computeBertScore(summary, reference);
      if (f1 === null) return;
      await execute('UPDATE summaries SET bert_score = $1 WHERE id = $2', [f1, summaryId]);
      console.info(`[bertscore] Summary ${summaryId} F1 ${f1.toFixed(3)}`);
    } catch (error) {
      console.warn(`[bertscore] Background check failed for summary ${summaryId}:`, error);
    }
  })();
};

/**
 * Recompute the P-Accuracy aggregate for the given article in the background.
 * No-op when fewer than two distinct profiles have summaries for the article.
 */
const recomputePAccuracyInBackground = (articleId: number): void => {
  (async () => {
    try {
      await recomputePAccuracyForArticle(articleId);
    } catch (error) {
      console.warn(`[p-accuracy] Background recompute failed for article ${articleId}:`, error);
    }
  })();
};

/**
 * Generate a generic summary (no profile parameterization).
 * Used as the control condition in the experiment.
 * Accepts englishComfort to match participant's language preference for A/B blinding.
 */
export const generateGenericSummary = async (
  articleId: number,
  englishComfort?: 'keep_english' | 'translate',
  profileId: number = GENERIC_PROFILE_ID,
  modelId?: string,
): Promise<Summary> => {
  const article = await queryOne<ArticleRow>('SELECT * FROM articles WHERE id = $1', [articleId]);
  if (!article) {
    throw new NotFoundError('Article not found');
  }

  const structuredContent = safeJsonParse<ArticleStructure>(article.structured_content) || { sections: [] };
  const prompt = buildGenericSummarizationPrompt(structuredContent, article.raw_text, englishComfort);

  const effectiveModel = modelId || getActiveModel();
  let summaryContent: string;
  try {
    summaryContent = await generateCompletion({
      prompt,
      temperature: 0.3,
      maxTokens: 8192,
      model: effectiveModel,
    });
  } catch (error) {
    if (error instanceof LLMError) {
      throw new SummarizationError(`Failed to generate generic summary: ${error.message}`);
    }
    throw error;
  }

  const row = await queryOne<SummaryRow>(
    `INSERT INTO summaries (article_id, profile_id, content, model_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [articleId, profileId, summaryContent, effectiveModel],
  );

  if (!row) {
    throw new SummarizationError('Failed to save generic summary');
  }

  // Compute and store ROUGE metrics
  const reference = structuredContent.abstract
    || structuredContent.introduction
    || article.raw_text.substring(0, 3000);
  if (reference) {
    const rouge = computeRouge(summaryContent, reference);
    await execute(
      'UPDATE summaries SET rouge_1 = $1, rouge_2 = $2, rouge_l = $3 WHERE id = $4',
      [rouge.rouge1, rouge.rouge2, rouge.rougeL, row.id],
    );
  }

  // Run factuality, BERTScore, and P-Accuracy in background (non-blocking)
  checkFactualityInBackground(row.id, summaryContent, structuredContent, article.raw_text);
  computeBertInBackground(row.id, summaryContent, reference);
  recomputePAccuracyInBackground(articleId);

  return mapRowToSummary(row);
};

/**
 * Profile dimensions used for on-demand personalized generation.
 * Maps directly to the Profile type dimensions without requiring a stored profile entity.
 */
export interface ProfileDimensions {
  expertise: Profile['expertise'];
  focus: Profile['focus'];
  depth: Profile['depth'];
  context: Profile['context'];
}

/**
 * Generate a personalized summary on-demand using participant-specific profile dimensions
 * and preferences (structurePreference, readingGoal).
 *
 * Unlike generateSummary which loads a stored profile by ID, this function accepts
 * the profile dimensions directly, allowing per-participant customization.
 *
 * The baseProfileId (100/101/102) is used for the FK constraint on the summaries table.
 */
export const generatePersonalizedSummary = async (
  articleId: number,
  baseProfileId: number,
  profileDimensions: ProfileDimensions,
  participantPreferences?: ParticipantPreferences,
  modelId?: string,
): Promise<Summary> => {
  const article = await queryOne<ArticleRow>('SELECT * FROM articles WHERE id = $1', [articleId]);
  if (!article) {
    throw new NotFoundError('Article not found');
  }

  const structuredContent = safeJsonParse<ArticleStructure>(article.structured_content) || { sections: [] };

  // Build a Profile-compatible object from the dimensions for the prompt builder
  const profileForPrompt: Profile = {
    id: baseProfileId,
    userId: 0,
    name: 'on-demand',
    expertise: profileDimensions.expertise,
    focus: profileDimensions.focus,
    depth: profileDimensions.depth,
    context: profileDimensions.context,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const prompt = buildSummarizationPrompt(profileForPrompt, structuredContent, article.raw_text, participantPreferences);

  const effectiveModel = modelId || getActiveModel();
  let summaryContent: string;
  try {
    summaryContent = await generateCompletion({
      prompt,
      temperature: 0.3,
      maxTokens: getMaxOutputTokens(),
      model: effectiveModel,
    });
  } catch (error) {
    if (error instanceof LLMError) {
      throw new SummarizationError(`Failed to generate personalized summary: ${error.message}`);
    }
    throw error;
  }

  const row = await queryOne<SummaryRow>(
    `INSERT INTO summaries (article_id, profile_id, content, model_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [articleId, baseProfileId, summaryContent, effectiveModel],
  );

  if (!row) {
    throw new SummarizationError('Failed to save personalized summary');
  }

  // Compute ROUGE against the generic summary (baseline)
  // Measures how much personalization diverges from the generic version
  const genericSummary = await queryOne<{ content: string }>(
    'SELECT content FROM summaries WHERE article_id = $1 AND profile_id = 99 LIMIT 1',
    [articleId],
  );
  if (genericSummary) {
    const rouge = computeRouge(summaryContent, genericSummary.content);
    await execute(
      'UPDATE summaries SET rouge_1 = $1, rouge_2 = $2, rouge_l = $3 WHERE id = $4',
      [rouge.rouge1, rouge.rouge2, rouge.rougeL, row.id],
    );
  }

  // Run factuality, BERTScore, and P-Accuracy in background (non-blocking)
  checkFactualityInBackground(row.id, summaryContent, structuredContent, article.raw_text);
  computeBertInBackground(row.id, summaryContent, genericSummary?.content ?? null);
  recomputePAccuracyInBackground(articleId);

  return mapRowToSummary(row);
};

/**
 * Regenerate a summary incorporating user feedback text.
 * Used in Phase 2 of the experiment.
 */
export const regenerateSummaryWithFeedback = async (
  summaryId: number,
  feedbackText: string,
  modelId?: string,
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

  const effectiveModel = modelId || getActiveModel();
  let summaryContent: string;
  try {
    summaryContent = await generateCompletion({
      prompt: feedbackPrompt,
      temperature: 0.3,
      maxTokens: getMaxOutputTokens(),
      model: effectiveModel,
    });
  } catch (error) {
    if (error instanceof LLMError) {
      throw new SummarizationError(`Failed to regenerate summary with feedback: ${error.message}`);
    }
    throw error;
  }

  const row = await queryOne<SummaryRow>(
    `INSERT INTO summaries (article_id, profile_id, content, model_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [existing.articleId, existing.profileId, summaryContent, effectiveModel],
  );

  if (!row) {
    throw new SummarizationError('Failed to save regenerated summary');
  }

  // Compute ROUGE against the generic summary, mirroring the personalized flow
  const genericSummary = await queryOne<{ content: string }>(
    'SELECT content FROM summaries WHERE article_id = $1 AND profile_id = 99 LIMIT 1',
    [existing.articleId],
  );
  if (genericSummary) {
    const rouge = computeRouge(summaryContent, genericSummary.content);
    await execute(
      'UPDATE summaries SET rouge_1 = $1, rouge_2 = $2, rouge_l = $3 WHERE id = $4',
      [rouge.rouge1, rouge.rouge2, rouge.rougeL, row.id],
    );
  }

  // Run factuality, BERTScore, and P-Accuracy in background (non-blocking)
  checkFactualityInBackground(row.id, summaryContent, structuredContent, article.raw_text);
  computeBertInBackground(row.id, summaryContent, genericSummary?.content ?? null);
  recomputePAccuracyInBackground(existing.articleId);

  return mapRowToSummary(row);
};

/**
 * Regenerate a summary using NLI factuality evidence.
 *
 * Loads per-sentence verdicts from the parent summary, picks the ones whose label
 * is not 'supported', and appends a 4th block to the original prompt asking the
 * model to either align each flagged sentence to its anchor paragraph or remove it.
 * Generates with a lower temperature (0.1) to favour grounded output and persists
 * the new summary linked to the parent via parent_summary_id.
 */
export const regenerateSummaryWithEvidence = async (summaryId: number): Promise<Summary> => {
  const existing = await queryOne<SummaryRow>('SELECT * FROM summaries WHERE id = $1', [summaryId]);
  if (!existing) {
    throw new NotFoundError('Summary not found');
  }

  const factualityDetails = safeJsonParse<Array<{
    sentence: string;
    label: 'supported' | 'neutral' | 'contradicted';
    confidence: number;
    sourceSentence?: string;
  }>>(existing.factuality_details) || [];

  const flagged = factualityDetails.filter((d) => d.label !== 'supported');
  if (flagged.length === 0) {
    throw new NoFlaggedSentencesError(
      'Nenhuma frase deste resumo foi sinalizada como não apoiada pelo artigo. Não há base para regeneração guiada por factualidade.'
    );
  }

  const article = await queryOne<ArticleRow>('SELECT * FROM articles WHERE id = $1', [existing.article_id]);
  if (!article) {
    throw new NotFoundError('Article not found');
  }

  const profile = await getProfileById(existing.profile_id);
  if (!profile) {
    throw new NotFoundError('Profile not found');
  }

  const structuredContent = safeJsonParse<ArticleStructure>(article.structured_content) || { sections: [] };

  const evidenceLines: string[] = [];
  flagged.forEach((d, idx) => {
    const contexts = findRelevantContexts(d.sentence, structuredContent, article.raw_text);
    const anchor = contexts[0] || d.sourceSentence || '';
    const anchorText = anchor.trim().length > 0
      ? anchor.trim()
      : '(nenhum trecho-âncora identificado)';
    evidenceLines.push(`${idx + 1}. Frase: "${d.sentence}"\n   Trecho-âncora: "${anchorText}"`);
  });

  const basePrompt = buildSummarizationPrompt(profile, structuredContent, article.raw_text);

  const evidencePrompt = `${basePrompt}

ATENÇÃO: O resumo anterior continha afirmações sinalizadas como NÃO APOIADAS pelo artigo original. Reescreva o resumo evitando essas afirmações. Para cada uma das frases listadas a seguir, ou (a) reformule-a de modo a alinhá-la ao trecho-âncora correspondente, ou (b) remova-a se o trecho-âncora não a sustenta de forma direta. Não introduza novas afirmações sem suporte explícito no artigo.

FRASES SINALIZADAS E TRECHOS-ÂNCORA:
${evidenceLines.join('\n')}`;

  const effectiveModel = existing.model_id || getActiveModel();
  let summaryContent: string;
  try {
    summaryContent = await generateCompletion({
      prompt: evidencePrompt,
      temperature: 0.1,
      maxTokens: getMaxOutputTokens(),
      model: effectiveModel,
    });
  } catch (error) {
    if (error instanceof LLMError) {
      throw new SummarizationError(`Failed to regenerate summary with evidence: ${error.message}`);
    }
    throw error;
  }

  const row = await queryOne<SummaryRow>(
    `INSERT INTO summaries (article_id, profile_id, content, model_id, parent_summary_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [existing.article_id, existing.profile_id, summaryContent, effectiveModel, existing.id],
  );

  if (!row) {
    throw new SummarizationError('Failed to save regenerated summary');
  }

  const abstract = (structuredContent.abstract || '').trim();
  if (abstract.length > 0) {
    const rouge = computeRouge(summaryContent, abstract);
    await execute(
      'UPDATE summaries SET rouge_1 = $1, rouge_2 = $2, rouge_l = $3 WHERE id = $4',
      [rouge.rouge1, rouge.rouge2, rouge.rougeL, row.id],
    );
  }

  checkFactualityInBackground(row.id, summaryContent, structuredContent, article.raw_text);
  computeBertInBackground(row.id, summaryContent, abstract.length > 0 ? abstract : null);

  return mapRowToSummary(row);
};

const mapRowToSummary = (row: SummaryRow): Summary => {
  return {
    id: row.id,
    articleId: row.article_id,
    profileId: row.profile_id,
    content: row.content,
    factualityScore: row.factuality_score,
    factualityDetails: safeJsonParse(row.factuality_details) || null,
    modelId: row.model_id,
    parentSummaryId: row.parent_summary_id ?? null,
    generatedAt: new Date(row.generated_at),
  };
};
