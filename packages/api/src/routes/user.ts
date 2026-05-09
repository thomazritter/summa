/**
 * Product-mode user routes.
 *
 * These endpoints power the dashboard where authenticated users view their
 * articles and request personalized summaries — outside the experiment flow.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne } from '../db/connection.js';
import { parseId, safeJsonParse } from '../utils/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { generatePersonalizedSummary, SummarizationError, NotFoundError } from '../services/summarizationService.js';
import type { ProfileDimensions } from '../services/summarizationService.js';
import { computeProfileDimensions } from '../services/sessionService.js';
import { EXPERIENCE_CONFIG } from '../services/sessionService.js';
import { AVAILABLE_MODELS } from '../services/groqClient.js';
import type { ParticipantRow } from '../types/rows.js';

export const userRoutes = Router();

// ─── Row interfaces for query results ──────────────────────────────

interface UserArticleRow {
  id: number;
  title: string;
  authors: string | null;
  created_at: string;
}

interface UserSummaryRow {
  id: number;
  article_id: number;
  content: string;
  factuality_score: number | null;
  model_id: string | null;
  generated_at: string;
  profile_snapshot: string | null;
}

// ─── Response interfaces ───────────────────────────────────────────

interface FactualitySentence {
  sentence: string;
  label: 'supported' | 'neutral' | 'contradicted';
  confidence: number;
  sourceSentence: string;
}

interface ArticleSummary {
  id: number;
  content: string;
  factualityScore: number | null;
  factualityDetails: FactualitySentence[] | null;
  rouge1: number | null;
  rouge2: number | null;
  rougeL: number | null;
  bertScore: number | null;
  modelId: string | null;
  modelLabel: string | null;
  profile: {
    expertise: string;
    focus: string;
    depth: string;
    context: string;
  } | null;
  generatedAt: string;
}

interface ArticlePAccuracy {
  pAccuracyRouge: number | null;
  avgPairwiseRougeL: number | null;
}

interface UserArticle {
  id: number;
  title: string;
  authors: string | null;
  createdAt: string;
  pAccuracy: ArticlePAccuracy | null;
  summaries: ArticleSummary[];
}

// ─── Validation Schemas ────────────────────────────────────────────

const summarizeSchema = z.object({
  articleId: z.number().int().positive(),
  modelId: z.string().min(1).max(100).optional(),
});

// ─── GET /api/user/articles ────────────────────────────────────────

userRoutes.get('/articles', asyncHandler(async (req: Request, res: Response) => {
  const participantId = req.accessCode?.participantId;
  if (!participantId) {
    return res.json([]);
  }

  // Get all articles uploaded by this user OR that have personalized
  // summaries linked through experiment sessions for this participant.
  // Exclude generic profile IDs (99 = keep_english generic, 98 = translate generic).
  const articleRows = await queryAll<UserArticleRow>(
    `SELECT DISTINCT a.id, a.title, a.authors, a.created_at
     FROM articles a
     LEFT JOIN summaries s ON s.article_id = a.id AND s.profile_id NOT IN (99, 98)
     WHERE a.uploaded_by = $1
        OR s.id IN (
          SELECT personalized_summary_id FROM experiment_sessions WHERE participant_id = $1
        )
     ORDER BY a.created_at DESC`,
    [participantId],
  );

  // For each article, fetch its personalized summaries
  const articles: UserArticle[] = [];
  for (const article of articleRows) {
    const summaryRows = await queryAll<UserSummaryRow & {
      factuality_details: string | null;
      rouge_1: number | null;
      rouge_2: number | null;
      rouge_l: number | null;
      bert_score: number | null;
    }>(
      `SELECT DISTINCT s.id, s.article_id, s.content, s.factuality_score, s.factuality_details,
              s.rouge_1, s.rouge_2, s.rouge_l, s.bert_score,
              s.model_id, s.generated_at,
              es.profile_snapshot
       FROM summaries s
       LEFT JOIN experiment_sessions es ON es.personalized_summary_id = s.id
       WHERE s.article_id = $1
         AND s.profile_id NOT IN (99, 98)
         AND (
           s.id IN (
             SELECT personalized_summary_id FROM experiment_sessions WHERE participant_id = $2
           )
           OR s.article_id IN (
             SELECT id FROM articles WHERE uploaded_by = $2
           )
         )
       ORDER BY s.generated_at DESC`,
      [article.id, participantId],
    );

    const pAccuracyRow = await queryOne<{
      p_accuracy_rouge: number | null;
      avg_pairwise_rouge_l: number | null;
    }>(
      `SELECT p_accuracy_rouge, avg_pairwise_rouge_l FROM p_accuracy_scores WHERE article_id = $1`,
      [article.id],
    );

    articles.push({
      id: article.id,
      title: article.title,
      authors: article.authors,
      createdAt: article.created_at,
      pAccuracy: pAccuracyRow
        ? {
            pAccuracyRouge: pAccuracyRow.p_accuracy_rouge,
            avgPairwiseRougeL: pAccuracyRow.avg_pairwise_rouge_l,
          }
        : null,
      summaries: summaryRows.map((s) => {
        const modelInfo = AVAILABLE_MODELS.find((m) => m.id === s.model_id);
        const profile = s.profile_snapshot ? JSON.parse(s.profile_snapshot) : null;
        const factualityDetails = s.factuality_details ? safeJsonParse(s.factuality_details) : null;
        return {
          id: s.id,
          content: s.content,
          factualityScore: s.factuality_score,
          factualityDetails: factualityDetails as Array<{
            sentence: string;
            label: 'supported' | 'neutral' | 'contradicted';
            confidence: number;
            sourceSentence: string;
          }> | null,
          rouge1: s.rouge_1,
          rouge2: s.rouge_2,
          rougeL: s.rouge_l,
          bertScore: s.bert_score,
          modelId: s.model_id,
          modelLabel: modelInfo?.name || s.model_id || 'Desconhecido',
          profile: profile ? {
            expertise: profile.expertise,
            focus: profile.focus,
            depth: profile.depth,
            context: profile.context,
          } : null,
          generatedAt: s.generated_at,
        };
      }),
    });
  }

  res.json(articles);
}));

// ─── POST /api/user/summarize ──────────────────────────────────────

userRoutes.post('/summarize', asyncHandler(async (req: Request, res: Response) => {
  const participantId = req.accessCode?.participantId;
  if (!participantId) {
    return res.status(400).json({ error: 'Perfil de participante nao configurado' });
  }

  const validation = summarizeSchema.safeParse(req.body);
  if (!validation.success) {
    const messages = validation.error.errors.map(e => e.message).join('; ');
    return res.status(400).json({ error: `Dados inválidos: ${messages}` });
  }

  const { articleId, modelId } = validation.data;

  // Validate modelId if provided
  if (modelId) {
    const validModel = AVAILABLE_MODELS.find((m) => m.id === modelId);
    if (!validModel) {
      return res.status(400).json({
        error: `Modelo invalido: ${modelId}. Modelos disponiveis: ${AVAILABLE_MODELS.map((m) => m.id).join(', ')}`,
      });
    }
  }

  // Load participant to compute profile dimensions
  const participant = await queryOne<ParticipantRow>(
    'SELECT * FROM participants WHERE id = $1',
    [participantId],
  );
  if (!participant) {
    return res.status(404).json({ error: 'Participante nao encontrado' });
  }

  const dimensions: ProfileDimensions = computeProfileDimensions(participant);

  // Build participant preferences
  const participantPreferences = {
    structurePreference: participant.structure_preference as 'prose' | 'bullets' | 'mixed' | undefined,
    englishComfort: participant.english_comfort as 'keep_english' | 'translate' | undefined,
    domain: participant.domain || undefined,
    currentProject: participant.current_project || undefined,
  };
  const hasPreferences = participantPreferences.structurePreference
    || participantPreferences.englishComfort
    || participantPreferences.domain
    || participantPreferences.currentProject;

  // Determine the base profile ID from experience config
  const config = EXPERIENCE_CONFIG[participant.experience_level];
  const baseProfileId = config ? config.profileId : 101; // fallback to pleno

  try {
    const summary = await generatePersonalizedSummary(
      articleId,
      baseProfileId,
      dimensions,
      hasPreferences ? participantPreferences : undefined,
      modelId,
    );

    res.status(201).json({
      id: summary.id,
      content: summary.content,
      factualityScore: summary.factualityScore,
      modelId: summary.modelId,
      generatedAt: summary.generatedAt,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof SummarizationError) {
      return res.status(502).json({ error: error.message });
    }
    throw error;
  }
}));

// ─── DELETE /api/user/summaries/:id ───────────────────────────────

userRoutes.delete('/summaries/:id', asyncHandler(async (req: Request, res: Response) => {
  const participantId = req.accessCode?.participantId;
  if (!participantId) {
    return res.status(400).json({ error: 'Perfil de participante nao configurado' });
  }

  const summaryId = parseId(req.params.id);
  if (summaryId === null) {
    return res.status(400).json({ error: 'ID de resumo invalido' });
  }

  // Verify ownership: summary must belong to an article uploaded by this participant
  const summary = await queryOne<{ id: number; article_id: number }>(
    `SELECT s.id, s.article_id FROM summaries s
     JOIN articles a ON a.id = s.article_id
     WHERE s.id = $1 AND a.uploaded_by = $2`,
    [summaryId, participantId],
  );

  if (!summary) {
    return res.status(404).json({ error: 'Resumo nao encontrado ou voce nao tem permissao para deleta-lo' });
  }

  await queryOne('DELETE FROM summaries WHERE id = $1', [summaryId]);
  res.json({ success: true });
}));
