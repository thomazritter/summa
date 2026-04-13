/**
 * Session creation business logic extracted from the experiment route handler.
 *
 * Handles the full flow: idempotency check, participant lookup,
 * generic/personalized summary generation, A/B randomization,
 * and session creation.
 */

import { queryOne, queryAll } from '../db/connection.js';
import { generateGenericSummary, generatePersonalizedSummary } from './summarizationService.js';
import type { ProfileDimensions } from './summarizationService.js';
import { GENERIC_PROFILE_ID } from '../types/rows.js';
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

  // Generic summary: reuse existing or generate on-demand (same for all participants per article)
  let genericSummary = await queryOne<{ id: number }>(
    'SELECT id FROM summaries WHERE article_id = $1 AND profile_id = $2',
    [articleId, GENERIC_PROFILE_ID],
  );
  if (!genericSummary) {
    const generated = await generateGenericSummary(articleId);
    genericSummary = { id: generated.id };
  }

  // Personalized summary: always generate on-demand with full participant profile
  // Use participant's preferred_length for depth (overrides experience-based depth),
  // falling back to the experience config depth if not set
  const depth = (participant.preferred_length as ProfileDimensions['depth']) || config.dimensions.depth;
  const dimensions: ProfileDimensions = {
    ...config.dimensions,
    depth,
  };

  const participantPreferences = {
    structurePreference: participant.structure_preference as 'prose' | 'bullets' | 'mixed' | undefined,
    readingGoal: participant.reading_goal as 'overview' | 'methodology' | 'results' | 'practical' | undefined,
    englishComfort: participant.english_comfort as 'keep_english' | 'translate' | undefined,
  };

  const hasPreferences = participantPreferences.structurePreference
    || participantPreferences.readingGoal
    || participantPreferences.englishComfort;

  const personalizedSummary = await generatePersonalizedSummary(
    articleId,
    config.profileId,
    dimensions,
    hasPreferences ? participantPreferences : undefined,
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

  return { sessionRow, isExisting: false };
}
