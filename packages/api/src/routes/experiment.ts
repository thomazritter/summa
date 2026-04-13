import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { queryOne, queryAll, execute, getClient } from '../db/connection.js';
import { parseId, safeJsonParse } from '../utils/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { regenerateSummaryWithFeedback, getSummaryById } from '../services/summarizationService.js';
import { createExperimentSession, SessionCreationError } from '../services/sessionService.js';
import { requireAuth } from '../middleware/auth.js';
import type { ExperimentSession, Participant, Regeneration } from '@summarizer/shared';
import type { ParticipantRow, SessionRow, RegenerationRow } from '../types/rows.js';

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
  structurePreference: z.enum(['prose', 'bullets', 'mixed']).optional(),
  readingGoal: z.enum(['overview', 'methodology', 'results', 'practical']).optional(),
  preferredLength: z.enum(['brief', 'moderate', 'detailed']).optional(),
  englishComfort: z.enum(['keep_english', 'translate']).optional(),
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

// ─── IDOR Ownership Helpers ─────────────────────────────────────────

/** Returns true if the requesting user is a manager OR owns the given participant ID */
function canAccessParticipant(req: Request, participantId: number): boolean {
  return req.accessCode?.role === 'manager' || req.accessCode?.participantId === participantId;
}

/** Looks up session's participant_id and checks ownership. Returns the session row or null. */
async function verifySessionOwnership(req: Request, res: Response, sessionId: number): Promise<SessionRow | null> {
  const session = await queryOne<SessionRow>('SELECT * FROM experiment_sessions WHERE id = $1', [sessionId]);
  if (!session) {
    res.status(404).json({ error: 'Sessao nao encontrada' });
    return null;
  }
  if (!canAccessParticipant(req, session.participant_id)) {
    res.status(403).json({ error: 'Acesso negado' });
    return null;
  }
  return session;
}

// ─── Routes ─────────────────────────────────────────────────────────

