import { Router, Request, Response } from 'express';
import { requireManager } from '../middleware/auth.js';
import { queryOne, queryAll, execute } from '../db/connection.js';
import { safeJsonParse } from '../utils/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { computePAccuracyForArticles, PROFILE_LABELS } from '../services/pAccuracyHelper.js';
import { getActiveModel, setActiveModel, AVAILABLE_MODELS } from '../services/groqClient.js';
import type {
  CountRow,
  PhaseRow,
  AbOrder,
  SessionRow,
  ParticipantRow,
  SessionDetailRow,
  RatingRow,
  RegenerationRow,
  PostTestRow,
  ManagerSummaryRow,
  DeleteParticipantRow,
  ExportParticipantRow,
  ExportEvaluationRow,
  ExportFeedbackRow,
  ExportPostTestRow,
} from '../types/rows.js';

export const managerRoutes = Router();

// All manager routes require manager auth
managerRoutes.use(requireManager);

// ─── GET /overview ────────────────────────────────────────────────────

managerRoutes.get('/overview', asyncHandler(async (_req: Request, res: Response) => {
  const totalInvitedRow = await queryOne<CountRow>(
    "SELECT COUNT(*) as count FROM access_codes WHERE role = 'participant'"
  );
  const totalCompletedRow = await queryOne<CountRow>(
    'SELECT COUNT(DISTINCT participant_id) as count FROM post_test_responses'
  );

  const totalInvited = parseInt(totalInvitedRow?.count ?? '0', 10);
  const totalCompleted = parseInt(totalCompletedRow?.count ?? '0', 10);
  const completionRate = totalInvited > 0 ? Math.round((totalCompleted / totalInvited) * 100) : 0;

  const phaseRows = await queryAll<PhaseRow>(
    'SELECT phase, COUNT(*) as count FROM experiment_sessions GROUP BY phase'
  );
  const sessionsByPhase: Record<string, number> = {
    comparison: 0,
    feedback: 0,
    regenerated: 0,
    complete: 0,
  };
  for (const row of phaseRows) {
    sessionsByPhase[row.phase] = parseInt(row.count, 10);
  }

  res.json({ totalInvited, totalCompleted, completionRate, sessionsByPhase });
}));

// ─── GET /results ─────────────────────────────────────────────────────

interface ResultsSessionRow {
  preference: string | null;
  preference_rating: number | null;
  ab_order: string;
  experience_level: string;
}

managerRoutes.get('/results', asyncHandler(async (_req: Request, res: Response) => {
  // Fetch all sessions with their preference data and participant experience level
  const sessions = await queryAll<ResultsSessionRow>(`
    SELECT es.preference, es.preference_rating, es.ab_order, p.experience_level
    FROM experiment_sessions es
    JOIN participants p ON es.participant_id = p.id
    WHERE es.preference IS NOT NULL
  `);

  // ─── Preference stats ──────────────────────────────────────────────
  let personalizedChosen = 0;
  let genericChosen = 0;

  // ─── Rating by type accumulators ───────────────────────────────────
  const ratingAccum = {
    personalized: { sum: 0, count: 0 },
    generic: { sum: 0, count: 0 },
  };

  // ─── Rating by profile accumulators ────────────────────────────────
  const profileAccum: Record<string, {
    ratingSum: number;
    ratingCount: number;
    personalizedChosen: number;
    total: number;
  }> = {};

  for (const s of sessions) {
    const abOrder = safeJsonParse<AbOrder>(s.ab_order);
    if (!abOrder || !s.preference) continue;

    const chosenType = abOrder[s.preference as 'A' | 'B'];
    if (chosenType === 'personalized') personalizedChosen++;
    else if (chosenType === 'generic') genericChosen++;

    // Rating by type
    if (s.preference_rating !== null && chosenType) {
      ratingAccum[chosenType as 'personalized' | 'generic'].sum += s.preference_rating;
      ratingAccum[chosenType as 'personalized' | 'generic'].count++;
    }

    // Rating by profile
    const level = s.experience_level;
    if (!profileAccum[level]) {
      profileAccum[level] = { ratingSum: 0, ratingCount: 0, personalizedChosen: 0, total: 0 };
    }
    profileAccum[level].total++;
    if (chosenType === 'personalized') profileAccum[level].personalizedChosen++;
    if (s.preference_rating !== null) {
      profileAccum[level].ratingSum += s.preference_rating;
      profileAccum[level].ratingCount++;
    }
  }

  const total = personalizedChosen + genericChosen;
  const round2 = (sum: number, count: number) => count > 0 ? Math.round((sum / count) * 100) / 100 : 0;

  const ratingByType = {
    personalized: {
      avgRating: round2(ratingAccum.personalized.sum, ratingAccum.personalized.count),
      count: ratingAccum.personalized.count,
    },
    generic: {
      avgRating: round2(ratingAccum.generic.sum, ratingAccum.generic.count),
      count: ratingAccum.generic.count,
    },
  };

  const ratingByProfile: Record<string, {
    avgRating: number;
    count: number;
    personalizedChosen: number;
    total: number;
  }> = {};
  for (const [level, accum] of Object.entries(profileAccum)) {
    ratingByProfile[level] = {
      avgRating: round2(accum.ratingSum, accum.ratingCount),
      count: accum.ratingCount,
      personalizedChosen: accum.personalizedChosen,
      total: accum.total,
    };
  }

  // ─── P-Accuracy ────────────────────────────────────────────────────
  const pAccuracyResults = await computePAccuracyForArticles();

  res.json({
    preferenceStats: {
      personalizedChosen,
      genericChosen,
      total,
      personalizedPercentage: total > 0 ? Math.round((personalizedChosen / total) * 100) : 0,
      genericPercentage: total > 0 ? Math.round((genericChosen / total) * 100) : 0,
    },
    ratingByType,
    ratingByProfile,
    pAccuracy: pAccuracyResults,
  });
}));

