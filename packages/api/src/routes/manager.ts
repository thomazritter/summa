import { Router, Request, Response } from 'express';
import { requireManager } from '../middleware/auth.js';
import { queryOne, queryAll } from '../db/connection.js';
import { safeJsonParse } from '../utils/validation.js';

export const managerRoutes = Router();

// All manager routes require manager auth
managerRoutes.use(requireManager);

// ─── Interfaces ───────────────────────────────────────────────────────

interface CountRow { count: string }
interface PhaseRow { phase: string; count: string }
interface AbOrder { A: 'generic' | 'personalized'; B: 'generic' | 'personalized' }

interface SessionRow {
  id: number;
  preference: string | null;
  ab_order: string;
  generic_summary_id: number;
  personalized_summary_id: number;
}

interface RatingWithSession {
  summary_id: number;
  generic_summary_id: number;
  personalized_summary_id: number;
  experience_level: string;
  utilidade: number;
  clareza: number;
  adequacao_perfil: number;
  factualidade_percebida: number;
}

interface ImprovementRow { improvement_rating: string; count: string }
interface RegenAvgRow { avg_utility: string | null; avg_clarity: string | null; avg_adequacy: string | null }

interface ParticipantRow {
  id: number;
  name: string;
  experience_level: string;
  years_experience: number;
  reading_frequency: string;
  topic_familiarity: string;
  created_at: string;
}

interface SessionDetailRow {
  id: number;
  article_id: number;
  article_title: string;
  phase: string;
  preference: string | null;
  preference_reason: string | null;
  ab_order: string;
  generic_summary_id: number;
  personalized_summary_id: number;
}

interface RatingRow {
  session_id: number;
  summary_id: number;
  ab_label: string;
  utilidade: number;
  clareza: number;
  adequacao_perfil: number;
  factualidade_percebida: number;
  comment: string | null;
}

interface RegenerationRow {
  session_id: number;
  feedback_text: string;
  improvement_rating: string | null;
  utility_rating: number | null;
  clarity_rating: number | null;
  adequacy_rating: number | null;
  change_description: string | null;
}

interface PostTestRow {
  participant_id: number;
  noticed_difference: string | null;
  difference_type: string | null;
  would_use_daily: string | null;
  improvements: string | null;
  comments: string | null;
}

interface SummaryRow {
  id: number;
  article_id: number;
  article_title: string;
  profile_id: number;
  content: string;
  factuality_score: number | null;
  rouge_1: number | null;
  rouge_2: number | null;
  rouge_l: number | null;
  bert_score: number | null;
}

interface PAccuracyRow {
  article_id: number;
  article_title: string;
  p_accuracy_rouge: number | null;
  avg_pairwise_rouge_l: number | null;
  pairwise_details: string | null;
  computed_at: string | null;
}

// ─── GET /overview ────────────────────────────────────────────────────

managerRoutes.get('/overview', async (_req: Request, res: Response) => {
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
});

// ─── GET /results ─────────────────────────────────────────────────────