// POST /api/experiment/participants — register participant with pre-test data
experimentRoutes.post('/participants', asyncHandler(async (req: Request, res: Response) => {
  const validation = registerParticipantSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  const { name, experienceLevel, yearsExperience, readingFrequency, topicFamiliarity, structurePreference, readingGoal, preferredLength, englishComfort } = validation.data;

  const row = await queryOne<ParticipantRow>(`
    INSERT INTO participants (name, experience_level, years_experience, reading_frequency, topic_familiarity, structure_preference, reading_goal, preferred_length, english_comfort)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [name, experienceLevel, yearsExperience, readingFrequency, topicFamiliarity, structurePreference || null, readingGoal || null, preferredLength || null, englishComfort || null]);

  if (!row) return res.status(500).json({ error: 'Falha ao criar registro' });

  // Link participant to access code
  const accessCode = req.headers['x-access-code'] as string;
  if (accessCode) {
    await execute('UPDATE access_codes SET participant_id = $1 WHERE code = $2', [row.id, accessCode]);
  }

  res.status(201).json(mapParticipantRow(row));
}));

// GET /api/experiment/participants/:id — get participant
experimentRoutes.get('/participants/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid participant ID' });

  // IDOR check: participants can only access their own data
  if (!canAccessParticipant(req, id)) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const row = await queryOne<ParticipantRow>('SELECT * FROM participants WHERE id = $1', [id]);
  if (!row) return res.status(404).json({ error: 'Participant not found' });

  res.json(mapParticipantRow(row));
}));

// GET /api/experiment/participants/:id/sessions — get all sessions for a participant
experimentRoutes.get('/participants/:id/sessions', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid participant ID' });

  // IDOR check: participants can only access their own sessions
  if (!canAccessParticipant(req, id)) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const rows = await queryAll<SessionRow>('SELECT * FROM experiment_sessions WHERE participant_id = $1 ORDER BY created_at ASC', [id]);
  res.json(rows.map(mapSessionRow));
}));

// POST /api/experiment/sessions — create session with on-demand summary generation
experimentRoutes.post('/sessions', asyncHandler(async (req: Request, res: Response) => {
  const validation = createSessionSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  try {
    const { sessionRow, isExisting } = await createExperimentSession(
      validation.data.participantId,
      validation.data.articleId,
    );
    res.status(isExisting ? 200 : 201).json(mapSessionRow(sessionRow));
  } catch (error) {
    if (error instanceof SessionCreationError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    throw error;
  }
}));

// GET /api/experiment/sessions/:id — get session with both summaries in A/B order
experimentRoutes.get('/sessions/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  const row = await verifySessionOwnership(req, res, id);
  if (!row) return; // response already sent by helper

  const mappedSession = mapSessionRow(row);
  const abOrder = mappedSession.abOrder;

  // Resolve summaries into A/B labels
  const summaryAId = abOrder.A === 'generic' ? mappedSession.genericSummaryId : mappedSession.personalizedSummaryId;
  const summaryBId = abOrder.B === 'generic' ? mappedSession.genericSummaryId : mappedSession.personalizedSummaryId;

  const summaryA = await getSummaryById(summaryAId);
  const summaryB = await getSummaryById(summaryBId);

  // Exclude abOrder from participant-facing response to preserve blinding
  // (managers can see abOrder via /api/manager/participants)
  const { abOrder: _abOrder, ...sessionWithoutOrder } = mappedSession;
  res.json({
    ...sessionWithoutOrder,
    summaryA: summaryA ? { id: summaryA.id, content: summaryA.content } : null,
    summaryB: summaryB ? { id: summaryB.id, content: summaryB.content } : null,
  });
}));

// POST /api/experiment/sessions/:id/preference — record A/B preference
experimentRoutes.post('/sessions/:id/preference', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  // IDOR check
  const sessionCheck = await verifySessionOwnership(req, res, id);
  if (!sessionCheck) return;

  const validation = preferenceSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  const result = await execute(
    `UPDATE experiment_sessions SET preference = $1, preference_reason = $2, phase = 'feedback' WHERE id = $3`,
    [validation.data.preference, validation.data.reason || null, id]
  );

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const row = await queryOne<SessionRow>('SELECT * FROM experiment_sessions WHERE id = $1', [id]);
  if (!row) return res.status(500).json({ error: 'Falha ao criar registro' });
  res.json(mapSessionRow(row));
}));

// POST /api/experiment/sessions/:id/evaluate — single-step evaluation (Phase 1 simplified)
experimentRoutes.post('/sessions/:id/evaluate', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  // IDOR check
  const sessionCheck = await verifySessionOwnership(req, res, id);
  if (!sessionCheck) return;

  const evaluateSchema = z.object({
    preference: z.enum(['A', 'B']),
    rating: z.number().int().min(1).max(10),
    comment: z.string().max(5000).optional(),
  });

  const validation = evaluateSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  const { preference, rating, comment } = validation.data;

  // Idempotency: if already evaluated, return session as-is
  const session = await queryOne<SessionRow>('SELECT * FROM experiment_sessions WHERE id = $1', [id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.preference) {
    return res.json(mapSessionRow(session));
  }

  // Update session with preference, rating, comment, and mark complete
  await execute(
    'UPDATE experiment_sessions SET preference = $1, preference_rating = $2, preference_reason = $3, phase = $4 WHERE id = $5',
    [preference, rating, comment || null, 'complete', id]
  );

  const updated = await queryOne<SessionRow>('SELECT * FROM experiment_sessions WHERE id = $1', [id]);
  if (!updated) return res.status(500).json({ error: 'Falha ao criar registro' });
  res.json(mapSessionRow(updated));
}));

// POST /api/experiment/sessions/:id/feedback — submit feedback text, triggers regeneration
experimentRoutes.post('/sessions/:id/feedback', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  // IDOR check
  const sessionCheck = await verifySessionOwnership(req, res, id);
  if (!sessionCheck) return;

  const validation = feedbackSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  // Idempotency: if a regeneration already exists for this session, return it
  const existingRegen = await queryOne<RegenerationRow>(
    'SELECT * FROM regenerations WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1',
    [id]
  );
  if (existingRegen) {
    return res.json({ ...mapRegenerationRow(existingRegen), alreadySubmitted: true });
  }

  // Session already verified by ownership check above
  const sessionRow = sessionCheck;

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

  if (!regenRow) return res.status(500).json({ error: 'Falha ao criar registro' });

  // Update session phase
  await execute(`UPDATE experiment_sessions SET phase = 'regenerated' WHERE id = $1`, [id]);

  res.status(201).json(mapRegenerationRow(regenRow));
}));

// GET /api/experiment/sessions/:id/regenerated — get regenerated summary
experimentRoutes.get('/sessions/:id/regenerated', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  // IDOR check
  const sessionCheck = await verifySessionOwnership(req, res, id);
  if (!sessionCheck) return;

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
}));

// POST /api/experiment/sessions/:id/rate-regeneration — rate the regenerated summary
experimentRoutes.post('/sessions/:id/rate-regeneration', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  const validation = rateRegenerationSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  // Idempotency: if the regeneration is already rated, return the session
  const existingRegen = await queryOne<RegenerationRow>(
    'SELECT * FROM regenerations WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1',
    [id]
  );
  if (existingRegen && existingRegen.improvement_rating !== null) {
    const sessionRow = await queryOne<SessionRow>('SELECT * FROM experiment_sessions WHERE id = $1', [id]);
    if (sessionRow) return res.json(mapSessionRow(sessionRow));
  }

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
  if (!sessionRow) return res.status(500).json({ error: 'Falha ao criar registro' });
  res.json(mapSessionRow(sessionRow));
}));

// POST /api/experiment/sessions/:id/ratings — save Likert ratings + preference in a transaction
experimentRoutes.post('/sessions/:id/ratings', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  const validation = summaryRatingsSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.errors });

  // Idempotency: if ratings already exist for this session, return success
  const existingRatings = await queryOne(
    'SELECT id FROM summary_ratings WHERE session_id = $1',
    [id]
  );
  if (existingRatings) {
    const session = await queryOne<SessionRow>('SELECT * FROM experiment_sessions WHERE id = $1', [id]);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    return res.json(mapSessionRow(session));
  }

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
    throw error;
  } finally {
    client.release();
  }
}));

// POST /api/experiment/post-test — submit post-test responses
experimentRoutes.post('/post-test', asyncHandler(async (req: Request, res: Response) => {
  const validation = postTestSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.errors });

  const { participantId, noticedDifference, differenceType, wouldUseDaily, improvements, comments } = validation.data;

  // Idempotency: if post-test already submitted for this participant, return success
  const existingPostTest = await queryOne(
    'SELECT id FROM post_test_responses WHERE participant_id = $1',
    [participantId]
  );
  if (existingPostTest) {
    return res.json({ success: true, alreadySubmitted: true });
  }

  await execute(
    `INSERT INTO post_test_responses (participant_id, noticed_difference, difference_type, would_use_daily, improvements, comments)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [participantId, noticedDifference, differenceType || null, wouldUseDaily, improvements || null, comments || null]
  );

  // Mark only evaluated sessions as complete (sessions that have a preference recorded)
  await execute(
    `UPDATE experiment_sessions SET phase = 'complete' WHERE participant_id = $1 AND preference IS NOT NULL`,
    [participantId]
  );

  res.json({ success: true });
}));