// ─── GET /participants ────────────────────────────────────────────────

managerRoutes.get('/participants', asyncHandler(async (_req: Request, res: Response) => {
  const participants = await queryAll<ParticipantRow>(
    'SELECT id, name, experience_level, years_experience, reading_frequency, topic_familiarity, created_at FROM participants ORDER BY id'
  );

  const participantIds = participants.map(p => p.id);
  if (participantIds.length === 0) {
    return res.json([]);
  }

  // Fetch all sessions for these participants
  const allSessions = await queryAll<SessionDetailRow & { participant_id: number }>(`
    SELECT es.id, es.article_id, a.title as article_title, es.phase, es.preference,
           es.preference_reason, es.ab_order, es.generic_summary_id, es.personalized_summary_id,
           es.participant_id
    FROM experiment_sessions es
    JOIN articles a ON es.article_id = a.id
    WHERE es.participant_id = ANY($1)
    ORDER BY es.id
  `, [participantIds]);

  const sessionIds = allSessions.map(s => s.id);

  // Fetch all ratings
  const allRatings = sessionIds.length > 0
    ? await queryAll<RatingRow & { session_id: number }>(`
        SELECT session_id, summary_id, ab_label, utilidade, clareza, adequacao_perfil, factualidade_percebida, comment
        FROM summary_ratings WHERE session_id = ANY($1)
      `, [sessionIds])
    : [];

  // Fetch all regenerations
  const allRegens = sessionIds.length > 0
    ? await queryAll<RegenerationRow & { session_id: number }>(`
        SELECT session_id, feedback_text, improvement_rating, utility_rating, clarity_rating, adequacy_rating, change_description
        FROM regenerations WHERE session_id = ANY($1)
      `, [sessionIds])
    : [];

  // Fetch all post-test responses
  const allPostTests = await queryAll<PostTestRow>(
    'SELECT participant_id, noticed_difference, difference_type, would_use_daily, improvements, comments FROM post_test_responses WHERE participant_id = ANY($1)',
    [participantIds]
  );

  // Index by IDs
  const sessionsByParticipant = new Map<number, (SessionDetailRow & { participant_id: number })[]>();
  for (const s of allSessions) {
    const arr = sessionsByParticipant.get(s.participant_id) ?? [];
    arr.push(s);
    sessionsByParticipant.set(s.participant_id, arr);
  }

  const ratingsBySession = new Map<number, (RatingRow & { session_id: number })[]>();
  for (const r of allRatings) {
    const arr = ratingsBySession.get(r.session_id) ?? [];
    arr.push(r);
    ratingsBySession.set(r.session_id, arr);
  }

  const regenBySession = new Map<number, RegenerationRow>();
  for (const rg of allRegens) {
    regenBySession.set(rg.session_id, rg);
  }

  const postTestByParticipant = new Map<number, PostTestRow>();
  for (const pt of allPostTests) {
    postTestByParticipant.set(pt.participant_id, pt);
  }

  // Assemble response
  const result = participants.map(p => {
    const pSessions = sessionsByParticipant.get(p.id) ?? [];

    const sessionsData = pSessions.map(s => {
      const sRatings = ratingsBySession.get(s.id) ?? [];
      const ratingsData = sRatings.map(r => {
        const summaryType = r.summary_id === s.generic_summary_id ? 'generic'
          : r.summary_id === s.personalized_summary_id ? 'personalized'
          : 'unknown';
        return {
          abLabel: r.ab_label,
          summaryType,
          utilidade: r.utilidade,
          clareza: r.clareza,
          adequacaoPerfil: r.adequacao_perfil,
          factualidadePercebida: r.factualidade_percebida,
          comment: r.comment,
        };
      });

      const regen = regenBySession.get(s.id);
      const regeneration = regen ? {
        feedbackText: regen.feedback_text,
        improvementRating: regen.improvement_rating,
        utilityRating: regen.utility_rating,
        clarityRating: regen.clarity_rating,
        adequacyRating: regen.adequacy_rating,
        changeDescription: regen.change_description,
      } : null;

      return {
        id: s.id,
        articleTitle: s.article_title,
        phase: s.phase,
        preference: s.preference,
        preferenceReason: s.preference_reason,
        abOrder: safeJsonParse(s.ab_order),
        ratings: ratingsData,
        regeneration,
      };
    });

    const pt = postTestByParticipant.get(p.id);
    const postTest = pt ? {
      noticedDifference: pt.noticed_difference,
      differenceType: pt.difference_type,
      wouldUseDaily: pt.would_use_daily,
      improvements: pt.improvements,
      comments: pt.comments,
    } : null;

    return {
      id: p.id,
      name: p.name,
      experienceLevel: p.experience_level,
      yearsExperience: p.years_experience,
      readingFrequency: p.reading_frequency,
      topicFamiliarity: p.topic_familiarity,
      createdAt: p.created_at,
      sessions: sessionsData,
      postTest,
    };
  });

  res.json(result);
}));

