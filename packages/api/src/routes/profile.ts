/**
 * Product-mode profile endpoints.
 *
 * Owns participant onboarding (questionnaire or CV-based), profile
 * inspection/editing, and CV re-inference. Backend data model is a single
 * flat profile per participant: four dimensions (`expertise`/`focus`/
 * `depth`/`context`), each with a `_manual` boolean flag for source
 * tracking, plus three auxiliary preferences (`structure_preference`,
 * `domain`, `current_project`) each with their own `_manual` flag.
 * Questionnaire and CV are frontend input paths that write into the same
 * columns — no override/cv split at the data layer.
 *
 * Mounted at /api/profile. Auth is enforced at the router level so every
 * handler can read req.accessCode.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { queryOne, execute } from '../db/connection.js';
import { parseId, zodErrorMessage } from '../utils/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { inferProfileFromCv } from '../services/cvProfileMapper.js';
import {
  computeProfileSources,
  serializeProfileForApi,
} from '../services/profileService.js';
import { requireAuth } from '../middleware/auth.js';
import { createPdfUpload, createMulterErrorHandler } from '../utils/multerHelpers.js';
import type { Participant } from '@summarizer/shared';
import type { ParticipantRow } from '../types/rows.js';

export const profileRoutes = Router();

profileRoutes.use(requireAuth);

const MAX_CV_SIZE = 5 * 1024 * 1024; // 5MB
const cvUpload = createPdfUpload(MAX_CV_SIZE, 'Apenas arquivos PDF sao permitidos');
const handleCvMulterError = createMulterErrorHandler(MAX_CV_SIZE);

// ─── Validation Schemas ─────────────────────────────────────────────

const dimensionsSchema = z.object({
  expertise: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
  focus: z.enum(['concepts', 'methodology', 'results', 'applications', 'all']),
  depth: z.enum(['brief', 'moderate', 'detailed', 'comprehensive']),
  context: z.enum(['quick_review', 'learning', 'research', 'teaching']),
});

const registerParticipantSchema = z.object({
  name: z.string().min(1).max(255),
  expertise: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
  focus: z.enum(['concepts', 'methodology', 'results', 'applications', 'all']),
  depth: z.enum(['brief', 'moderate', 'detailed', 'comprehensive']),
  context: z.enum(['quick_review', 'learning', 'research', 'teaching']),
  structurePreference: z.enum(['prose', 'bullets', 'mixed']).optional(),
  domain: z.string().max(500).optional(),
  currentProject: z.string().max(2000).optional(),
});

const registerFromCvSchema = z.object({
  name: z.string().min(1).max(255),
  dimensions: dimensionsSchema,
  structurePreference: z.enum(['prose', 'bullets', 'mixed']).optional(),
  domain: z.string().max(500).optional(),
  currentProject: z.string().max(2000).optional(),
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

// ─── Mappers ────────────────────────────────────────────────────────

const mapParticipantRow = (row: ParticipantRow): Participant => ({
  id: row.id,
  name: row.name,
  expertise: row.expertise as Participant['expertise'],
  focus: row.focus as Participant['focus'],
  depth: row.depth as Participant['depth'],
  context: row.context as Participant['context'],
  structurePreference: row.structure_preference as Participant['structurePreference'],
  domain: row.domain,
  currentProject: row.current_project,
  createdAt: row.created_at,
});

// ─── Routes ─────────────────────────────────────────────────────────

// POST /api/profile/participants — questionnaire-based registration.
profileRoutes.post('/participants', asyncHandler(async (req: Request, res: Response) => {
  const validation = registerParticipantSchema.safeParse(req.body);
  if (!validation.success) {
    const messages = zodErrorMessage(validation.error);
    return res.status(400).json({ error: `Dados inválidos: ${messages}` });
  }

  const { name, expertise, focus, depth, context, structurePreference, domain, currentProject } = validation.data;

  const row = await queryOne<ParticipantRow>(`
    INSERT INTO participants (
      name, expertise, focus, depth, context,
      structure_preference, domain, current_project,
      profile_source
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'questionnaire')
    RETURNING *
  `, [
    name,
    expertise,
    focus,
    depth,
    context,
    structurePreference || null,
    domain?.trim() || null,
    currentProject?.trim() || null,
  ]);

  if (!row) return res.status(500).json({ error: 'Falha ao criar registro' });

  const accessCode = req.headers['x-access-code'] as string;
  if (accessCode) {
    await execute('UPDATE access_codes SET participant_id = $1 WHERE code = $2', [row.id, accessCode]);
  }

  res.status(201).json(mapParticipantRow(row));
}));

// GET /api/profile/participants/:id — fetch a single participant row.
// Participants can only see their own (IDOR check via access code).
profileRoutes.get('/participants/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid participant ID' });

  if (req.accessCode?.participantId !== id) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const row = await queryOne<ParticipantRow>('SELECT * FROM participants WHERE id = $1', [id]);
  if (!row) return res.status(404).json({ error: 'Participant not found' });

  res.json(mapParticipantRow(row));
}));

// POST /api/profile/cv — upload CV PDF, infer profile, do NOT persist.
// Powers the CV preview step before registration.
profileRoutes.post('/cv', cvUpload.single('file'), handleCvMulterError, asyncHandler(async (req: Request, res: Response) => {
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

// POST /api/profile/participants/from-cv — create participant from CV-inferred profile.
profileRoutes.post('/participants/from-cv', asyncHandler(async (req: Request, res: Response) => {
  const validation = registerFromCvSchema.safeParse(req.body);
  if (!validation.success) {
    const messages = zodErrorMessage(validation.error);
    return res.status(400).json({ error: `Dados inválidos: ${messages}` });
  }

  const { name, dimensions, structurePreference, domain, currentProject } = validation.data;

  const row = await queryOne<ParticipantRow>(`
    INSERT INTO participants (
      name, expertise, focus, depth, context,
      structure_preference, domain, current_project,
      profile_source
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'cv')
    RETURNING *
  `, [
    name,
    dimensions.expertise,
    dimensions.focus,
    dimensions.depth,
    dimensions.context,
    structurePreference || null,
    domain?.trim() || null,
    currentProject?.trim() || null,
  ]);

  if (!row) return res.status(500).json({ error: 'Falha ao criar registro' });

  const accessCode = req.headers['x-access-code'] as string;
  if (accessCode) {
    await execute('UPDATE access_codes SET participant_id = $1 WHERE code = $2', [row.id, accessCode]);
  }

  res.status(201).json(mapParticipantRow(row));
}));

// GET /api/profile — current participant's profile with per-dimension sources.
profileRoutes.get('/', asyncHandler(async (req: Request, res: Response) => {
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

// PUT /api/profile — apply manual overrides. Any dimension or aux field
// touched by this call gets its `_manual` flag flipped to TRUE so the UI
// shows "Editado manualmente" on the corresponding row.
profileRoutes.put('/', asyncHandler(async (req: Request, res: Response) => {
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

  await execute(
    `UPDATE participants
     SET expertise        = COALESCE($1, expertise),
         focus            = COALESCE($2, focus),
         depth            = COALESCE($3, depth),
         context          = COALESCE($4, context),
         expertise_manual = expertise_manual OR ($1 IS NOT NULL),
         focus_manual     = focus_manual     OR ($2 IS NOT NULL),
         depth_manual     = depth_manual     OR ($3 IS NOT NULL),
         context_manual   = context_manual   OR ($4 IS NOT NULL),
         structure_preference        = COALESCE($5, structure_preference),
         domain                      = COALESCE($6, domain),
         current_project             = COALESCE($7, current_project),
         structure_preference_manual = structure_preference_manual OR ($5 IS NOT NULL),
         domain_manual               = domain_manual               OR ($6 IS NOT NULL),
         current_project_manual      = current_project_manual      OR ($7 IS NOT NULL)
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

// POST /api/profile/refresh-from-cv — re-run CV inference and replace
// dimensions in place. Resets `_manual` flags to false on every dimension
// it overwrites, since the new values came from the CV, not manual edit.
profileRoutes.post(
  '/refresh-from-cv',
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

    const { dimensions, domain } = outcome.profile;

    await execute(
      `UPDATE participants
       SET expertise        = $1,
           focus            = $2,
           depth            = $3,
           context          = $4,
           expertise_manual = false,
           focus_manual     = false,
           depth_manual     = false,
           context_manual   = false,
           domain           = COALESCE($5, domain),
           profile_source   = 'cv'
       WHERE id = $6`,
      [
        dimensions.expertise,
        dimensions.focus,
        dimensions.depth,
        dimensions.context,
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
