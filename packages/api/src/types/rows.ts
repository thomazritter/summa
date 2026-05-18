/**
 * Shared database row interfaces. These map directly to column names
 * (snake_case) and are used as type parameters for queryOne/queryAll calls.
 */

export interface ParticipantRow {
  id: number;
  name: string;
  // Four dimensions plus a per-dimension `_manual` flag marking whether the
  // value was last set via manual UI edit (true) or via questionnaire/CV.
  // Questionnaire and CV are frontend input paths that write the same columns;
  // the flag preserves the source badge ("Derivado" vs "Editado manualmente").
  expertise: string | null;
  focus: string | null;
  depth: string | null;
  context: string | null;
  expertise_manual: boolean;
  focus_manual: boolean;
  depth_manual: boolean;
  context_manual: boolean;
  domain: string | null;
  current_project: string | null;
  domain_manual: boolean | null;
  current_project_manual: boolean | null;
  // Initial input path (questionnaire | cv). Informational only — both paths
  // write the same value columns.
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
  content: string;
  model_id: string | null;
  /** JSONB — dimensions + auxiliary preferences active at generation time. */
  profile_snapshot: string;
  parent_summary_id: number | null;
  factuality_score: number | null;
  factuality_details: string | null;
  completeness_score: number | null;
  conciseness_score: number | null;
  /** Serialized JSONB: KeyfactAlignment[] from KeyfactAlignmentResult. */
  factuality_keyfacts: string | null;
  factuality_status: 'pending' | 'complete' | 'failed' | 'skipped' | null;
  generated_at: string;
}