managerRoutes.get('/results', async (_req: Request, res: Response) => {
  // Preference stats
  const sessions = await queryAll<SessionRow>(
    'SELECT id, preference, ab_order, generic_summary_id, personalized_summary_id FROM experiment_sessions WHERE preference IS NOT NULL'
  );

  let personalizedChosen = 0;
  let genericChosen = 0;
  for (const s of sessions) {
    const abOrder = safeJsonParse<AbOrder>(s.ab_order);
    if (!abOrder || !s.preference) continue;
    const chosenType = abOrder[s.preference as 'A' | 'B'];
    if (chosenType === 'personalized') personalizedChosen++;
    else if (chosenType === 'generic') genericChosen++;
  }

  // Likert by type
  const ratings = await queryAll<RatingWithSession>(`
    SELECT sr.summary_id, es.generic_summary_id, es.personalized_summary_id,
           p.experience_level, sr.utilidade, sr.clareza, sr.adequacao_perfil, sr.factualidade_percebida
    FROM summary_ratings sr
    JOIN experiment_sessions es ON sr.session_id = es.id
    JOIN participants p ON es.participant_id = p.id
  `);

  const likertAccum = {
    generic: { utilidade: 0, clareza: 0, adequacao: 0, factualidade: 0, count: 0 },
    personalized: { utilidade: 0, clareza: 0, adequacao: 0, factualidade: 0, count: 0 },
  };

  const profileAccum: Record<string, Record<string, { utilidade: number; clareza: number; adequacao: number; factualidade: number; count: number }>> = {};

  for (const r of ratings) {
    const type = r.summary_id === r.generic_summary_id ? 'generic'
      : r.summary_id === r.personalized_summary_id ? 'personalized'
      : null;
    if (!type) continue;

    likertAccum[type].utilidade += r.utilidade;
    likertAccum[type].clareza += r.clareza;
    likertAccum[type].adequacao += r.adequacao_perfil;
    likertAccum[type].factualidade += r.factualidade_percebida;
    likertAccum[type].count++;

    const level = r.experience_level;
    if (!profileAccum[level]) {
      profileAccum[level] = {
        generic: { utilidade: 0, clareza: 0, adequacao: 0, factualidade: 0, count: 0 },
        personalized: { utilidade: 0, clareza: 0, adequacao: 0, factualidade: 0, count: 0 },
      };
    }
    profileAccum[level][type].utilidade += r.utilidade;
    profileAccum[level][type].clareza += r.clareza;
    profileAccum[level][type].adequacao += r.adequacao_perfil;
    profileAccum[level][type].factualidade += r.factualidade_percebida;
    profileAccum[level][type].count++;
  }

  const avg = (sum: number, count: number) => count > 0 ? Math.round((sum / count) * 100) / 100 : 0;

  const likertByType = {
    generic: {
      utilidade: avg(likertAccum.generic.utilidade, likertAccum.generic.count),
      clareza: avg(likertAccum.generic.clareza, likertAccum.generic.count),
      adequacao: avg(likertAccum.generic.adequacao, likertAccum.generic.count),
      factualidade: avg(likertAccum.generic.factualidade, likertAccum.generic.count),
    },
    personalized: {
      utilidade: avg(likertAccum.personalized.utilidade, likertAccum.personalized.count),
      clareza: avg(likertAccum.personalized.clareza, likertAccum.personalized.count),
      adequacao: avg(likertAccum.personalized.adequacao, likertAccum.personalized.count),
      factualidade: avg(likertAccum.personalized.factualidade, likertAccum.personalized.count),
    },
  };

  const likertByProfile: Record<string, Record<string, { utilidade: number; clareza: number; adequacao: number; factualidade: number }>> = {};
  for (const [level, types] of Object.entries(profileAccum)) {
    likertByProfile[level] = {};
    for (const [type, accum] of Object.entries(types)) {
      likertByProfile[level][type] = {
        utilidade: avg(accum.utilidade, accum.count),
        clareza: avg(accum.clareza, accum.count),
        adequacao: avg(accum.adequacao, accum.count),
        factualidade: avg(accum.factualidade, accum.count),
      };
    }
  }

  // Feedback cycle
  const improvementRows = await queryAll<ImprovementRow>(
    'SELECT improvement_rating, COUNT(*) as count FROM regenerations WHERE improvement_rating IS NOT NULL GROUP BY improvement_rating'
  );
  const feedbackCycle: Record<string, number> = { improved: 0, same: 0, worse: 0, total: 0 };
  for (const row of improvementRows) {
    feedbackCycle[row.improvement_rating] = parseInt(row.count, 10);
    feedbackCycle.total += parseInt(row.count, 10);
  }

  // Regenerated likert
  const regenAvg = await queryOne<RegenAvgRow>(
    'SELECT AVG(utility_rating) as avg_utility, AVG(clarity_rating) as avg_clarity, AVG(adequacy_rating) as avg_adequacy FROM regenerations WHERE utility_rating IS NOT NULL'
  );
  const regeneratedLikert = {
    utilidade: regenAvg?.avg_utility ? Math.round(parseFloat(regenAvg.avg_utility) * 100) / 100 : 0,
    clareza: regenAvg?.avg_clarity ? Math.round(parseFloat(regenAvg.avg_clarity) * 100) / 100 : 0,
    adequacao: regenAvg?.avg_adequacy ? Math.round(parseFloat(regenAvg.avg_adequacy) * 100) / 100 : 0,
  };

  // P-Accuracy scores
  const pAccuracyScores = await queryAll<PAccuracyRow>(`
    SELECT pa.article_id, a.title as article_title,
           pa.p_accuracy_rouge, pa.avg_pairwise_rouge_l, pa.pairwise_details, pa.computed_at
    FROM p_accuracy_scores pa
    JOIN articles a ON pa.article_id = a.id
    ORDER BY pa.article_id
  `);

  res.json({
    preferenceStats: {
      personalizedChosen,
      genericChosen,
      total: personalizedChosen + genericChosen,
    },
    likertByType,
    likertByProfile,
    feedbackCycle,
    regeneratedLikert,
    pAccuracy: pAccuracyScores.map(pa => ({
      articleId: pa.article_id,
      articleTitle: pa.article_title,
      pAccuracyRouge: pa.p_accuracy_rouge,
      avgPairwiseRougeL: pa.avg_pairwise_rouge_l,
      pairwiseDetails: safeJsonParse(pa.pairwise_details),
      computedAt: pa.computed_at,
    })),
  });
});

