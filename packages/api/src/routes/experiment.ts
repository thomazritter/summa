import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { queryOne, queryAll, execute, getClient } from '../db/connection.js';
import { parseId } from '../utils/validation.js';
import { regenerateSummaryWithFeedback, getSummaryById } from '../services/summarizationService.js';
import { requireAuth } from '../middleware/auth.js';
import type { ExperimentSession, Participant, Regeneration } from '@summarizer/shared';

export const experimentRoutes = Router();

// All experiment routes require authentication
experimentRoutes.use(requireAuth);

// ─── Validation Schemas ─────────────────────────────────────────────

const registerParticipantSchema = z.object({
  name: z.string().min(1).max(255),
  experienceLevel: z.enum(['junior', 'pleno', 'senior']),
  yearsExperience: z.number().int().min(0).max(50),
  readingFrequency: z.enum(['never', 'rarely', 'sometimes', 'frequently']),
  topicFamiliarity: z.enum(['none', 'little', 'moderate', 'high']),
});

const createSessionSchema = z.object({
  participantId: z.number().int().positive(),
  articleId: z.number().int().positive(),
});

const preferenceSchema = z.object({
  preference: z.enum(['A', 'B']),
  reason: z.string().max(5000).optional(),
});

const feedbackSchema = z.object({
  feedbackText: z.string().min(1).max(5000),
});

const rateRegenerationSchema = z.object({
  improvementRating: z.enum(['improved', 'same', 'worse']),
  utilityRating: z.number().int().min(1).max(5),
  clarityRating: z.number().int().min(1).max(5),
  adequacyRating: z.number().int().min(1).max(5),
  changeDescription: z.string().max(5000).optional(),
});

const summaryRatingsSchema = z.object({
  ratings: z.array(z.object({
    summaryId: z.number().int().positive(),
    abLabel: z.enum(['A', 'B']),
    utilidade: z.number().int().min(1).max(5),
    clareza: z.number().int().min(1).max(5),
    adequacaoPerfil: z.number().int().min(1).max(5),
    factualidadePercebida: z.number().int().min(1).max(5),
    comment: z.string().max(5000).optional(),
  })).length(2),
  preference: z.enum(['A', 'B']),
});

const postTestSchema = z.object({
  participantId: z.number().int().positive(),
  noticedDifference: z.string().max(5000),
  differenceType: z.string().max(5000).optional(),
  wouldUseDaily: z.string().max(5000),
  improvements: z.string().max(5000).optional(),
  comments: z.string().max(5000).optional(),
});

// ─── Profile Mapping ────────────────────────────────────────────────

const GENERIC_PROFILE_ID = 99;

const EXPERIENCE_TO_PROFILE: Record<string, number> = {
  junior: 100,
  pleno: 101,
  senior: 102,
};

// ─── Routes ─────────────────────────────────────────────────────────

// POST /api/experiment/participants — register participant with pre-test data
experimentRoutes.post('/participants', async (req: Request, res: Response, next: NextFunction) => {
  const validation = registerParticipantSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  const { name, experienceLevel, yearsExperience, readingFrequency, topicFamiliarity } = validation.data;

  try {
    const row = await queryOne<ParticipantRow>(`
      INSERT INTO participants (name, experience_level, years_experience, reading_frequency, topic_familiarity)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name, experienceLevel, yearsExperience, readingFrequency, topicFamiliarity]);

    // Link participant to access code
    const accessCode = req.headers['x-access-code'] as string;
    if (accessCode && row) {
      await execute('UPDATE access_codes SET participant_id = $1 WHERE code = $2', [row.id, accessCode]);
    }

    res.status(201).json(mapParticipantRow(row!));
  } catch (error) {
    next(error);
  }
});

// GET /api/experiment/participants/:id — get participant
experimentRoutes.get('/participants/:id', async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid participant ID' });

  const row = await queryOne<ParticipantRow>('SELECT * FROM participants WHERE id = $1', [id]);
  if (!row) return res.status(404).json({ error: 'Participant not found' });

  res.json(mapParticipantRow(row));
});

// GET /api/experiment/participants/:id/sessions — get all sessions for a participant
experimentRoutes.get('/participants/:id/sessions', async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid participant ID' });

  const rows = await queryAll<SessionRow>('SELECT * FROM experiment_sessions WHERE participant_id = $1 ORDER BY created_at ASC', [id]);
  res.json(rows.map(mapSessionRow));
});

// POST /api/experiment/sessions — create session using pre-generated summaries
experimentRoutes.post('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  const validation = createSessionSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  const { participantId, articleId } = validation.data;

  try {
    // Look up participant to determine profile
    const participant = await queryOne<ParticipantRow>('SELECT * FROM participants WHERE id = $1', [participantId]);
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    const profileId = EXPERIENCE_TO_PROFILE[participant.experience_level];
    if (!profileId) {
      return res.status(400).json({ error: `No profile mapping for experience level: ${participant.experience_level}` });
    }

    // Verify article exists
    const article = await queryOne<{ id: number }>('SELECT id FROM articles WHERE id = $1', [articleId]);
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // Look up pre-generated summaries
    const genericSummary = await queryOne<{ id: number }>(
      'SELECT id FROM summaries WHERE article_id = $1 AND profile_id = $2',
      [articleId, GENERIC_PROFILE_ID]
    );

    const personalizedSummary = await queryOne<{ id: number }>(
      'SELECT id FROM summaries WHERE article_id = $1 AND profile_id = $2',
      [articleId, profileId]
    );

    if (!genericSummary || !personalizedSummary) {
      return res.status(400).json({
        error: 'Resumos pre-gerados nao encontrados. Execute o script de pre-geracao primeiro: npx tsx packages/api/src/scripts/pregenerate.ts',
        missing: {
          generic: !genericSummary,
          personalized: !personalizedSummary,
          profileId,
        },
      });
    }

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
    `, [participantId, articleId, profileId, genericSummary.id, personalizedSummary.id, JSON.stringify(abOrder)]);

    res.status(201).json(mapSessionRow(sessionRow!));
  } catch (error) {
    next(error);
  }
});

