/**
 * Session creation business logic extracted from the experiment route handler.
 *
 * Handles the full flow: idempotency check, participant lookup,
 * generic/personalized summary generation, A/B randomization,
 * and session creation.
 */

import { queryOne, queryAll, execute } from '../db/connection.js';
import { generateGenericSummary, generatePersonalizedSummary } from './summarizationService.js';
import type { ProfileDimensions } from './summarizationService.js';
import { GENERIC_PROFILE_IDS } from '../types/rows.js';
import type { ParticipantRow, SessionRow } from '../types/rows.js';

export interface ExperienceConfig {
  profileId: number;
  dimensions: ProfileDimensions;
}

export const EXPERIENCE_CONFIG: Record<string, ExperienceConfig> = {
  junior: {
    profileId: 100,
    dimensions: { expertise: 'beginner', focus: 'concepts', depth: 'moderate', context: 'learning' },
  },
  pleno: {
    profileId: 101,
    dimensions: { expertise: 'intermediate', focus: 'methodology', depth: 'detailed', context: 'research' },
  },
  senior: {
    profileId: 102,
    dimensions: { expertise: 'advanced', focus: 'results', depth: 'comprehensive', context: 'research' },
  },
};

/**
 * Compute the effective profile dimensions for a participant,
 * applying manual overrides on top of questionnaire-derived defaults.
 *
 * Reusable by the profile endpoints and the session creation flow.
 */
export function computeProfileDimensions(participant: ParticipantRow): ProfileDimensions {
  const config = EXPERIENCE_CONFIG[participant.experience_level];
  if (!config) {
    return { expertise: 'intermediate', focus: 'all', depth: 'moderate', context: 'learning' };
  }

  const depth = (participant.preferred_length as ProfileDimensions['depth']) || config.dimensions.depth;

  const goalToFocus: Record<string, ProfileDimensions['focus']> = {
    overview: 'all',
    methodology: 'methodology',
    results: 'results',
    practical: 'applications',
  };
  const focus = (participant.reading_goal && goalToFocus[participant.reading_goal])
    || config.dimensions.focus;

  return {
    expertise: (participant.override_expertise
      || participant.cv_expertise
      || config.dimensions.expertise) as ProfileDimensions['expertise'],
    focus: (participant.override_focus
      || participant.cv_focus
      || focus) as ProfileDimensions['focus'],
    depth: (participant.override_depth
      || participant.cv_depth
      || depth) as ProfileDimensions['depth'],
    context: (participant.override_context
      || participant.cv_context
      || config.dimensions.context) as ProfileDimensions['context'],
  };
}

/**
 * Compute per-dimension sources so the UI can distinguish a value that came
 * from the questionnaire, a manual edit, or a CV inference.
 */
export function computeProfileSources(participant: ParticipantRow): Record<string, string> {
  // Main dimensions keep cv_X + override_X columns, so 'manual' is derived
  // from override_X IS NOT NULL.
  const dimensionSource = (override: string | null, cv: string | null): string => {
    if (override) return 'manual';
    if (cv) return 'cv';
    return 'questionnaire';
  };

  // Aux fields have a single value column + a boolean manual flag. The
  // initial origin (questionnaire vs cv) comes from profile_source on the
  // participant row; the moment the user touches /profile, the flag flips
  // to true and the UI shows "Editado manualmente".
  const auxSource = (value: string | null, manualFlag: boolean | null): string => {
    if (manualFlag) return 'manual';
    if (!value) return 'questionnaire';
    return participant.profile_source === 'cv' ? 'cv' : 'questionnaire';
  };

  return {
    expertise: dimensionSource(participant.override_expertise, participant.cv_expertise),
    focus: dimensionSource(participant.override_focus, participant.cv_focus),
    depth: dimensionSource(participant.override_depth, participant.cv_depth),
    context: dimensionSource(participant.override_context, participant.cv_context),
    structurePreference: auxSource(participant.structure_preference, participant.structure_preference_manual),
    domain: auxSource(participant.domain, participant.domain_manual),
    currentProject: auxSource(participant.current_project, participant.current_project_manual),
  };
}

/**
 * Shape the participant row into the JSON envelope returned by the GET /profile
 * endpoints (uses `null` instead of `undefined` for unset fields so the
 * frontend can treat absence consistently).
 */
export function serializeProfileForApi(participant: ParticipantRow) {
  return {
    ...computeProfileDimensions(participant),
    structurePreference: participant.structure_preference || null,
    domain: participant.domain || null,
    currentProject: participant.current_project || null,
  };
}

