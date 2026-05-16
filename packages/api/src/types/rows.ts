/**
 * Shared database row interfaces used across route handlers and services.
 *
 * These map directly to database column names (snake_case) and are used
 * as type parameters for queryOne/queryAll calls.
 */

// ─── Shared Constants ────────────────────────────────────────────────
//
// The `profiles` table is seeded with two flavours of generic summaries
// (with vs. without translation) and three persona templates that back the
// `experience_level` slots. Everything that filters or branches on these
// IDs should reference the constants below instead of bare numbers.

/** Profile ID used for the generic (control) summaries. */
export const GENERIC_PROFILE_IDS = {
  keepEnglish: 99,
} as const;
/** All generic profile IDs as an array. Profile 98 (legacy translated variant)
 *  is kept in historical rows but no new summaries are generated under it. */
export const ALL_GENERIC_PROFILE_IDS: readonly number[] = [98, 99];
/** @deprecated Use GENERIC_PROFILE_IDS.keepEnglish instead. */
export const GENERIC_PROFILE_ID = GENERIC_PROFILE_IDS.keepEnglish;

/** Profile IDs for the persona templates that back each experience level. */
export const PARTICIPANT_PROFILE_IDS = {
  junior: 100,
  pleno: 101,
  senior: 102,
} as const;

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
  override_expertise: string | null;
  override_focus: string | null;
  override_depth: string | null;
  override_context: string | null;
  cv_expertise: string | null;
  cv_focus: string | null;
  cv_depth: string | null;
  cv_context: string | null;
  domain: string | null;
  current_project: string | null;
  structure_preference_manual: boolean | null;
  domain_manual: boolean | null;
  current_project_manual: boolean | null;
  profile_source: string;
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
  completeness_score: number | null;
  conciseness_score: number | null;
  /** Serialized JSONB: KeyfactAlignment[] from KeyfactAlignmentResult. */
  factuality_keyfacts: string | null;
  model_id: string | null;
  parent_summary_id: number | null;
  profile_snapshot: string | null;
  factuality_status: 'pending' | 'complete' | 'failed' | 'skipped' | null;
  generated_at: string;
}

