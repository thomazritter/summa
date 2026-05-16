/**
 * Product-mode profile endpoints.
 *
 * Owns participant onboarding (questionnaire or CV-based), profile
 * inspection/editing, and CV re-inference. Replaces the
 * /api/experiment/{participants,profile,cv-profile,participants/from-cv,
 * profile/refresh-from-cv} endpoints that the deprecated A/B experiment
 * flow used to expose.
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

// ─── Routes ─────────────────────────────────────────────────────────

// POST /api/profile/participants — questionnaire-based registration.
profileRoutes.post('/participants', asyncHandler(async (req: Request, res: Response) => {
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

  const { name, dimensions, experienceLevel, structurePreference, domain, currentProject } = validation.data;

  const row = await queryOne<ParticipantRow>(`
    INSERT INTO participants (
      name, experience_level, years_experience, reading_frequency, topic_familiarity,
      cv_expertise, cv_focus, cv_depth, cv_context,
      structure_preference, domain, current_project, profile_source
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `, [
    name,
    experienceLevel,
    0,
    'sometimes',
    'moderate',
    dimensions.expertise,
    dimensions.focus,
    dimensions.depth,
    dimensions.context,
    structurePreference || null,
    domain?.trim() || null,
    currentProject?.trim() || null,
    'cv',
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

// PUT /api/profile — apply manual overrides.
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

  // The four main dimensions keep cv_X + override_X side by side; the three
  // aux fields share a single value column and a boolean *_manual flag that
  // flips to TRUE the first time the user touches the field, so the UI can
  // show "Editado manualmente" instead of falling back to "Derivado".
  const structureManualFlag = overrides.structurePreference !== undefined ? true : null;
  const domainManualFlag = overrides.domain !== undefined ? true : null;
  const currentProjectManualFlag = overrides.currentProject !== undefined ? true : null;

  await execute(
    `UPDATE participants
     SET override_expertise = COALESCE($1, override_expertise),
         override_focus     = COALESCE($2, override_focus),
         override_depth     = COALESCE($3, override_depth),
         override_context   = COALESCE($4, override_context),
         structure_preference = COALESCE($5, structure_preference),
         domain             = COALESCE($6, domain),
         current_project    = COALESCE($7, current_project),
         structure_preference_manual = COALESCE($8, structure_preference_manual),
         domain_manual               = COALESCE($9, domain_manual),
         current_project_manual      = COALESCE($10, current_project_manual)
     WHERE id = $11`,
    [
      overrides.expertise || null,
      overrides.focus || null,
      overrides.depth || null,
      overrides.context || null,
      overrides.structurePreference || null,
      overrides.domain || null,
      overrides.currentProject || null,
      structureManualFlag,
      domainManualFlag,
      currentProjectManualFlag,
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

// POST /api/profile/reset — clear all manual overrides.
profileRoutes.post('/reset', asyncHandler(async (req: Request, res: Response) => {
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

// POST /api/profile/refresh-from-cv — re-run CV inference and replace cv_*
// values. Manual overrides are preserved (POST /reset clears them).
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
