import { queryOne, execute } from '../db/connection.js';
import { generateCompletion, getActiveModel, LLMError } from './groqClient.js';
import { buildSummarizationPrompt, buildGenericSummarizationPrompt, getMaxOutputTokens } from './promptBuilder.js';
import type { ParticipantPreferences } from './promptBuilder.js';
import { getProfileById } from './profileService.js';
import { checkFactuality, findRelevantContexts } from './factualityChecker.js';
import { computeRouge, computeBertScore } from './metricsService.js';
import { recomputePAccuracyForArticle } from './pAccuracyHelper.js';
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

export const getSummaryById = async (id: number): Promise<Summary | null> => {
  const row = await queryOne<SummaryRow>('SELECT * FROM summaries WHERE id = $1', [id]);
  if (!row) {
    return null;
  }
  return mapRowToSummary(row);
};

/**
 * Run FineSurE 3-dim factuality verification in the background without blocking
 * the response. On success the per-sentence verdicts + faithfulness score are
 * persisted; completeness and conciseness are computed in-memory and surfaced
 * via the script tooling but not yet persisted (requires schema migration).
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
      const { score, results, completeness, conciseness, keyfacts } = await checkFactuality(
        summaryContent,
        structuredContent,
        rawText,
      );

      await execute(
        `UPDATE summaries
         SET factuality_score = $1, factuality_details = $2, factuality_status = 'complete'
         WHERE id = $3`,
        [score, JSON.stringify(results), summaryId],
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

  // Compute ROUGE against the generic summary (baseline)
  // Measures how much personalization diverges from the generic version
  const genericSummary = await queryOne<{ content: string }>(
    'SELECT content FROM summaries WHERE article_id = $1 AND profile_id = $2 LIMIT 1',
    [articleId, GENERIC_PROFILE_IDS.keepEnglish],
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

  // Reject if this summary already has a regenerated child (one regen per
  // parent). Also reject if this summary IS itself a regen (no
  // regen-of-regen). The UI hides the button in both cases; the server
  // enforces the rule as the source of truth.
  if (existing.parent_summary_id) {
    throw new NoFlaggedSentencesError(
      'Esta versão já é uma regeneração. Apenas uma regeneração por resumo é permitida.'
    );
  }
  const existingChild = await queryOne<{ id: number }>(
    'SELECT id FROM summaries WHERE parent_summary_id = $1 LIMIT 1',
    [summaryId],
  );
  if (existingChild) {
    throw new NoFlaggedSentencesError(
      'Este resumo já foi regenerado. Apenas uma regeneração por resumo é permitida.'
    );
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

  const structuredContent = safeJsonParse<ArticleStructure>(article.structured_content) || { sections: [] };

  // Reconstruct the parent's profile + preferences from the snapshot that was
  // persisted at generation time. This is what makes the regen actually
  // personalized: if we resolved the participant's CURRENT profile instead,
  // edits made after the parent was generated would silently leak into the
  // regen, and the §6.7 benchmark of parent vs. regen would compare apples
  // to oranges. Fall back to the static template + current participant prefs
  // only when there's no snapshot (legacy rows generated before the C1 fix).
  type ProfileSnapshot = {
    dimensions?: ProfileDimensions;
    preferences?: ParticipantPreferences | null;
  } & Partial<ProfileDimensions>;
  const snapshot = safeJsonParse<ProfileSnapshot>(existing.profile_snapshot);
  const snapshotDimensions: ProfileDimensions | null = snapshot?.dimensions ?? (snapshot && snapshot.expertise && snapshot.focus && snapshot.depth && snapshot.context
    ? { expertise: snapshot.expertise, focus: snapshot.focus, depth: snapshot.depth, context: snapshot.context }
    : null);

  let profile: Profile;
  if (snapshotDimensions) {
    profile = {
      id: existing.profile_id,
      userId: 0,
      name: 'parent-snapshot',
      expertise: snapshotDimensions.expertise,
      focus: snapshotDimensions.focus,
      depth: snapshotDimensions.depth,
      context: snapshotDimensions.context,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  } else {
    // Legacy fallback: parent has no snapshot; use the static template.
    const fallback = await getProfileById(existing.profile_id);
    if (!fallback) {
      throw new NotFoundError('Profile not found');
    }
    profile = fallback;
  }

  let participantPreferences: ParticipantPreferences | undefined;
  if (snapshot?.preferences) {
    participantPreferences = snapshot.preferences;
  } else {
    // Legacy fallback: derive prefs from the current participant state.
    const session = await queryOne<{ participant_id: number }>(
      `SELECT participant_id FROM experiment_sessions
       WHERE personalized_summary_id = $1 OR generic_summary_id = $1
       LIMIT 1`,
      [summaryId],
    );
    let participantId: number | null = session?.participant_id ?? null;
    if (participantId === null) {
      const articleOwner = await queryOne<{ uploaded_by: number | null }>(
        'SELECT uploaded_by FROM articles WHERE id = $1',
        [existing.article_id],
      );
      participantId = articleOwner?.uploaded_by ?? null;
    }
    if (participantId !== null) {
      const participant = await queryOne<ParticipantRow>('SELECT * FROM participants WHERE id = $1', [participantId]);
      if (participant) {
        const candidate: ParticipantPreferences = {
          structurePreference: (participant.structure_preference as 'prose' | 'bullets' | 'mixed' | null) ?? undefined,
          domain: participant.domain ?? undefined,
          currentProject: participant.current_project ?? undefined,
        };
        if (candidate.structurePreference || candidate.domain || candidate.currentProject) {
          participantPreferences = candidate;
        }
      }
    }
  }

  const evidenceLines: string[] = [];
  flagged.forEach((d, idx) => {
    const contexts = findRelevantContexts(d.sentence, structuredContent, article.raw_text);
    const anchor = contexts[0] || d.sourceSentence || '';
    const anchorText = anchor.trim().length > 0
      ? anchor.trim()
      : '(nenhum trecho-âncora identificado)';
    evidenceLines.push(`${idx + 1}. Frase: "${d.sentence}"\n   Trecho-âncora: "${anchorText}"`);
  });

  const basePrompt = buildSummarizationPrompt(profile, structuredContent, article.raw_text, participantPreferences);

  const evidencePrompt = `${basePrompt}

ATENÇÃO: O resumo anterior continha afirmações sinalizadas como NÃO APOIADAS pelo artigo original. Reescreva o resumo evitando essas afirmações. Para cada uma das frases listadas a seguir, ou (a) reformule-a de modo a alinhá-la ao trecho-âncora correspondente, ou (b) remova-a se o trecho-âncora não a sustenta de forma direta. Não introduza novas afirmações sem suporte explícito no artigo.

FRASES SINALIZADAS E TRECHOS-ÂNCORA:
${evidenceLines.join('\n')}`;

  // Regen uses a different model than first-gen by default. Appendix F of the
  // thesis cross-validates the regen pick across two scenarios: an N=20 run
  // over lowest-fact-globals, and an N=5 run stratified by distinct articles.
  // Llama 4 Scout 17B is the only model that improves factuality consistently
  // in both rounds (Δ +0.045 / 15-of-20 and Δ +0.056 / 4-of-5), with the
  // lowest latency among contenders (~24s). Qwen 3 32B, which led the first
  // round, regressed under stratification (Δ -0.044, 1-of-5) — its initial
  // lead did not generalise out of the original article set. The override can
  // be set per deployment via GROQ_REGEN_MODEL.
  const effectiveModel = process.env.GROQ_REGEN_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
  let summaryContent: string;
  try {
    summaryContent = await generateCompletion({
      prompt: evidencePrompt,
      temperature: 0.1,
      maxTokens: getMaxOutputTokens(),
      model: effectiveModel,
    });
    // Strip Qwen-style chain-of-thought blocks if the override picks a reasoning
    // model. The default (Llama 4 Scout) does not emit <think> tags, so this is
    // a no-op for it but keeps GROQ_REGEN_MODEL overrides safe.
    summaryContent = summaryContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  } catch (error) {
    if (error instanceof LLMError) {
      throw new SummarizationError(`Failed to regenerate summary with evidence: ${error.message}`);
    }
    throw error;
  }

  // Carry the parent's snapshot forward so the regen row also reproduces the
  // exact profile + preferences that drove the prompt — important for §6.7
  // parent-vs-regen comparisons and for any future regen-of-regen.
  const regenSnapshot = snapshotDimensions
    ? { dimensions: snapshotDimensions, preferences: participantPreferences ?? null }
    : null;

  const row = await queryOne<SummaryRow>(
    `INSERT INTO summaries (article_id, profile_id, content, model_id, parent_summary_id, profile_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      existing.article_id,
      existing.profile_id,
      summaryContent,
      effectiveModel,
      existing.id,
      regenSnapshot ? JSON.stringify(regenSnapshot) : null,
    ],
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
