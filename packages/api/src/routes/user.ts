/**
 * Product-mode user routes.
 *
 * These endpoints power the dashboard where authenticated users view their
 * articles and request personalized summaries — outside the experiment flow.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute } from '../db/connection.js';
import { parseId, safeJsonParse, zodErrorMessage } from '../utils/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { generatePersonalizedSummary, SummarizationError, NotFoundError } from '../services/summarizationService.js';
import { buildPersonalizationContext } from '../services/profileService.js';
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
  category: string;
  rationale: string;
}

interface KeyfactAlignment {
  fact: string;
  covered: boolean;
  lineNumbers: number[];
}

interface ArticleSummary {
  id: number;
  content: string;
  factualityScore: number | null;
  factualityDetails: FactualitySentence[] | null;
  completenessScore: number | null;
  concisenessScore: number | null;
  keyfactAlignment: KeyfactAlignment[] | null;
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

interface UserArticle {
  id: number;
  title: string;
  authors: string | null;
  createdAt: string;
  summaries: ArticleSummary[];
}

// ─── Validation Schemas ────────────────────────────────────────────

const summarizeSchema = z.object({
  articleId: z.number().int().positive(),
});

// ─── GET /api/user/articles ────────────────────────────────────────

userRoutes.get('/articles', asyncHandler(async (req: Request, res: Response) => {
  const participantId = req.accessCode?.participantId;
  if (!participantId) {
    return res.json([]);
  }

  // Articles uploaded by this user that have at least one summary.
  // Articles uploaded but never summarized (user abandoned the flow between
  // upload and generate) are intentionally excluded so the dashboard does
  // not surface empty rows.
  const articleRows = await queryAll<UserArticleRow>(
    `SELECT DISTINCT a.id, a.title, a.authors, a.created_at
     FROM articles a
     INNER JOIN summaries s ON s.article_id = a.id
     WHERE a.uploaded_by = $1
     ORDER BY a.created_at DESC`,
    [participantId],
  );

  // For each article, fetch its personalized summaries
  const articles: UserArticle[] = [];
  for (const article of articleRows) {
    const summaryRows = await queryAll<UserSummaryRow & {
      factuality_details: string | null;
      completeness_score: number | null;
      conciseness_score: number | null;
      factuality_keyfacts: string | null;
    }>(
      `SELECT s.id, s.article_id, s.content, s.factuality_score, s.factuality_details,
              s.completeness_score, s.conciseness_score, s.factuality_keyfacts,
              s.model_id, s.generated_at, s.parent_summary_id,
              s.profile_snapshot
       FROM summaries s
       WHERE s.article_id = $1
         AND s.article_id IN (SELECT id FROM articles WHERE uploaded_by = $2)
       ORDER BY s.generated_at DESC`,
      [article.id, participantId],
    );

    articles.push({
      id: article.id,
      title: article.title,
      authors: article.authors,
      createdAt: article.created_at,
      summaries: summaryRows.map((s: UserSummaryRow & {
        factuality_details: string | null;
        completeness_score: number | null;
        conciseness_score: number | null;
        factuality_keyfacts: string | null;
        parent_summary_id?: number | null;
      }) => {
        const modelInfo = AVAILABLE_MODELS.find((m) => m.id === s.model_id);
        // Accept both snapshot shapes:
        //   new (per-summary): { dimensions: {...}, preferences: {...} }
        //   old (per-session):  { expertise, focus, depth, context }
        const snapshot = s.profile_snapshot ? safeJsonParse<Record<string, unknown>>(s.profile_snapshot) : null;
        const dims = (snapshot && typeof snapshot === 'object' && 'dimensions' in snapshot
          ? (snapshot.dimensions as Record<string, string>)
          : (snapshot as Record<string, string> | null)) ?? null;
        // Auxiliary participant prefs (domain / currentProject) live under
        // `preferences` only in the new snapshot shape; legacy rows return
        // null here.
        const prefs = (snapshot && typeof snapshot === 'object' && 'preferences' in snapshot
          ? (snapshot.preferences as Record<string, string> | null)
          : null);
        const factualityDetails = s.factuality_details ? safeJsonParse(s.factuality_details) : null;
        const keyfactAlignment = s.factuality_keyfacts ? safeJsonParse(s.factuality_keyfacts) : null;
        return {
          id: s.id,
          content: s.content,
          factualityScore: s.factuality_score,
          factualityDetails: factualityDetails as Array<{
            sentence: string;
            label: 'supported' | 'neutral' | 'contradicted';
            confidence: number;
            category: string;
            rationale: string;
          }> | null,
          completenessScore: s.completeness_score,
          concisenessScore: s.conciseness_score,
          keyfactAlignment: keyfactAlignment as Array<{
            fact: string;
            covered: boolean;
            lineNumbers: number[];
          }> | null,
          modelId: s.model_id,
          modelLabel: modelInfo?.name || s.model_id || 'Desconhecido',
          parentSummaryId: s.parent_summary_id ?? null,
          profile: dims ? {
            expertise: dims.expertise,
            focus: dims.focus,
            depth: dims.depth,
            context: dims.context,
            domain: prefs?.domain ?? null,
            currentProject: prefs?.currentProject ?? null,
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
    return res.status(400).json({ error: `Dados inválidos: ${zodErrorMessage(validation.error)}` });
  }

  const { articleId } = validation.data;

  // Ownership: the article must have been uploaded by this participant.
  // Without this check any logged-in user could pay the LLM cost of
  // summarising any article in the database.
  const article = await queryOne<{ id: number }>(
    'SELECT id FROM articles WHERE id = $1 AND uploaded_by = $2',
    [articleId, participantId],
  );
  if (!article) {
    return res.status(404).json({ error: 'Artigo nao encontrado' });
  }

  // Load participant to compute profile dimensions
  const participant = await queryOne<ParticipantRow>(
    'SELECT * FROM participants WHERE id = $1',
    [participantId],
  );
  if (!participant) {
    return res.status(404).json({ error: 'Participante nao encontrado' });
  }

  const { dimensions, preferences } = buildPersonalizationContext(participant);

  try {
    const summary = await generatePersonalizedSummary(
      articleId,
      dimensions,
      preferences,
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

  await execute('DELETE FROM summaries WHERE id = $1', [summaryId]);

  // If that was the user's last summary for this article, drop the article
  // too so the dashboard does not keep showing "Sem resumo disponível" cards.
  const remaining = await queryOne<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM summaries WHERE article_id = $1',
    [summary.article_id],
  );
  if (remaining && Number(remaining.count) === 0) {
    await execute('DELETE FROM articles WHERE id = $1', [summary.article_id]);
  }

  res.json({ success: true });
}));

// ─── POST /api/user/summaries/:id/rate ──────────────────────────────
//
// Submits a Likert rating (1–5 across four dimensions, plus an optional
// free-text comment) for a summary the authenticated participant owns.
// One rating per (participant, summary) pair; subsequent attempts return 409.

const rateSchema = z.object({
  utilidade: z.number().int().min(1).max(5),
  clareza: z.number().int().min(1).max(5),
  adequacao_perfil: z.number().int().min(1).max(5),
  factualidade_percebida: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

userRoutes.post('/summaries/:id/rate', asyncHandler(async (req: Request, res: Response) => {
  const participantId = req.accessCode?.participantId;
  if (!participantId) {
    return res.status(400).json({ error: 'Perfil de participante nao configurado' });
  }

  const summaryId = parseId(req.params.id);
  if (summaryId === null) {
    return res.status(400).json({ error: 'ID de resumo invalido' });
  }

  const validation = rateSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: 'Dados de avaliacao invalidos',
      details: zodErrorMessage(validation.error, true),
    });
  }

  // Verify ownership: summary must belong to an article uploaded by this participant.
  const summary = await queryOne<{ id: number }>(
    `SELECT s.id FROM summaries s
     JOIN articles a ON a.id = s.article_id
     WHERE s.id = $1 AND a.uploaded_by = $2`,
    [summaryId, participantId],
  );
  if (!summary) {
    return res.status(404).json({ error: 'Resumo nao encontrado' });
  }

  try {
    const inserted = await queryOne<{ id: number; created_at: string }>(
      `INSERT INTO summary_ratings
         (summary_id, participant_id, source, utilidade, clareza, adequacao_perfil, factualidade_percebida, comment)
       VALUES ($1, $2, 'product', $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [
        summaryId,
        participantId,
        validation.data.utilidade,
        validation.data.clareza,
        validation.data.adequacao_perfil,
        validation.data.factualidade_percebida,
        validation.data.comment ?? null,
      ],
    );
    res.status(201).json({
      id: inserted?.id,
      createdAt: inserted?.created_at,
      ...validation.data,
    });
  } catch (error) {
    // Unique constraint on (participant_id, summary_id) WHERE source='product'.
    if (error instanceof Error && /idx_unique_product_rating|duplicate key/.test(error.message)) {
      return res.status(409).json({ error: 'Voce ja avaliou este resumo' });
    }
    throw error;
  }
}));

// ─── GET /api/user/summaries/:id/rating ─────────────────────────────
//
// Returns the rating this participant gave for the summary, or null if
// they haven't rated it yet. Used by the SummaryView to hydrate the form.

userRoutes.get('/summaries/:id/rating', asyncHandler(async (req: Request, res: Response) => {
  const participantId = req.accessCode?.participantId;
  if (!participantId) {
    return res.status(400).json({ error: 'Perfil de participante nao configurado' });
  }

  const summaryId = parseId(req.params.id);
  if (summaryId === null) {
    return res.status(400).json({ error: 'ID de resumo invalido' });
  }

  const row = await queryOne<{
    id: number;
    utilidade: number;
    clareza: number;
    adequacao_perfil: number;
    factualidade_percebida: number;
    comment: string | null;
    created_at: string;
  }>(
    `SELECT id, utilidade, clareza, adequacao_perfil, factualidade_percebida, comment, created_at
     FROM summary_ratings
     WHERE summary_id = $1 AND participant_id = $2 AND source = 'product'
     LIMIT 1`,
    [summaryId, participantId],
  );

  if (!row) {
    return res.json({ rating: null });
  }

  res.json({
    rating: {
      id: row.id,
      utilidade: row.utilidade,
      clareza: row.clareza,
      adequacao_perfil: row.adequacao_perfil,
      factualidade_percebida: row.factualidade_percebida,
      comment: row.comment,
      createdAt: row.created_at,
    },
  });
}));