// ─── GET /summaries ───────────────────────────────────────────────────

// PROFILE_LABELS imported from pAccuracyHelper

managerRoutes.get('/summaries', asyncHandler(async (_req: Request, res: Response) => {
  const summaryRows = await queryAll<ManagerSummaryRow & { factuality_details: string | null }>(`
    SELECT s.id, s.article_id, a.title as article_title, s.profile_id, s.content,
           s.factuality_score, s.factuality_details, s.rouge_1, s.rouge_2, s.rouge_l, s.bert_score
    FROM summaries s
    JOIN articles a ON s.article_id = a.id
    ORDER BY s.id
  `);

  // P-Accuracy computed via shared helper
  const pAccuracy = await computePAccuracyForArticles();

  res.json({
    summaries: summaryRows.map(s => ({
      id: s.id,
      articleId: s.article_id,
      articleTitle: s.article_title,
      profileId: s.profile_id,
      profileLabel: PROFILE_LABELS[s.profile_id] ?? `Profile ${s.profile_id}`,
      content: s.content,
      factualityScore: s.factuality_score,
      factualityDetails: s.factuality_details ? safeJsonParse(s.factuality_details) ?? null : null,
      rouge1: s.rouge_1,
      rouge2: s.rouge_2,
      rougeL: s.rouge_l,
      bertScore: s.bert_score,
    })),
    pAccuracy,
  });
}));

// ─── GET /export/:type ────────────────────────────────────────────────

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  // Prevent CSV formula injection
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r') || str.includes("'")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function buildCsv(headers: string[], rows: unknown[][]): string {
  const headerLine = headers.join(',');
  const dataLines = rows.map(row => row.map(escapeCsv).join(','));
  return [headerLine, ...dataLines].join('\n');
}

