import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { queryOne, queryAll, execute, getClient } from '../db/connection.js';
import { parseId, safeJsonParse, zodErrorMessage } from '../utils/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { regenerateSummaryWithEvidence, getSummaryById, generatePersonalizedSummary, NotFoundError, NoFlaggedSentencesError, SummarizationError } from '../services/summarizationService.js';
import type { ProfileDimensions } from '../services/summarizationService.js';
import { createExperimentSession, SessionCreationError, computeProfileDimensions, computeProfileSources, serializeProfileForApi, buildPersonalizationContext, EXPERIENCE_CONFIG } from '../services/sessionService.js';
import { AVAILABLE_MODELS, getActiveModel } from '../services/groqClient.js';
import { inferProfileFromCv } from '../services/cvProfileMapper.js';
import { requireAuth } from '../middleware/auth.js';
import { createPdfUpload, createMulterErrorHandler } from '../utils/multerHelpers.js';
import type { ExperimentSession, Participant, Regeneration } from '@summarizer/shared';
import type { ParticipantRow, SessionRow } from '../types/rows.js';

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
});

const createSessionSchema = z.object({
  participantId: z.number().int().positive(),
  articleId: z.number().int().positive(),
});

const preferenceSchema = z.object({
  preference: z.enum(['A', 'B']),
  reason: z.string().max(5000).optional(),
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

const updateProfileSchema = z.object({
  overrides: z.object({
    expertise: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
    focus: z.enum(['concepts', 'methodology', 'results', 'applications', 'all']).optional(),
    depth: z.enum(['brief', 'moderate', 'detailed', 'comprehensive']).optional(),
    context: z.enum(['quick_review', 'learning', 'research', 'teaching']).optional(),
    structurePreference: z.enum(['prose', 'bullets', 'mixed']).optional(),
    domain: z.string().max(500).optional(),
    currentProject: z.string().max(2000).optional(),
  }),
});

const registerFromCvSchema = z.object({
  name: z.string().min(1).max(255),
  dimensions: z.object({
    expertise: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
    focus: z.enum(['concepts', 'methodology', 'results', 'applications', 'all']),
    depth: z.enum(['brief', 'moderate', 'detailed', 'comprehensive']),
    context: z.enum(['quick_review', 'learning', 'research', 'teaching']),
  }),
  experienceLevel: z.enum(['junior', 'pleno', 'senior']),
  structurePreference: z.enum(['prose', 'bullets', 'mixed']).optional(),
});

// ─── CV Upload (Multer) ────────────────────────────────────────────

const MAX_CV_SIZE = 5 * 1024 * 1024; // 5MB

const cvUpload = createPdfUpload(MAX_CV_SIZE, 'Apenas arquivos PDF sao permitidos');
const handleCvMulterError = createMulterErrorHandler(MAX_CV_SIZE);

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
    const messages = zodErrorMessage(validation.error);
    return res.status(400).json({ error: `Dados inválidos: ${messages}` });
  }

  const { name, experienceLevel, yearsExperience, readingFrequency, topicFamiliarity, structurePreference, readingGoal, preferredLength } = validation.data;

  const row = await queryOne<ParticipantRow>(`
    INSERT INTO participants (name, experience_level, years_experience, reading_frequency, topic_familiarity, structure_preference, reading_goal, preferred_length)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [name, experienceLevel, yearsExperience, readingFrequency, topicFamiliarity, structurePreference || null, readingGoal || null, preferredLength || null]);

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
    const messages = zodErrorMessage(validation.error);
    return res.status(400).json({ error: `Dados inválidos: ${messages}` });
  }

  // IDOR check: verify the authenticated user owns this participant
  if (!canAccessParticipant(req, validation.data.participantId)) {
    return res.status(403).json({ error: 'Acesso negado' });
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
    const messages = zodErrorMessage(validation.error);
    return res.status(400).json({ error: `Dados inválidos: ${messages}` });
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
    const messages = zodErrorMessage(validation.error);
    return res.status(400).json({ error: `Dados inválidos: ${messages}` });
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

// POST /api/experiment/sessions/:id/ratings — save Likert ratings + preference in a transaction
experimentRoutes.post('/sessions/:id/ratings', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  // IDOR check
  const sessionCheck = await verifySessionOwnership(req, res, id);
  if (!sessionCheck) return;

  const validation = summaryRatingsSchema.safeParse(req.body);
  if (!validation.success) {
    const messages = zodErrorMessage(validation.error);
    return res.status(400).json({ error: `Dados inválidos: ${messages}` });
  }

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
  if (!validation.success) {
    const messages = zodErrorMessage(validation.error);
    return res.status(400).json({ error: `Dados inválidos: ${messages}` });
  }

  const { participantId, noticedDifference, differenceType, wouldUseDaily, improvements, comments } = validation.data;

  // IDOR check: verify the authenticated user owns this participant
  const authParticipantId = req.accessCode?.participantId;
  if (!authParticipantId || authParticipantId !== participantId) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

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

// ─── CV-Based Cold Start ───────────────────────────────────────────

// POST /api/experiment/cv-profile — upload CV PDF, infer profile (does NOT save to DB)
experimentRoutes.post('/cv-profile', cvUpload.single('file'), handleCvMulterError, asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo PDF enviado' });
  }

  const outcome = await inferProfileFromCv(req.file.buffer);

  switch (outcome.kind) {
    case 'ok':
      return res.json(outcome.profile);
    case 'not_cv':
      return res.status(422).json({
        error: `O documento enviado nao parece ser um curriculo profissional. ${outcome.reason}`,
        kind: 'not_cv',
      });
    case 'insufficient_text':
      return res.status(422).json({
        error: 'O PDF enviado contem pouco ou nenhum texto extraivel. Verifique se o arquivo nao e uma imagem digitalizada e tente novamente.',
        kind: 'insufficient_text',
      });
    case 'parse_failed':
      return res.status(422).json({
        error: 'Nao foi possivel inferir o perfil a partir do curriculo. Tente um PDF com seu historico profissional em formato textual.',
        kind: 'parse_failed',
      });
  }
}));

// POST /api/experiment/participants/from-cv — create participant from CV-inferred profile
experimentRoutes.post('/participants/from-cv', asyncHandler(async (req: Request, res: Response) => {
  const validation = registerFromCvSchema.safeParse(req.body);
  if (!validation.success) {
    const messages = zodErrorMessage(validation.error);
    return res.status(400).json({ error: `Dados inválidos: ${messages}` });
  }

  const { name, dimensions, experienceLevel, structurePreference } = validation.data;

  const row = await queryOne<ParticipantRow>(`
    INSERT INTO participants (
      name, experience_level, years_experience, reading_frequency, topic_familiarity,
      cv_expertise, cv_focus, cv_depth, cv_context,
      structure_preference, profile_source
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `, [
    name,
    experienceLevel,
    0,            // years_experience: not available from CV, default to 0
    'sometimes',  // reading_frequency: sensible default for CV-based registration
    'moderate',   // topic_familiarity: sensible default for CV-based registration
    dimensions.expertise,
    dimensions.focus,
    dimensions.depth,
    dimensions.context,
    structurePreference || null,
    'cv',
  ]);

  if (!row) return res.status(500).json({ error: 'Falha ao criar registro' });

  // Link participant to access code (same pattern as questionnaire registration)
  const accessCode = req.headers['x-access-code'] as string;
  if (accessCode) {
    await execute('UPDATE access_codes SET participant_id = $1 WHERE code = $2', [row.id, accessCode]);
  }

  res.status(201).json(mapParticipantRow(row));
}));

// ─── Profile Endpoints ─────────────────────────────────────────────

// GET /api/experiment/profile — get computed profile with sources
experimentRoutes.get('/profile', asyncHandler(async (req: Request, res: Response) => {
  const participantId = req.accessCode?.participantId;
  if (!participantId) {
    return res.status(400).json({ error: 'Nenhum participante vinculado a este codigo de acesso' });
  }

  const participant = await queryOne<ParticipantRow>('SELECT * FROM participants WHERE id = $1', [participantId]);
  if (!participant) {
    return res.status(404).json({ error: 'Participante nao encontrado' });
  }

  res.json({
    dimensions: serializeProfileForApi(participant),
    sources: computeProfileSources(participant),
    profileSource: participant.profile_source || 'questionnaire',
  });
}));

// PUT /api/experiment/profile — update profile overrides
experimentRoutes.put('/profile', asyncHandler(async (req: Request, res: Response) => {
  const participantId = req.accessCode?.participantId;
  if (!participantId) {
    return res.status(400).json({ error: 'Nenhum participante vinculado a este codigo de acesso' });
  }

  const validation = updateProfileSchema.safeParse(req.body);
  if (!validation.success) {
    const messages = zodErrorMessage(validation.error);
    return res.status(400).json({ error: `Dados inválidos: ${messages}` });
  }

  const { overrides } = validation.data;

  // Save dimension overrides to override columns
  await execute(
    `UPDATE participants
     SET override_expertise = COALESCE($1, override_expertise),
         override_focus     = COALESCE($2, override_focus),
         override_depth     = COALESCE($3, override_depth),
         override_context   = COALESCE($4, override_context),
         structure_preference = COALESCE($5, structure_preference),
         domain             = COALESCE($6, domain),
         current_project    = COALESCE($7, current_project)
     WHERE id = $8`,
    [
      overrides.expertise || null,
      overrides.focus || null,
      overrides.depth || null,
      overrides.context || null,
      overrides.structurePreference || null,
      overrides.domain || null,
      overrides.currentProject || null,
      participantId,
    ],
  );

  // Return the updated profile
  const participant = await queryOne<ParticipantRow>('SELECT * FROM participants WHERE id = $1', [participantId]);
  if (!participant) {
    return res.status(404).json({ error: 'Participante nao encontrado' });
  }

  res.json({
    dimensions: serializeProfileForApi(participant),
    sources: computeProfileSources(participant),
    profileSource: participant.profile_source || 'questionnaire',
  });
}));

// POST /api/experiment/profile/reset — reset all manual overrides
experimentRoutes.post('/profile/reset', asyncHandler(async (req: Request, res: Response) => {
  const participantId = req.accessCode?.participantId;
  if (!participantId) {
    return res.status(400).json({ error: 'Nenhum participante vinculado a este codigo de acesso' });
  }

  await execute(
    `UPDATE participants
     SET override_expertise = NULL,
         override_focus     = NULL,
         override_depth     = NULL,
         override_context   = NULL,
         domain             = NULL,
         current_project    = NULL
     WHERE id = $1`,
    [participantId],
  );

  const participant = await queryOne<ParticipantRow>('SELECT * FROM participants WHERE id = $1', [participantId]);
  if (!participant) {
    return res.status(404).json({ error: 'Participante nao encontrado' });
  }

  res.json({
    dimensions: serializeProfileForApi(participant),
    sources: computeProfileSources(participant),
    profileSource: participant.profile_source || 'questionnaire',
  });
}));

// POST /api/experiment/profile/refresh-from-cv
// Re-runs CV inference for the current participant and replaces the cv_*
// values. Manual overrides (override_*) are preserved; the UI can still
// reset them via POST /profile/reset if the user wants the new CV values
// to take effect.
experimentRoutes.post(
  '/profile/refresh-from-cv',
  cvUpload.single('file'),
  handleCvMulterError,
  asyncHandler(async (req: Request, res: Response) => {
    const participantId = req.accessCode?.participantId;
    if (!participantId) {
      return res.status(400).json({ error: 'Nenhum participante vinculado a este codigo de acesso' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo PDF enviado' });
    }

    const outcome = await inferProfileFromCv(req.file.buffer);
    switch (outcome.kind) {
      case 'not_cv':
        return res.status(422).json({
          error: `O documento enviado nao parece ser um curriculo profissional. ${outcome.reason}`,
          kind: 'not_cv',
        });
      case 'insufficient_text':
        return res.status(422).json({
          error: 'O PDF enviado contem pouco ou nenhum texto extraivel. Verifique se o arquivo nao e uma imagem digitalizada e tente novamente.',
          kind: 'insufficient_text',
        });
      case 'parse_failed':
        return res.status(422).json({
          error: 'Nao foi possivel inferir o perfil a partir do curriculo. Tente um PDF com seu historico profissional em formato textual.',
          kind: 'parse_failed',
        });
    }

    const { dimensions, experienceLevel, domain } = outcome.profile;

    await execute(
      `UPDATE participants
       SET cv_expertise = $1,
           cv_focus     = $2,
           cv_depth     = $3,
           cv_context   = $4,
           experience_level = $5,
           domain       = COALESCE($6, domain),
           profile_source = 'cv'
       WHERE id = $7`,
      [
        dimensions.expertise,
        dimensions.focus,
        dimensions.depth,
        dimensions.context,
        experienceLevel,
        domain,
        participantId,
      ],
    );

    const participant = await queryOne<ParticipantRow>('SELECT * FROM participants WHERE id = $1', [participantId]);
    if (!participant) {
      return res.status(404).json({ error: 'Participante nao encontrado' });
    }

    res.json({
      dimensions: serializeProfileForApi(participant),
      sources: computeProfileSources(participant),
      profileSource: participant.profile_source || 'questionnaire',
    });
  }),
);

// GET /api/experiment/articles — list available articles for the experiment
experimentRoutes.get('/articles', asyncHandler(async (_req: Request, res: Response) => {
  const rows = await queryAll('SELECT id, title, authors, year, url FROM articles ORDER BY id ASC');
  res.json(rows);
}));

// ─── Guided Regeneration by Factuality ────────────────────────────

// POST /api/experiment/summaries/:id/regenerate-with-evidence
// Re-runs the summary using NLI evidence: feeds flagged sentences and their
// anchor paragraphs back to the LLM with a lower temperature.
experimentRoutes.post('/summaries/:id/regenerate-with-evidence', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid summary ID' });

  // Ownership check: managers always pass; otherwise the caller must own a session
  // tied to this summary (either as personalized, generic, or regenerated summary).
  if (req.accessCode?.role !== 'manager') {
    const participantId = req.accessCode?.participantId;
    if (!participantId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const owns = await queryOne<{ id: number }>(
      `SELECT es.id FROM experiment_sessions es
       LEFT JOIN regenerations r ON r.session_id = es.id
       WHERE es.participant_id = $1
         AND (
           es.personalized_summary_id = $2
           OR es.generic_summary_id = $2
           OR r.regenerated_summary_id = $2
         )
       LIMIT 1`,
      [participantId, id],
    );

    if (!owns) {
      const uploaded = await queryOne<{ id: number }>(
        `SELECT a.id FROM articles a
         JOIN summaries s ON s.article_id = a.id
         WHERE s.id = $1 AND a.uploaded_by = $2
         LIMIT 1`,
        [id, participantId],
      );
      if (!uploaded) {
        return res.status(403).json({ error: 'Acesso negado' });
      }
    }
  }

  try {
    const summary = await regenerateSummaryWithEvidence(id);
    res.status(201).json({
      id: summary.id,
      articleId: summary.articleId,
      profileId: summary.profileId,
      content: summary.content,
      modelId: summary.modelId,
      factualityScore: summary.factualityScore,
      factualityDetails: summary.factualityDetails,
      parentSummaryId: summary.parentSummaryId,
      generatedAt: summary.generatedAt,
    });
  } catch (error) {
    if (error instanceof NoFlaggedSentencesError) {
      return res.status(400).json({ error: error.message });
    }
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof SummarizationError) {
      return res.status(502).json({ error: error.message });
    }
    throw error;
  }
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
  domain: row.domain,
  currentProject: row.current_project,
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

