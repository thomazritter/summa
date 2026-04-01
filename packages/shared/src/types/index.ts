// User entity
export interface User {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

// Profile entity - extensible design
export type ExpertiseLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';
export type FocusArea = 'concepts' | 'methodology' | 'results' | 'applications' | 'all';
export type DepthLevel = 'brief' | 'moderate' | 'detailed' | 'comprehensive';
export type ReadingContext = 'quick_review' | 'learning' | 'research' | 'teaching';

export interface Profile {
  id: number;
  userId: number;
  name: string;
  expertise: ExpertiseLevel;
  focus: FocusArea;
  depth: DepthLevel;
  context: ReadingContext;
  // Extensible preferences stored as JSON
  customPreferences?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// Article entity
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

// Summary entity
export interface Summary {
  id: number;
  articleId: number;
  profileId: number;
  content: string;
  factualityScore: number | null;
  factualityDetails: FactualityResult[] | null;
  generatedAt: Date;
}

// Feedback entity
export interface Feedback {
  id: number;
  summaryId: number;
  userId: number;
  utilityRating: number; // 1-5
  technicalLevelRating: number; // 1-5 (1=too simple, 5=too complex)
  depthRating: number; // 1-5 (1=too brief, 5=too detailed)
  comments: string | null;
  createdAt: Date;
}

// Factuality verification types
export interface FactualityResult {
  sentence: string;
  label: 'supported' | 'contradicted' | 'neutral';
  confidence: number;
  sourceSentence?: string;
}

// API request/response types
export interface CreateProfileRequest {
  name: string;
  expertise: ExpertiseLevel;
  focus: FocusArea;
  depth: DepthLevel;
  context: ReadingContext;
}

export interface GenerateSummaryRequest {
  articleId: number;
  profileId: number;
}

export interface SubmitFeedbackRequest {
  summaryId: number;
  utilityRating: number;
  technicalLevelRating: number;
  depthRating: number;
  comments?: string;
}

// Profile questionnaire types
export interface ProfileQuestion {
  id: string;
  question: string;
  options: ProfileQuestionOption[];
  targetField: keyof CreateProfileRequest;
}

export interface ProfileQuestionOption {
  value: string;
  label: string;
  description: string;
}

// ─── Experiment Mode Types ──────────────────────────────────────────

export type ExperienceLevel = 'junior' | 'pleno' | 'senior';
export type ReadingFrequency = 'never' | 'rarely' | 'sometimes' | 'frequently';
export type TopicFamiliarity = 'none' | 'little' | 'moderate' | 'high';

export interface Participant {
  id: number;
  name: string;
  experienceLevel: ExperienceLevel;
  yearsExperience: number;
  readingFrequency: ReadingFrequency;
  topicFamiliarity: TopicFamiliarity;
  createdAt: string;
}

export interface ExperimentSession {
  id: number;
  participantId: number;
  articleId: number;
  profileId: number;
  genericSummaryId: number;
  personalizedSummaryId: number;
  abOrder: { A: 'generic' | 'personalized'; B: 'generic' | 'personalized' };
  preference: 'A' | 'B' | null;
  phase: 'comparison' | 'feedback' | 'regenerated' | 'complete';
  createdAt: string;
}

export interface Regeneration {
  id: number;
  sessionId: number;
  feedbackText: string;
  regeneratedSummaryId: number;
  improvementRating: 'improved' | 'same' | 'worse' | null;
  createdAt: string;
}

// API request types for experiment
export interface RegisterParticipantRequest {
  name: string;
  experienceLevel: ExperienceLevel;
  yearsExperience: number;
  readingFrequency: ReadingFrequency;
  topicFamiliarity: TopicFamiliarity;
}

export interface CreateExperimentSessionRequest {
  participantId: number;
  articleId: number;
}

export interface RecordPreferenceRequest {
  preference: 'A' | 'B';
}

export interface SubmitExperimentFeedbackRequest {
  feedbackText: string;
}

export interface RateRegenerationRequest {
  improvementRating: 'improved' | 'same' | 'worse';
}

// Generic summary — summary generated without profile parameterization
export interface GenericSummaryRequest {
  articleId: number;
}
