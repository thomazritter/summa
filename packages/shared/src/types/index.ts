// Profile dimensions — the four typed values the prompt builder consumes.
export type ExpertiseLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';
export type FocusArea = 'concepts' | 'methodology' | 'results' | 'applications' | 'all';
export type DepthLevel = 'brief' | 'moderate' | 'detailed' | 'comprehensive';
export type ReadingContext = 'quick_review' | 'learning' | 'research' | 'teaching';

/** Profile entity used as the prompt-input contract. The summarization
 *  pipeline never persists this directly — generation reads dimensions
 *  from the participant row and snapshots them on the summary. */
export interface Profile {
  id: number;
  userId: number;
  name: string;
  expertise: ExpertiseLevel;
  focus: FocusArea;
  depth: DepthLevel;
  context: ReadingContext;
  customPreferences?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Article ──────────────────────────────────────────────────────────

export interface Article {
  id: number;
  title: string;
  authors: string;
  year: number | null;
  doi: string | null;
  url: string | null;
  rawText: string;
  structuredContent: ArticleStructure;
  createdAt: Date;
}

export interface ArticleStructure {
  title?: string;
  authors?: string;
  abstract?: string;
  introduction?: string;
  methodology?: string;
  results?: string;
  discussion?: string;
  conclusion?: string;
  sections: ArticleSection[];
}

export interface ArticleSection {
  title: string;
  content: string;
  level: number;
}

// ─── Summary ──────────────────────────────────────────────────────────

export interface Summary {
  id: number;
  articleId: number;
  content: string;
  factualityScore: number | null;
  factualityDetails: FactualityResult[] | null;
  modelId: string | null;
  parentSummaryId: number | null;
  generatedAt: Date;
}

/** FineSurE per-sentence verdict, exposed by the factuality verification
 *  pipeline (Song et al. 2024). */
export interface FactualityResult {
  sentence: string;
  label: 'supported' | 'contradicted' | 'neutral';
  confidence: number;
  /** FineSurE 9-category classification (e.g. "no error", "entity error"). */
  category: string;
  /** LLM rationale explaining the category assignment. */
  rationale: string;
}

// ─── Participant ──────────────────────────────────────────────────────

export interface Participant {
  id: number;
  name: string;
  expertise: ExpertiseLevel;
  focus: FocusArea;
  depth: DepthLevel;
  context: ReadingContext;
  domain: string | null;
  currentProject: string | null;
  createdAt: string;
}

export interface RegisterParticipantRequest {
  name: string;
  expertise: ExpertiseLevel;
  focus: FocusArea;
  depth: DepthLevel;
  context: ReadingContext;
}

// ─── Profile Editor ───────────────────────────────────────────────────

export interface ProfileResponse {
  dimensions: {
    expertise: ExpertiseLevel;
    focus: FocusArea;
    depth: DepthLevel;
    context: ReadingContext;
    domain: string | null;
    currentProject: string | null;
  };
  sources: Record<string, string>;
  profileSource: string;
}

export interface UpdateProfileRequest {
  overrides: {
    expertise?: ExpertiseLevel;
    focus?: FocusArea;
    depth?: DepthLevel;
    context?: ReadingContext;
    domain?: string;
    currentProject?: string;
  };
}

// ─── Auth ─────────────────────────────────────────────────────────────

export interface AccessCode {
  code: string;
  email: string;
  role: 'participant' | 'manager';
  participantId: number | null;
}