// GET /api/experiment/articles — list available articles for the experiment
experimentRoutes.get('/articles', asyncHandler(async (_req: Request, res: Response) => {
  const rows = await queryAll('SELECT id, title, authors, year, url FROM articles ORDER BY id ASC');
  res.json(rows);
}));

// ─── Mappers ────────────────────────────────────────────────────────

const mapParticipantRow = (row: ParticipantRow): Participant => ({
  id: row.id,
  name: row.name,
  experienceLevel: row.experience_level as Participant['experienceLevel'],
  yearsExperience: row.years_experience,
  readingFrequency: row.reading_frequency as Participant['readingFrequency'],
  topicFamiliarity: row.topic_familiarity as Participant['topicFamiliarity'],
  structurePreference: row.structure_preference as Participant['structurePreference'],
  readingGoal: row.reading_goal as Participant['readingGoal'],
  preferredLength: row.preferred_length as Participant['preferredLength'],
  englishComfort: row.english_comfort as Participant['englishComfort'],
  createdAt: row.created_at,
});

const mapSessionRow = (row: SessionRow): ExperimentSession => ({
  id: row.id,
  participantId: row.participant_id,
  articleId: row.article_id,
  profileId: row.profile_id,
  genericSummaryId: row.generic_summary_id,
  personalizedSummaryId: row.personalized_summary_id,
  abOrder: safeJsonParse<ExperimentSession['abOrder']>(row.ab_order) ?? { A: 'generic' as const, B: 'personalized' as const },
  preference: row.preference as ExperimentSession['preference'],
  preferenceRating: row.preference_rating,
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