async function getParticipantsCsv(): Promise<string> {
  const rows = await queryAll<ExportParticipantRow>(
    'SELECT id, name, experience_level, years_experience, reading_frequency, topic_familiarity, structure_preference, reading_goal, preferred_length, created_at FROM participants ORDER BY id'
  );
  return buildCsv(
    ['id', 'nome', 'nivel', 'anos_experiencia', 'frequencia_leitura', 'familiaridade_tema', 'preferencia_estrutura', 'objetivo_leitura', 'extensao_preferida', 'conforto_ingles', 'data_registro'],
    rows.map(r => [r.id, r.name, r.experience_level, r.years_experience, r.reading_frequency, r.topic_familiarity, r.structure_preference, r.reading_goal, r.preferred_length, r.created_at])
  );
}

async function getRatingsCsv(): Promise<string> {
  const rows = await queryAll<ExportEvaluationRow>(`
    SELECT p.id as participant_id, p.name as participant_name, p.experience_level,
           es.id as session_id, a.title as article_title,
           es.preference, es.preference_rating, es.preference_reason,
           es.ab_order, es.phase,
           es.generic_summary_id, es.personalized_summary_id
    FROM experiment_sessions es
    JOIN participants p ON es.participant_id = p.id
    JOIN articles a ON es.article_id = a.id
    WHERE es.preference IS NOT NULL
    ORDER BY p.id, es.id
  `);
  return buildCsv(
    ['participante_id', 'participante_nome', 'nivel', 'sessao_id', 'artigo', 'preferencia_ab', 'tipo_escolhido', 'nota', 'comentario'],
    rows.map(r => {
      const abOrder = safeJsonParse<AbOrder>(r.ab_order);
      const chosenType = abOrder?.[r.preference as 'A' | 'B'] ?? 'unknown';
      const tipoEscolhido = chosenType === 'personalized' ? 'personalizado'
        : chosenType === 'generic' ? 'genérico'
        : 'desconhecido';
      return [r.participant_id, r.participant_name, r.experience_level, r.session_id, r.article_title, r.preference, tipoEscolhido, r.preference_rating, r.preference_reason];
    })
  );
}

async function getFeedbacksCsv(): Promise<string> {
  const rows = await queryAll<ExportFeedbackRow>(`
    SELECT p.id as participant_id, p.name as participant_name,
           r.session_id, a.title as article_title,
           r.feedback_text, r.improvement_rating, r.utility_rating, r.clarity_rating, r.adequacy_rating, r.change_description
    FROM regenerations r
    JOIN experiment_sessions es ON r.session_id = es.id
    JOIN participants p ON es.participant_id = p.id
    JOIN articles a ON es.article_id = a.id
    ORDER BY p.id, r.session_id
  `);
  return buildCsv(
    ['participante_id', 'participante_nome', 'sessao_id', 'artigo_titulo', 'texto_feedback', 'melhoria', 'utilidade_regenerado', 'clareza_regenerado', 'adequacao_regenerado', 'descricao_mudanca'],
    rows.map(r => [r.participant_id, r.participant_name, r.session_id, r.article_title, r.feedback_text, r.improvement_rating, r.utility_rating, r.clarity_rating, r.adequacy_rating, r.change_description])
  );
}

async function getPostTestCsv(): Promise<string> {
  const rows = await queryAll<ExportPostTestRow>(`
    SELECT p.id as participant_id, p.name as participant_name,
           pt.noticed_difference, pt.difference_type, pt.would_use_daily, pt.improvements, pt.comments
    FROM post_test_responses pt
    JOIN participants p ON pt.participant_id = p.id
    ORDER BY p.id
  `);
  return buildCsv(
    ['participante_id', 'participante_nome', 'percebeu_diferenca', 'tipo_diferenca', 'usaria_diariamente', 'melhorias', 'comentarios'],
    rows.map(r => [r.participant_id, r.participant_name, r.noticed_difference, r.difference_type, r.would_use_daily, r.improvements, r.comments])
  );
}

