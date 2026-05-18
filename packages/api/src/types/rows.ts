/**
 * Shared database row interfaces used across route handlers and services.
 *
 * These map directly to database column names (snake_case) and are used
 * as type parameters for queryOne/queryAll calls.
 */

// ─── Shared Constants ────────────────────────────────────────────────
//
// The `profiles` table is seeded with control summaries (profile id 99 for
// the current English-keeping variant; 98 was a legacy translated variant
// kept only for historical rows). New personalized summaries no longer
// reference a profile id — the actual personalization config travels in
// `summaries.profile_snapshot`, and `summaries.profile_id` is now nullable.

/** Profile ID used for the generic (control) summaries. */
export const GENERIC_PROFILE_IDS = {
  keepEnglish: 99,
} as const;
/** All generic profile IDs as an array. Profile 98 (legacy translated variant)
 *  is kept in historical rows but no new summaries are generated under it. */
export const ALL_GENERIC_PROFILE_IDS: readonly number[] = [98, 99];
/** @deprecated Use GENERIC_PROFILE_IDS.keepEnglish instead. */
export const GENERIC_PROFILE_ID = GENERIC_PROFILE_IDS.keepEnglish;

// ─── Row Interfaces ──────────────────────────────────────────────────

export interface ParticipantRow {
  id: number;
  name: string;
  // Four dimensions: a single value per dimension, with a per-dimension
  // `_manual` boolean indicating whether the value was last set via manual
  // UI edit (true) versus the questionnaire or CV path (false). The split
  // collapses the legacy `override_*` / `cv_*` columns into one canonical
  // value, while preserving the source badge ("Derivado" vs "Editado
  // manualmente") on the frontend.
  expertise: string | null;
  focus: string | null;
  depth: string | null;
  context: string | null;
  expertise_manual: boolean;
  focus_manual: boolean;
  depth_manual: boolean;
  context_manual: boolean;
  // Auxiliary preferences (same shape).
  structure_preference: string | null;
  domain: string | null;
  current_project: string | null;
  structure_preference_manual: boolean | null;
  domain_manual: boolean | null;
  current_project_manual: boolean | null;
  // Whether the participant first arrived via questionnaire or CV upload.
  // Informational only — no longer used to compute or override dimensions.
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

