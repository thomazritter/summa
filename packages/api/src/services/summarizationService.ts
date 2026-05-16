import { queryOne, execute } from '../db/connection.js';
import { generateCompletion, getActiveModel, LLMError } from './groqClient.js';
import { buildSummarizationPrompt, buildGenericSummarizationPrompt, getMaxOutputTokens } from './promptBuilder.js';
import type { ParticipantPreferences } from './promptBuilder.js';
import { getProfileById } from './profileService.js';
import { checkFactuality } from './factualityChecker.js';
import { safeJsonParse } from '../utils/validation.js';
import { GENERIC_PROFILE_IDS, GENERIC_PROFILE_ID } from '../types/rows.js';
import type { ArticleRow, SummaryRow, ParticipantRow } from '../types/rows.js';
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

export const getSummaryById = async (id: number): Promise<Summary | null> => {
  const row = await queryOne<SummaryRow>('SELECT * FROM summaries WHERE id = $1', [id]);
  if (!row) {
    return null;
  }
  return mapRowToSummary(row);
};

/**
 * Run FineSurE 3-dim factuality verification in the background without blocking
 * the response. On success persists all three scores (faithfulness, completeness,
 * conciseness), the per-sentence verdicts, and the full per-keyfact alignment.
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
      const { score, results, completeness, conciseness, keyfacts, keyfactAlignment } = await checkFactuality(
        summaryContent,
        structuredContent,
        rawText,
      );

      await execute(
        `UPDATE summaries
         SET factuality_score = $1,
             factuality_details = $2,
             completeness_score = $3,
             conciseness_score = $4,
             factuality_keyfacts = $5,
             factuality_status = 'complete'
         WHERE id = $6`,
        [
          score,
          JSON.stringify(results),
          completeness,
          conciseness,
          keyfactAlignment.length > 0 ? JSON.stringify(keyfactAlignment) : null,
          summaryId,
        ],
      );

      const scoreLabel = score === null ? 'n/a (no verifiable claims)' : score.toFixed(3);
      const completenessLabel = completeness === null ? 'n/a' : completeness.toFixed(3);
      const concisenessLabel = conciseness === null ? 'n/a' : conciseness.toFixed(3);
      console.info(
        `[factuality] Summary ${summaryId}: faithfulness=${scoreLabel} completeness=${completenessLabel} conciseness=${concisenessLabel} (${results.length} sentences, ${keyfacts.length} keyfacts)`,
      );
    } catch (error) {
      console.warn(`[factuality] Background check failed for summary ${summaryId}:`, error);
      // Surface the failure so the UI stops waiting forever.
      await execute(
        `UPDATE summaries SET factuality_status = 'failed' WHERE id = $1`,
        [summaryId],
      ).catch(() => {/* best-effort: don't double-fail on the status update */});
    }
  })();
};

/**
 * Generate a generic summary (no profile parameterization).
 * Used as the control condition in the experiment.
 */
export const generateGenericSummary = async (
  articleId: number,
  profileId: number = GENERIC_PROFILE_ID,
  modelId?: string,
): Promise<Summary> => {
  const article = await queryOne<ArticleRow>('SELECT * FROM articles WHERE id = $1', [articleId]);
  if (!article) {
    throw new NotFoundError('Article not found');
  }

  const structuredContent = safeJsonParse<ArticleStructure>(article.structured_content) || { sections: [] };
  const prompt = buildGenericSummarizationPrompt(structuredContent, article.raw_text);

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

  // Run factuality check in background (non-blocking)
  checkFactualityInBackground(row.id, summaryContent, structuredContent, article.raw_text);

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

  // Build the snapshot that will travel with this row forever, so we can
  // reproduce what produced this summary even after the user edits their
  // profile or preferences later.
  const profileSnapshot = {
    dimensions: profileDimensions,
    preferences: participantPreferences ?? null,
  };

  const row = await queryOne<SummaryRow>(
    `INSERT INTO summaries (article_id, profile_id, content, model_id, profile_snapshot)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [articleId, baseProfileId, summaryContent, effectiveModel, JSON.stringify(profileSnapshot)],
  );

  if (!row) {
    throw new SummarizationError('Failed to save personalized summary');
  }

  // Run factuality check in background (non-blocking)
  checkFactualityInBackground(row.id, summaryContent, structuredContent, article.raw_text);

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