managerRoutes.get('/export/:type', asyncHandler(async (req: Request, res: Response) => {
  const exportType = req.params.type;

  if (exportType === 'all') {
    const [participants, ratings, feedbacks, postTest] = await Promise.all([
      getParticipantsCsv(),
      getRatingsCsv(),
      getFeedbacksCsv(),
      getPostTestCsv(),
    ]);
    return res.json({ participants, ratings, feedbacks, postTest });
  }

  const csvGenerators: Record<string, () => Promise<string>> = {
    participants: getParticipantsCsv,
    ratings: getRatingsCsv,
    feedbacks: getFeedbacksCsv,
    'post-test': getPostTestCsv,
  };

  const generator = csvGenerators[exportType];
  if (!generator) {
    return res.status(400).json({ error: 'Invalid export type. Use: participants, ratings, feedbacks, post-test, all' });
  }

  const csv = await generator();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${exportType}.csv"`);
  res.write('\uFEFF'); // BOM for Excel
  res.end(csv);
}));

// ─── DELETE participant and all related data ─────────────────────────

managerRoutes.delete('/participants/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID invalido' });

  const participant = await queryOne<DeleteParticipantRow>('SELECT id, name FROM participants WHERE id = $1', [id]);
  if (!participant) return res.status(404).json({ error: 'Participante nao encontrado' });

  // Reset access_code (SET NULL via cascade), then delete participant (cascades everything)
  await execute('UPDATE access_codes SET used_at = NULL WHERE participant_id = $1', [id]);
  await execute('DELETE FROM participants WHERE id = $1', [id]);

  res.json({ success: true, message: `Participante ${participant.name || id} removido com sucesso` });
}));

// ─── GET /product-ratings ────────────────────────────────────────────
//
// Aggregated Likert feedback collected outside the experiment flow
// (source='product'). Returns means per dimension, the per-rating breakdown,
// and the most recent comments.

interface ProductRatingRow {
  id: number;
  summary_id: number;
  participant_id: number;
  participant_name: string | null;
  utilidade: number;
  clareza: number;
  adequacao_perfil: number;
  factualidade_percebida: number;
  comment: string | null;
  created_at: string;
}

managerRoutes.get('/product-ratings', asyncHandler(async (_req: Request, res: Response) => {
  const rows = await queryAll<ProductRatingRow>(
    `SELECT sr.id, sr.summary_id, sr.participant_id, p.name AS participant_name,
            sr.utilidade, sr.clareza, sr.adequacao_perfil, sr.factualidade_percebida,
            sr.comment, sr.created_at
     FROM summary_ratings sr
     LEFT JOIN participants p ON p.id = sr.participant_id
     WHERE sr.source = 'product'
     ORDER BY sr.created_at DESC`,
  );

  const total = rows.length;
  const mean = (k: 'utilidade' | 'clareza' | 'adequacao_perfil' | 'factualidade_percebida') =>
    total === 0 ? null : rows.reduce((s, r) => s + r[k], 0) / total;

  res.json({
    total,
    means: {
      utilidade: mean('utilidade'),
      clareza: mean('clareza'),
      adequacao_perfil: mean('adequacao_perfil'),
      factualidade_percebida: mean('factualidade_percebida'),
    },
    ratings: rows.map(r => ({
      id: r.id,
      summaryId: r.summary_id,
      participantId: r.participant_id,
      participantName: r.participant_name,
      utilidade: r.utilidade,
      clareza: r.clareza,
      adequacaoPerfil: r.adequacao_perfil,
      factualidadePercebida: r.factualidade_percebida,
      comment: r.comment,
      createdAt: r.created_at,
    })),
  });
}));

// ─── GET /model ──────────────────────────────────────────────────────

managerRoutes.get('/model', (_req: Request, res: Response) => {
  res.json({ activeModel: getActiveModel(), availableModels: AVAILABLE_MODELS });
});

// ─── PUT /model ──────────────────────────────────────────────────────

managerRoutes.put('/model', (req: Request, res: Response) => {
  const { model } = req.body;
  if (!AVAILABLE_MODELS.find(m => m.id === model)) {
    return res.status(400).json({ error: 'Modelo nao disponivel' });
  }
  setActiveModel(model);
  res.json({ activeModel: getActiveModel() });
});
