/**
 * Shared database row interfaces used across route handlers and services.
 *
 * These map directly to database column names (snake_case) and are used
 * as type parameters for queryOne/queryAll calls.
 */

// ─── Shared Constants ────────────────────────────────────────────────

/** Profile ID used for generic (non-personalized) summaries. */
export const GENERIC_PROFILE_ID = 99;

// ─── Row Interfaces ──────────────────────────────────────────────────

export interface ParticipantRow {
  id: number;
  name: string;
  experience_level: string;
  years_experience: number;
  reading_frequency: string;
  topic_familiarity: string;
  structure_preference: string | null;
  reading_goal: string | null;
  preferred_length: string | null;
  english_comfort: string | null;
  override_expertise: string | null;
  override_focus: string | null;
  override_depth: string | null;
  override_context: string | null;
  domain: string | null;
  current_project: string | null;
  profile_source: string;
  created_at: string;
}

export interface SessionRow {
  id: number;
  participant_id: number;
  article_id: number;
  profile_id: number;
  generic_summary_id: number;
  personalized_summary_id: number;
  ab_order: string;
  preference: string | null;
  preference_rating: number | null;
  preference_reason: string | null;
  phase: string;
  profile_snapshot: string | null;
  created_at: string;
}

export interface RegenerationRow {
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

export interface ArticleRow {
  id: number;
  title: string;
  authors: string | null;
  year: number | null;
  doi: string | null;
  url: string | null;
  raw_text: string;
  structured_content: string;
  uploaded_by: number | null;
  created_at: string;
}

export interface SummaryRow {
  id: number;
  article_id: number;
  profile_id: number;
  content: string;
  factuality_score: number | null;
  factuality_details: string | null;
  model_id: string | null;
  generated_at: string;
}

// ─── Manager-specific row interfaces ─────────────────────────────────

export interface CountRow {
  count: string;
}

export interface PhaseRow {
  phase: string;
  count: string;
}

export interface AbOrder {
  A: 'generic' | 'personalized';
  B: 'generic' | 'personalized';
}

export interface RatingWithSession {
  summary_id: number;
  generic_summary_id: number;
  personalized_summary_id: number;
  experience_level: string;
  utilidade: number;
  clareza: number;
  adequacao_perfil: number;
  factualidade_percebida: number;
}

export interface ImprovementRow {
  improvement_rating: string;
  count: string;
}

export interface RegenAvgRow {
  avg_utility: string | null;
  avg_clarity: string | null;
  avg_adequacy: string | null;
}

export interface SessionDetailRow {
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

export interface RatingRow {
  session_id: number;
  summary_id: number;
  ab_label: string;
  utilidade: number;
  clareza: number;
  adequacao_perfil: number;
  factualidade_percebida: number;
  comment: string | null;
}

export interface PostTestRow {
  participant_id: number;
  noticed_difference: string | null;
  difference_type: string | null;
  would_use_daily: string | null;
  improvements: string | null;
  comments: string | null;
}

export interface ManagerSummaryRow {
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

export interface DeleteParticipantRow {
  id: number;
  name: string;
}

export interface ExportParticipantRow {
  id: number;
  name: string;
  experience_level: string;
  years_experience: number;
  reading_frequency: string;
  topic_familiarity: string;
  structure_preference: string | null;
  reading_goal: string | null;
  preferred_length: string | null;
  english_comfort: string | null;
  created_at: string;
}

export interface ExportEvaluationRow {
  participant_id: number;
  participant_name: string;
  experience_level: string;
  session_id: number;
  article_title: string;
  preference: string | null;
  preference_rating: number | null;
  preference_reason: string | null;
  ab_order: string;
  generic_summary_id: number;
  personalized_summary_id: number;
}

export interface ExportFeedbackRow {
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

export interface ExportPostTestRow {
  participant_id: number;
  participant_name: string;
  noticed_difference: string | null;
  difference_type: string | null;
  would_use_daily: string | null;
  improvements: string | null;
  comments: string | null;
}