// ─── GET /participants ────────────────────────────────────────────────

managerRoutes.get('/participants', async (_req: Request, res: Response) => {
  const participants = await queryAll<ParticipantRow>(
    'SELECT id, name, experience_level, years_experience, reading_frequency, topic_familiarity, created_at FROM participants ORDER BY id'
  );

  const participantIds = participants.map(p => p.id);
  if (participantIds.length === 0) {
    return res.json([]);
  }

  // Fetch all sessions for these participants
  const allSessions = await queryAll<SessionDetailRow>(`
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
  for (const s of allSessions as (SessionDetailRow & { participant_id: number })[]) {
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
});

// ─── GET /summaries ───────────────────────────────────────────────────

const PROFILE_LABELS: Record<number, string> = {
  99: 'Genérico',
  100: 'Júnior',
  101: 'Pleno',
  102: 'Sênior',
};

managerRoutes.get('/summaries', async (_req: Request, res: Response) => {
  const summaries = await queryAll<SummaryRow>(`
    SELECT s.id, s.article_id, a.title as article_title, s.profile_id, s.content,
           s.factuality_score, s.rouge_1, s.rouge_2, s.rouge_l, s.bert_score
    FROM summaries s
    JOIN articles a ON s.article_id = a.id
    ORDER BY s.id
  `);

  const pAccuracyRows = await queryAll<PAccuracyRow>(`
    SELECT pa.article_id, a.title as article_title,
           pa.p_accuracy_rouge, pa.avg_pairwise_rouge_l, pa.pairwise_details, pa.computed_at
    FROM p_accuracy_scores pa
    JOIN articles a ON pa.article_id = a.id
    ORDER BY pa.article_id
  `);

  const pAccuracyByArticle = new Map<number, {
    pAccuracyRouge: number | null;
    avgPairwiseRougeL: number | null;
    pairwiseDetails: unknown;
    computedAt: string | null;
  }>();
  for (const pa of pAccuracyRows) {
    pAccuracyByArticle.set(pa.article_id, {
      pAccuracyRouge: pa.p_accuracy_rouge,
      avgPairwiseRougeL: pa.avg_pairwise_rouge_l,
      pairwiseDetails: safeJsonParse(pa.pairwise_details),
      computedAt: pa.computed_at,
    });
  }

  res.json({
    summaries: summaries.map(s => ({
      id: s.id,
      articleId: s.article_id,
      articleTitle: s.article_title,
      profileId: s.profile_id,
      profileLabel: PROFILE_LABELS[s.profile_id] ?? `Profile ${s.profile_id}`,
      content: s.content,
      factualityScore: s.factuality_score,
      rouge1: s.rouge_1,
      rouge2: s.rouge_2,
      rougeL: s.rouge_l,
      bertScore: s.bert_score,
    })),
    pAccuracy: pAccuracyRows.map(pa => ({
      articleId: pa.article_id,
      articleTitle: pa.article_title,
      pAccuracyRouge: pa.p_accuracy_rouge,
      avgPairwiseRougeL: pa.avg_pairwise_rouge_l,
      pairwiseDetails: safeJsonParse(pa.pairwise_details),
      computedAt: pa.computed_at,
    })),
  });
});

// ─── GET /export/:type ────────────────────────────────────────────────

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function buildCsv(headers: string[], rows: unknown[][]): string {
  const headerLine = headers.join(',');
  const dataLines = rows.map(row => row.map(escapeCsv).join(','));
  return [headerLine, ...dataLines].join('\n');
}

interface ExportParticipantRow {
  id: number;
  name: string;
  experience_level: string;
  years_experience: number;
  reading_frequency: string;
  topic_familiarity: string;
  created_at: string;
}

interface ExportRatingRow {
  participant_id: number;
  participant_name: string;
  experience_level: string;
  article_id: number;
  article_title: string;
  summary_id: number;
  generic_summary_id: number;
  personalized_summary_id: number;
  utilidade: number;
  clareza: number;
  adequacao_perfil: number;
  factualidade_percebida: number;
  comment: string | null;
  preference: string | null;
  preference_reason: string | null;
}

interface ExportFeedbackRow {
  participant_id: number;
  participant_name: string;
  session_id: number;
  article_title: string;
  feedback_text: string;
  improvement_rating: string | null;
  utility_rating: number | null;
  clarity_rating: number | null;
  adequacy_rating: number | null;
  change_description: string | null;
}

interface ExportPostTestRow {
  participant_id: number;
  participant_name: string;
  noticed_difference: string | null;
  difference_type: string | null;
  would_use_daily: string | null;
  improvements: string | null;
  comments: string | null;
}

async function getParticipantsCsv(): Promise<string> {
  const rows = await queryAll<ExportParticipantRow>(
    'SELECT id, name, experience_level, years_experience, reading_frequency, topic_familiarity, created_at FROM participants ORDER BY id'
  );
  return buildCsv(
    ['id', 'nome', 'nivel', 'anos_experiencia', 'frequencia_leitura', 'familiaridade_tema', 'data_registro'],
    rows.map(r => [r.id, r.name, r.experience_level, r.years_experience, r.reading_frequency, r.topic_familiarity, r.created_at])
  );
}

async function getRatingsCsv(): Promise<string> {
  const rows = await queryAll<ExportRatingRow>(`
    SELECT p.id as participant_id, p.name as participant_name, p.experience_level,
           es.article_id, a.title as article_title,
           sr.summary_id, es.generic_summary_id, es.personalized_summary_id,
           sr.utilidade, sr.clareza, sr.adequacao_perfil, sr.factualidade_percebida, sr.comment,
           es.preference, es.preference_reason
    FROM summary_ratings sr
    JOIN experiment_sessions es ON sr.session_id = es.id
    JOIN participants p ON es.participant_id = p.id
    JOIN articles a ON es.article_id = a.id
    ORDER BY p.id, es.id
  `);
  return buildCsv(
    ['participante_id', 'participante_nome', 'participante_nivel', 'artigo_id', 'artigo_titulo', 'tipo_resumo', 'utilidade', 'clareza', 'adequacao_perfil', 'factualidade_percebida', 'comentario', 'preferencia', 'motivo_preferencia'],
    rows.map(r => {
      const tipo = r.summary_id === r.generic_summary_id ? 'generico'
        : r.summary_id === r.personalized_summary_id ? 'personalizado'
        : 'desconhecido';
      return [r.participant_id, r.participant_name, r.experience_level, r.article_id, r.article_title, tipo, r.utilidade, r.clareza, r.adequacao_perfil, r.factualidade_percebida, r.comment, r.preference, r.preference_reason];
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

managerRoutes.get('/export/:type', async (req: Request, res: Response) => {
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
});