export interface PersonalizationContext {
  dimensions: ProfileDimensions;
  preferences: import('./promptBuilder.js').ParticipantPreferences | undefined;
}

/**
 * Build the personalization payload that every summarization caller needs:
 * the four profile dimensions (with manual-override fallback) plus the
 * auxiliary participant preferences. Returns `preferences: undefined` when
 * none of structure/english/domain/currentProject is set, so callers can
 * pass it straight through to generatePersonalizedSummary.
 *
 * Centralises the casts of participant.* fields to their typed unions and
 * the "hasAnyPreference" check so the three former call sites
 * (sessionService.createExperimentSession, routes/user.ts, routes/experiment.ts)
 * stay in lockstep when new dimensions/preferences are added.
 */
export function buildPersonalizationContext(participant: ParticipantRow): PersonalizationContext {
  const preferences = {
    structurePreference: (participant.structure_preference as 'prose' | 'bullets' | 'mixed' | null) ?? undefined,
    domain: participant.domain ?? undefined,
    currentProject: participant.current_project ?? undefined,
  };
  const hasAny = preferences.structurePreference
    || preferences.domain
    || preferences.currentProject;
  return {
    dimensions: computeProfileDimensions(participant),
    preferences: hasAny ? preferences : undefined,
  };
}

export class SessionCreationError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'SessionCreationError';
    this.statusCode = statusCode;
  }
}

export interface CreatedSession {
  sessionRow: SessionRow;
  isExisting: boolean;
}

/**
 * Creates an experiment session for the given participant and article.
 *
 * - Returns the existing session if the participant+article pair already exists (idempotent).
 * - Generates generic and personalized summaries on demand.
 * - Randomizes A/B assignment.
 */
export async function createExperimentSession(
  participantId: number,
  articleId: number,
): Promise<CreatedSession> {
  // Idempotency: return existing session if participant+article pair already exists
  const existingSession = await queryOne<SessionRow>(
    'SELECT * FROM experiment_sessions WHERE participant_id = $1 AND article_id = $2',
    [participantId, articleId],
  );
  if (existingSession) {
    return { sessionRow: existingSession, isExisting: true };
  }

  // Look up participant
  const participant = await queryOne<ParticipantRow>('SELECT * FROM participants WHERE id = $1', [participantId]);
  if (!participant) {
    throw new SessionCreationError('Participant not found', 404);
  }

  const config = EXPERIENCE_CONFIG[participant.experience_level];
  if (!config) {
    throw new SessionCreationError(
      `No profile mapping for experience level: ${participant.experience_level}`,
      400,
    );
  }

  // Verify article exists
  const article = await queryOne<{ id: number }>('SELECT id FROM articles WHERE id = $1', [articleId]);
  if (!article) {
    throw new SessionCreationError('Article not found', 404);
  }

  // Generic summary: one per article (no translation variants).
  let genericSummary = await queryOne<{ id: number }>(
    'SELECT id FROM summaries WHERE article_id = $1 AND profile_id = $2',
    [articleId, GENERIC_PROFILE_IDS.keepEnglish],
  );
  if (!genericSummary) {
    const generated = await generateGenericSummary(articleId);
    genericSummary = { id: generated.id };
  }

  const { dimensions, preferences } = buildPersonalizationContext(participant);

  const personalizedSummary = await generatePersonalizedSummary(
    articleId,
    config.profileId,
    dimensions,
    preferences,
  );

  // Randomize A/B order
  const genericIsA = Math.random() < 0.5;
  const abOrder = genericIsA
    ? { A: 'generic' as const, B: 'personalized' as const }
    : { A: 'personalized' as const, B: 'generic' as const };

  // Create session
  const sessionRow = await queryOne<SessionRow>(`
    INSERT INTO experiment_sessions (participant_id, article_id, profile_id, generic_summary_id, personalized_summary_id, ab_order, phase)
    VALUES ($1, $2, $3, $4, $5, $6, 'comparison')
    RETURNING *
  `, [participantId, articleId, config.profileId, genericSummary.id, personalizedSummary.id, JSON.stringify(abOrder)]);

  if (!sessionRow) {
    throw new SessionCreationError('Falha ao criar registro', 500);
  }

  // Save profile snapshot so we can reconstruct what dimensions were used
  await execute(
    'UPDATE experiment_sessions SET profile_snapshot = $1 WHERE id = $2',
    [JSON.stringify(dimensions), sessionRow.id],
  );

  return { sessionRow, isExisting: false };
}
