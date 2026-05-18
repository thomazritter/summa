import type { ProfileDimensions } from './summarizationService.js';
import type { ParticipantRow } from '../types/rows.js';
import type { ParticipantPreferences } from './promptBuilder.js';

// ─── Participant profile derivation ──────────────────────────────────
//
// Reduces a participant row (questionnaire answers, CV-inferred dimensions,
// manual overrides, auxiliary preferences) to the four typed dimensions the
// prompts consume + the personalization context every summarize call needs.

/** Fallback dimensions when a participant is missing all four values
 *  (should not happen post-onboarding; kept as a defensive default). */
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
    domain: participant.domain || null,
    currentProject: participant.current_project || null,
  };
}

export interface PersonalizationContext {
  dimensions: ProfileDimensions;
  preferences: ParticipantPreferences | undefined;
}

/**
 * Personalization payload for every summarize call: the four profile
 * dimensions plus auxiliary preferences. Returns `preferences: undefined`
 * when neither domain nor currentProject is set, so callers can pass
 * it straight through to generatePersonalizedSummary.
 */
export function buildPersonalizationContext(participant: ParticipantRow): PersonalizationContext {
  const preferences: ParticipantPreferences = {
    domain: participant.domain ?? undefined,
    currentProject: participant.current_project ?? undefined,
  };
  const hasAny = preferences.domain || preferences.currentProject;
  return {
    dimensions: computeProfileDimensions(participant),
    preferences: hasAny ? preferences : undefined,
  };
}
