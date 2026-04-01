import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { parseId } from '../utils/validation.js';
import { regenerateSummaryWithFeedback, getSummaryById } from '../services/summarizationService.js';
import type { ExperimentSession, Participant, Regeneration } from '@summarizer/shared';

export const experimentRoutes = Router();

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
});

const feedbackSchema = z.object({
  feedbackText: z.string().min(1).max(5000),
});

const rateRegenerationSchema = z.object({
  improvementRating: z.enum(['improved', 'same', 'worse']),
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
experimentRoutes.post('/participants', (req: Request, res: Response, next: NextFunction) => {
  const validation = registerParticipantSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  const { name, experienceLevel, yearsExperience, readingFrequency, topicFamiliarity } = validation.data;

  try {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO participants (name, experience_level, years_experience, reading_frequency, topic_familiarity)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, experienceLevel, yearsExperience, readingFrequency, topicFamiliarity);

    const row = db.prepare('SELECT * FROM participants WHERE id = ?').get(result.lastInsertRowid) as ParticipantRow;
    res.status(201).json(mapParticipantRow(row));
  } catch (error) {
    next(error);
  }
});

// GET /api/experiment/participants/:id — get participant
experimentRoutes.get('/participants/:id', (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid participant ID' });

  const db = getDb();
  const row = db.prepare('SELECT * FROM participants WHERE id = ?').get(id) as ParticipantRow | undefined;
  if (!row) return res.status(404).json({ error: 'Participant not found' });

  res.json(mapParticipantRow(row));
});

// GET /api/experiment/participants/:id/sessions — get all sessions for a participant
experimentRoutes.get('/participants/:id/sessions', (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid participant ID' });

  const db = getDb();
  const rows = db.prepare('SELECT * FROM experiment_sessions WHERE participant_id = ? ORDER BY created_at ASC').all(id) as SessionRow[];
  res.json(rows.map(mapSessionRow));
});

// POST /api/experiment/sessions — create session using pre-generated summaries
experimentRoutes.post('/sessions', (req: Request, res: Response, next: NextFunction) => {
  const validation = createSessionSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  const { participantId, articleId } = validation.data;

  try {
    const db = getDb();

    // Look up participant to determine profile
    const participant = db.prepare('SELECT * FROM participants WHERE id = ?').get(participantId) as ParticipantRow | undefined;
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    const profileId = EXPERIENCE_TO_PROFILE[participant.experience_level];
    if (!profileId) {
      return res.status(400).json({ error: `No profile mapping for experience level: ${participant.experience_level}` });
    }

    // Verify article exists
    const article = db.prepare('SELECT id FROM articles WHERE id = ?').get(articleId);
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // Look up pre-generated summaries
    const genericSummary = db.prepare(
      'SELECT id FROM summaries WHERE article_id = ? AND profile_id = ?'
    ).get(articleId, GENERIC_PROFILE_ID) as { id: number } | undefined;

    const personalizedSummary = db.prepare(
      'SELECT id FROM summaries WHERE article_id = ? AND profile_id = ?'
    ).get(articleId, profileId) as { id: number } | undefined;

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
    const result = db.prepare(`
      INSERT INTO experiment_sessions (participant_id, article_id, profile_id, generic_summary_id, personalized_summary_id, ab_order, phase)
      VALUES (?, ?, ?, ?, ?, ?, 'comparison')
    `).run(participantId, articleId, profileId, genericSummary.id, personalizedSummary.id, JSON.stringify(abOrder));

    const sessionRow = db.prepare('SELECT * FROM experiment_sessions WHERE id = ?').get(result.lastInsertRowid) as SessionRow;
    res.status(201).json(mapSessionRow(sessionRow));
  } catch (error) {
    next(error);
  }
});

// GET /api/experiment/sessions/:id — get session with both summaries in A/B order
experimentRoutes.get('/sessions/:id', (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  const db = getDb();
  const row = db.prepare('SELECT * FROM experiment_sessions WHERE id = ?').get(id) as SessionRow | undefined;
  if (!row) return res.status(404).json({ error: 'Session not found' });

  const session = mapSessionRow(row);
  const abOrder = session.abOrder;

  // Resolve summaries into A/B labels
  const summaryAId = abOrder.A === 'generic' ? session.genericSummaryId : session.personalizedSummaryId;
  const summaryBId = abOrder.B === 'generic' ? session.genericSummaryId : session.personalizedSummaryId;

  const summaryA = getSummaryById(summaryAId);
  const summaryB = getSummaryById(summaryBId);

  res.json({
    ...session,
    summaryA: summaryA ? { id: summaryA.id, content: summaryA.content } : null,
    summaryB: summaryB ? { id: summaryB.id, content: summaryB.content } : null,
  });
});

// POST /api/experiment/sessions/:id/preference — record A/B preference
experimentRoutes.post('/sessions/:id/preference', (req: Request, res: Response, next: NextFunction) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  const validation = preferenceSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  try {
    const db = getDb();
    const result = db.prepare(`
      UPDATE experiment_sessions SET preference = ?, phase = 'feedback' WHERE id = ?
    `).run(validation.data.preference, id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const row = db.prepare('SELECT * FROM experiment_sessions WHERE id = ?').get(id) as SessionRow;
    res.json(mapSessionRow(row));
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
    const db = getDb();
    const sessionRow = db.prepare('SELECT * FROM experiment_sessions WHERE id = ?').get(id) as SessionRow | undefined;
    if (!sessionRow) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Regenerate the personalized summary incorporating the feedback
    const regeneratedSummary = await regenerateSummaryWithFeedback(
      sessionRow.personalized_summary_id,
      validation.data.feedbackText
    );

    // Store regeneration record
    const result = db.prepare(`
      INSERT INTO regenerations (session_id, feedback_text, regenerated_summary_id)
      VALUES (?, ?, ?)
    `).run(id, validation.data.feedbackText, regeneratedSummary.id);

    // Update session phase
    db.prepare(`UPDATE experiment_sessions SET phase = 'regenerated' WHERE id = ?`).run(id);

    const regenRow = db.prepare('SELECT * FROM regenerations WHERE id = ?').get(result.lastInsertRowid) as RegenerationRow;
    res.status(201).json(mapRegenerationRow(regenRow));
  } catch (error) {
    next(error);
  }
});

// GET /api/experiment/sessions/:id/regenerated — get regenerated summary
experimentRoutes.get('/sessions/:id/regenerated', (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  const db = getDb();
  const regenRow = db.prepare('SELECT * FROM regenerations WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(id) as RegenerationRow | undefined;
  if (!regenRow) {
    return res.status(404).json({ error: 'No regeneration found for this session' });
  }

  const summary = getSummaryById(regenRow.regenerated_summary_id);
  res.json({
    ...mapRegenerationRow(regenRow),
    summary: summary ? { id: summary.id, content: summary.content } : null,
  });
});

// POST /api/experiment/sessions/:id/rate-regeneration — rate the regenerated summary
experimentRoutes.post('/sessions/:id/rate-regeneration', (req: Request, res: Response, next: NextFunction) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid session ID' });

  const validation = rateRegenerationSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  try {
    const db = getDb();

    // Update the latest regeneration for this session
    const result = db.prepare(`
      UPDATE regenerations SET improvement_rating = ?
      WHERE session_id = ? AND id = (
        SELECT id FROM regenerations WHERE session_id = ? ORDER BY created_at DESC LIMIT 1
      )
    `).run(validation.data.improvementRating, id, id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'No regeneration found for this session' });
    }

    // Update session phase to complete
    db.prepare(`UPDATE experiment_sessions SET phase = 'complete' WHERE id = ?`).run(id);

    const sessionRow = db.prepare('SELECT * FROM experiment_sessions WHERE id = ?').get(id) as SessionRow;
    res.json(mapSessionRow(sessionRow));
  } catch (error) {
    next(error);
  }
});

// GET /api/experiment/articles — list available articles for the experiment
experimentRoutes.get('/articles', (req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT id, title, authors, year FROM articles ORDER BY id ASC').all();
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
  phase: string;
  created_at: string;
}

interface RegenerationRow {
  id: number;
  session_id: number;
  feedback_text: string;
  regenerated_summary_id: number;
  improvement_rating: string | null;
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
  phase: row.phase as ExperimentSession['phase'],
  createdAt: row.created_at,
});

const mapRegenerationRow = (row: RegenerationRow): Regeneration => ({
  id: row.id,
  sessionId: row.session_id,
  feedbackText: row.feedback_text,
  regeneratedSummaryId: row.regenerated_summary_id,
  improvementRating: row.improvement_rating as Regeneration['improvementRating'],
  createdAt: row.created_at,
});
