import { queryOne } from '../db/connection.js';
import { safeJsonParse } from '../utils/validation.js';
import type { Profile, ProfileQuestion } from '@summarizer/shared';
import type { ProfileDimensions } from './summarizationService.js';
import type { ParticipantRow } from '../types/rows.js';

// Initial questionnaire for new users. Kept as a static source-of-truth for
// the dimension labels and option descriptions used by the frontend; if you
// add a new dimension, mirror it here so the questionnaire stays in sync.
export const profileQuestions: ProfileQuestion[] = [
  {
    id: 'expertise',
    question: 'What is your level of familiarity with scientific literature?',
    targetField: 'expertise',
    options: [
      { value: 'beginner', label: 'Beginner', description: 'New to academic papers' },
      { value: 'intermediate', label: 'Intermediate', description: 'Read papers occasionally' },
      { value: 'advanced', label: 'Advanced', description: 'Regularly read papers in my field' },
      { value: 'expert', label: 'Expert', description: 'Publish and review papers' },
    ],
  },
  {
    id: 'focus',
    question: 'What aspect of articles interests you most?',
    targetField: 'focus',
    options: [
      { value: 'concepts', label: 'Core Concepts', description: 'Main ideas and theory' },
      { value: 'methodology', label: 'Methodology', description: 'How the research was done' },
      { value: 'results', label: 'Results', description: 'Findings and data' },
      { value: 'applications', label: 'Applications', description: 'Practical implications' },
      { value: 'all', label: 'Balanced', description: 'All aspects equally' },
    ],
  },
  {
    id: 'depth',
    question: 'How detailed do you want your summaries?',
    targetField: 'depth',
    options: [
      { value: 'brief', label: 'Brief', description: 'Quick overview (1-2 paragraphs)' },
      { value: 'moderate', label: 'Moderate', description: 'Standard summary (3-4 paragraphs)' },
      { value: 'detailed', label: 'Detailed', description: 'In-depth summary (5+ paragraphs)' },
      { value: 'comprehensive', label: 'Comprehensive', description: 'Full analysis' },
    ],
  },
  {
    id: 'context',
    question: 'What is your typical reading goal?',
    targetField: 'context',
    options: [
      { value: 'quick_review', label: 'Quick Review', description: 'Assess relevance quickly' },
      { value: 'learning', label: 'Learning', description: 'Understand the topic' },
      { value: 'research', label: 'Research', description: 'Deep analysis for my work' },
      { value: 'teaching', label: 'Teaching', description: 'Prepare to explain to others' },
    ],
  },
];

export const getProfileById = async (id: number): Promise<Profile | null> => {
  const row = await queryOne<ProfileRow>('SELECT * FROM profiles WHERE id = $1', [id]);
  if (!row) {
    return null;
  }
  return mapRowToProfile(row);
};

interface ProfileRow {
  id: number;
  user_id: number;
  name: string;
  expertise: string;
  focus: string;
  depth: string;
  context: string;
  custom_preferences: string | null;
  created_at: string;
  updated_at: string;
}

const mapRowToProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  expertise: row.expertise as Profile['expertise'],
  focus: row.focus as Profile['focus'],
  depth: row.depth as Profile['depth'],
  context: row.context as Profile['context'],
  customPreferences: safeJsonParse<Record<string, unknown>>(row.custom_preferences),
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

// ─── Participant profile derivation ──────────────────────────────────
//
// Reduces participant row columns (questionnaire answers, CV-inferred
// dimensions, manual overrides, auxiliary preferences) to the four
// typed dimensions the prompts consume + the personalization context
// every summarize call needs.

/** Fallback dimensions when a participant is missing all four values
 *  (should not happen post-backfill; kept as a defensive default). */
const DEFAULT_DIMENSIONS: ProfileDimensions = {
  expertise: 'intermediate',
  focus: 'all',
  depth: 'moderate',
  context: 'learning',
};

/**
 * Read the four prompt-facing dimensions straight from the participant row.
 * Questionnaire and CV are frontend input paths that write into these same
 * columns — the backend reads one canonical value per dimension.
 */
export function computeProfileDimensions(participant: ParticipantRow): ProfileDimensions {
  return {
    expertise: (participant.expertise || DEFAULT_DIMENSIONS.expertise) as ProfileDimensions['expertise'],
    focus: (participant.focus || DEFAULT_DIMENSIONS.focus) as ProfileDimensions['focus'],
    depth: (participant.depth || DEFAULT_DIMENSIONS.depth) as ProfileDimensions['depth'],
    context: (participant.context || DEFAULT_DIMENSIONS.context) as ProfileDimensions['context'],
  };
}

/**
 * Per-dimension source labels (`questionnaire`/`cv`/`manual`) so the UI can
 * show where each value came from. `_manual` flags carry the per-dimension
 * manual-edit signal; `profile_source` carries the initial path.
 */
export function computeProfileSources(participant: ParticipantRow): Record<string, string> {
  const dimensionSource = (manualFlag: boolean): string => {
    if (manualFlag) return 'manual';
    return participant.profile_source === 'cv' ? 'cv' : 'questionnaire';
  };

  const auxSource = (value: string | null, manualFlag: boolean | null): string => {
    if (manualFlag) return 'manual';
    if (!value) return 'questionnaire';
    return participant.profile_source === 'cv' ? 'cv' : 'questionnaire';
  };

  return {
    expertise: dimensionSource(participant.expertise_manual),
    focus: dimensionSource(participant.focus_manual),
    depth: dimensionSource(participant.depth_manual),
    context: dimensionSource(participant.context_manual),
    structurePreference: auxSource(participant.structure_preference, participant.structure_preference_manual),
    domain: auxSource(participant.domain, participant.domain_manual),
    currentProject: auxSource(participant.current_project, participant.current_project_manual),
  };
}

/**
 * JSON envelope returned by the profile endpoints. Uses `null` instead
 * of `undefined` for unset fields so the frontend can treat absence
 * consistently.
 */
export function serializeProfileForApi(participant: ParticipantRow) {
  return {
    ...computeProfileDimensions(participant),
    structurePreference: participant.structure_preference || null,
    domain: participant.domain || null,
    currentProject: participant.current_project || null,
  };
}

export interface PersonalizationContext {
  dimensions: ProfileDimensions;
  preferences: import('./promptBuilder.js').ParticipantPreferences | undefined;
}

/**
 * Personalization payload for every summarize call: the four profile
 * dimensions plus auxiliary preferences. Returns `preferences: undefined`
 * when none of structure/domain/currentProject is set, so callers can pass
 * it straight through to generatePersonalizedSummary.
 */
export function buildPersonalizationContext(participant: ParticipantRow): PersonalizationContext {
  const preferences = {
    structurePreference: (participant.structure_preference as 'prose' | 'bullets' | 'mixed' | null) ?? undefined,
    domain: participant.domain ?? undefined,
    currentProject: participant.current_project ?? undefined,
  };
  const hasAny = preferences.structurePreference
    || preferences.domain
    || preferences.currentProject;
  return {
    dimensions: computeProfileDimensions(participant),
    preferences: hasAny ? preferences : undefined,
  };
}