// GET /api/experiment/sessions/:id — get session with both summaries in A/B order
experimentRoutes.get('/sessions/:id', async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  const row = await queryOne<SessionRow>('SELECT * FROM experiment_sessions WHERE id = $1', [id]);
  if (!row) return res.status(404).json({ error: 'Session not found' });

  const session = mapSessionRow(row);
  const abOrder = session.abOrder;

  // Resolve summaries into A/B labels
  const summaryAId = abOrder.A === 'generic' ? session.genericSummaryId : session.personalizedSummaryId;
  const summaryBId = abOrder.B === 'generic' ? session.genericSummaryId : session.personalizedSummaryId;

  const summaryA = await getSummaryById(summaryAId);
  const summaryB = await getSummaryById(summaryBId);

  res.json({
    ...session,
    summaryA: summaryA ? { id: summaryA.id, content: summaryA.content } : null,
    summaryB: summaryB ? { id: summaryB.id, content: summaryB.content } : null,
  });
});

// POST /api/experiment/sessions/:id/preference — record A/B preference
experimentRoutes.post('/sessions/:id/preference', async (req: Request, res: Response, next: NextFunction) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  const validation = preferenceSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  try {
    const result = await execute(
      `UPDATE experiment_sessions SET preference = $1, preference_reason = $2, phase = 'feedback' WHERE id = $3`,
      [validation.data.preference, validation.data.reason || null, id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const row = await queryOne<SessionRow>('SELECT * FROM experiment_sessions WHERE id = $1', [id]);
    res.json(mapSessionRow(row!));
  } catch (error) {
    next(error);
  }
});

// POST /api/experiment/sessions/:id/feedback — submit feedback text, triggers regeneration
experimentRoutes.post('/sessions/:id/feedback', async (req: Request, res: Response, next: NextFunction) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  const validation = feedbackSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  try {
    const sessionRow = await queryOne<SessionRow>('SELECT * FROM experiment_sessions WHERE id = $1', [id]);
    if (!sessionRow) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Regenerate the personalized summary incorporating the feedback
    const regeneratedSummary = await regenerateSummaryWithFeedback(
      sessionRow.personalized_summary_id,
      validation.data.feedbackText
    );

    // Store regeneration record
    const regenRow = await queryOne<RegenerationRow>(`
      INSERT INTO regenerations (session_id, feedback_text, regenerated_summary_id)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [id, validation.data.feedbackText, regeneratedSummary.id]);

    // Update session phase
    await execute(`UPDATE experiment_sessions SET phase = 'regenerated' WHERE id = $1`, [id]);

    res.status(201).json(mapRegenerationRow(regenRow!));
  } catch (error) {
    next(error);
  }
});

// GET /api/experiment/sessions/:id/regenerated — get regenerated summary
experimentRoutes.get('/sessions/:id/regenerated', async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  const regenRow = await queryOne<RegenerationRow>(
    'SELECT * FROM regenerations WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1',
    [id]
  );
  if (!regenRow) {
    return res.status(404).json({ error: 'No regeneration found for this session' });
  }

  const summary = await getSummaryById(regenRow.regenerated_summary_id);
  res.json({
    ...mapRegenerationRow(regenRow),
    summary: summary ? { id: summary.id, content: summary.content } : null,
  });
});

// POST /api/experiment/sessions/:id/rate-regeneration — rate the regenerated summary
experimentRoutes.post('/sessions/:id/rate-regeneration', async (req: Request, res: Response, next: NextFunction) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  const validation = rateRegenerationSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  try {
    // Update the latest regeneration for this session
    const result = await execute(`
      UPDATE regenerations
      SET improvement_rating = $1, utility_rating = $2, clarity_rating = $3, adequacy_rating = $4, change_description = $5
      WHERE session_id = $6 AND id = (
        SELECT id FROM regenerations WHERE session_id = $7 ORDER BY created_at DESC LIMIT 1
      )
    `, [
      validation.data.improvementRating,
      validation.data.utilityRating,
      validation.data.clarityRating,
      validation.data.adequacyRating,
      validation.data.changeDescription || null,
      id,
      id,
    ]);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'No regeneration found for this session' });
    }

    // Update session phase to complete
    await execute(`UPDATE experiment_sessions SET phase = 'complete' WHERE id = $1`, [id]);

    const sessionRow = await queryOne<SessionRow>('SELECT * FROM experiment_sessions WHERE id = $1', [id]);
    res.json(mapSessionRow(sessionRow!));
  } catch (error) {
    next(error);
  }
});

// POST /api/experiment/sessions/:id/ratings — save Likert ratings + preference in a transaction
experimentRoutes.post('/sessions/:id/ratings', async (req: Request, res: Response, next: NextFunction) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  const validation = summaryRatingsSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.errors });

  const client = await getClient();
  try {
    const { ratings, preference } = validation.data;

    await client.query('BEGIN');

    for (const r of ratings) {
      await client.query(
        `INSERT INTO summary_ratings (session_id, summary_id, ab_label, utilidade, clareza, adequacao_perfil, factualidade_percebida, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, r.summaryId, r.abLabel, r.utilidade, r.clareza, r.adequacaoPerfil, r.factualidadePercebida, r.comment || null]
      );
    }

    await client.query(
      `UPDATE experiment_sessions SET preference = $1, phase = 'feedback' WHERE id = $2`,
      [preference, id]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

// POST /api/experiment/post-test — submit post-test responses
experimentRoutes.post('/post-test', async (req: Request, res: Response, next: NextFunction) => {
  const validation = postTestSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.errors });

  try {
    const { participantId, noticedDifference, differenceType, wouldUseDaily, improvements, comments } = validation.data;

    await execute(
      `INSERT INTO post_test_responses (participant_id, noticed_difference, difference_type, would_use_daily, improvements, comments)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [participantId, noticedDifference, differenceType || null, wouldUseDaily, improvements || null, comments || null]
    );

    // Mark all participant sessions as complete
    await execute(
      `UPDATE experiment_sessions SET phase = 'complete' WHERE participant_id = $1`,
      [participantId]
    );

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// GET /api/experiment/articles — list available articles for the experiment
experimentRoutes.get('/articles', async (_req: Request, res: Response) => {
  const rows = await queryAll('SELECT id, title, authors, year FROM articles ORDER BY id ASC');
  res.json(rows);
});

// ─── Internal Types & Mappers ───────────────────────────────────────

interface ParticipantRow {
  id: number;
  name: string;
  experience_level: string;
  years_experience: number;
  reading_frequency: string;
  topic_familiarity: string;
  created_at: string;
}

interface SessionRow {
  id: number;
  participant_id: number;
  article_id: number;
  profile_id: number;
  generic_summary_id: number;
  personalized_summary_id: number;
  ab_order: string;
  preference: string | null;
  preference_reason: string | null;
  phase: string;
  created_at: string;
}

interface RegenerationRow {
  id: number;
  session_id: number;
  feedback_text: string;
  regenerated_summary_id: number;
  improvement_rating: string | null;
  satisfaction_rating: number | null;
  utility_rating: number | null;
  clarity_rating: number | null;
  adequacy_rating: number | null;
  change_description: string | null;
  created_at: string;
}

const mapParticipantRow = (row: ParticipantRow): Participant => ({
  id: row.id,
  name: row.name,
  experienceLevel: row.experience_level as Participant['experienceLevel'],
  yearsExperience: row.years_experience,
  readingFrequency: row.reading_frequency as Participant['readingFrequency'],
  topicFamiliarity: row.topic_familiarity as Participant['topicFamiliarity'],
  createdAt: row.created_at,
});

const mapSessionRow = (row: SessionRow): ExperimentSession => ({
  id: row.id,
  participantId: row.participant_id,
  articleId: row.article_id,
  profileId: row.profile_id,
  genericSummaryId: row.generic_summary_id,
  personalizedSummaryId: row.personalized_summary_id,
  abOrder: JSON.parse(row.ab_order),
  preference: row.preference as ExperimentSession['preference'],
  preferenceReason: row.preference_reason,
  phase: row.phase as ExperimentSession['phase'],
  createdAt: row.created_at,
});

const mapRegenerationRow = (row: RegenerationRow): Regeneration => ({
  id: row.id,
  sessionId: row.session_id,
  feedbackText: row.feedback_text,
  regeneratedSummaryId: row.regenerated_summary_id,
  improvementRating: row.improvement_rating as Regeneration['improvementRating'],
  satisfactionRating: row.satisfaction_rating,
  utilityRating: row.utility_rating,
  clarityRating: row.clarity_rating,
  adequacyRating: row.adequacy_rating,
  changeDescription: row.change_description,
  createdAt: row.created_at,
});
