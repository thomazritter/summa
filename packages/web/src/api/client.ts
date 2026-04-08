const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) };
  const code = sessionStorage.getItem('accessCode');
  if (code) {
    headers['x-access-code'] = code;
  }
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  if (response.status === 204) return {} as T;
  return response.json();
}

export const profileApi = {
  getQuestionnaire: () => apiRequest<unknown[]>('/profiles/questionnaire'),
  getByUser: (userId: number) => apiRequest<unknown[]>(`/profiles/user/${userId}`),
  create: (userId: number, data: unknown) => apiRequest<unknown>(`/profiles/${userId}`, { method: 'POST', body: JSON.stringify(data) }),
};

export const articleApi = {
  upload: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/articles/upload`, { method: 'POST', body: formData });
    if (!response.ok) throw new Error('Upload failed');
    return response.json();
  },
};

export const summaryApi = {
  generate: (articleId: number, profileId: number) => apiRequest<unknown>('/summaries/generate', { method: 'POST', body: JSON.stringify({ articleId, profileId }) }),
  get: (id: number) => apiRequest<unknown>(`/summaries/${id}`),
  regenerate: (id: number) => apiRequest<unknown>(`/summaries/${id}/regenerate`, { method: 'POST' }),
};

export const feedbackApi = {
  submit: (data: unknown) => apiRequest<unknown>('/feedback', { method: 'POST', body: JSON.stringify(data) }),
};

export const authApi = {
  login: (code: string) =>
    apiRequest<{ code: string; email: string; role: string; participantId: number | null }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  invite: (email: string) =>
    apiRequest<{ code: string; email: string }>('/auth/invite', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  listCodes: () =>
    apiRequest<Array<{
      id: number;
      code: string;
      email: string;
      role: string;
      participant_id: number | null;
      used_at: string | null;
      created_at: string;
    }>>('/auth/codes'),
};

export const managerApi = {
  getOverview: () => apiRequest<{
    totalInvited: number;
    totalCompleted: number;
    completionRate: number;
    sessionsByPhase: { complete: number; feedback: number; comparison: number; regenerated: number };
  }>('/manager/overview'),

  getResults: () => apiRequest<{
    preferencePersonalized: { count: number; total: number; percentage: number };
    preferenceGeneric: { count: number; total: number; percentage: number };
    likertByType: {
      generic: { utilidade: number; clareza: number; adequacao: number; factualidade: number };
      personalized: { utilidade: number; clareza: number; adequacao: number; factualidade: number };
    };
    likertByProfile: Record<string, {
      generic: { utilidade: number; clareza: number; adequacao: number; factualidade: number };
      personalized: { utilidade: number; clareza: number; adequacao: number; factualidade: number };
    }>;
    feedbackCycle: { improved: number; same: number; worse: number; total: number };
    regeneratedLikert: { utilidade: number; clareza: number; adequacao: number };
    hasData: boolean;
  }>('/manager/results'),

  getParticipants: () => apiRequest<Array<{
    id: number;
    name: string;
    experienceLevel: string;
    yearsExperience: number;
    hasPostTest: boolean;
    postTestResponses: Record<string, string> | null;
    sessions: Array<{
      id: number;
      articleTitle: string;
      phase: string;
      preference: string | null;
      preferenceDecoded: string | null;
      preferenceReason: string | null;
      ratings: Array<{
        label: string;
        utilidade: number;
        clareza: number;
        adequacao: number;
        factualidade: number;
        comment: string | null;
      }>;
      regeneration: {
        feedbackText: string;
        improvementRating: string | null;
        ratings: { utilidade: number; clareza: number; adequacao: number } | null;
      } | null;
    }>;
  }>>('/manager/participants'),

  getSummaries: () => apiRequest<{
    summaries: Array<{
      id: number;
      articleTitle: string;
      profileLabel: string;
      content: string;
      rouge1: number | null;
      rouge2: number | null;
      rougeL: number | null;
      bertScore: number | null;
      factualityScore: number | null;
    }>;
    pAccuracy: Array<{
      articleId: number;
      articleTitle: string;
      pAccuracyRouge: number;
      avgPairwiseRougeL: number;
    }>;
  }>('/manager/summaries'),

  deleteParticipant: (id: number) =>
    apiRequest<{ success: boolean; message: string }>(`/manager/participants/${id}`, {
      method: 'DELETE',
    }),

  exportCsv: (type: string) => {
    const headers: Record<string, string> = {};
    const code = sessionStorage.getItem('accessCode');
    if (code) {
      headers['x-access-code'] = code;
    }
    return fetch(`${API_BASE}/manager/export/${type}`, { headers });
  },
};

export const experimentApi = {
  registerParticipant: (data: {
    name: string;
    experienceLevel: string;
    yearsExperience: number;
    readingFrequency: string;
    topicFamiliarity: string;
  }) =>
    apiRequest<{ id: number; name: string; experienceLevel: string }>('/experiment/participants', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getParticipant: (id: number) =>
    apiRequest<{ id: number; name: string; experienceLevel: string }>(`/experiment/participants/${id}`),

  getParticipantSessions: (participantId: number) =>
    apiRequest<Array<{ id: number; phase: string; articleId: number }>>(`/experiment/participants/${participantId}/sessions`),

  getArticles: () =>
    apiRequest<Array<{ id: number; title: string; authors: string | null; year: number | null; url: string | null }>>('/experiment/articles'),

  createSession: (participantId: number, articleId: number) =>
    apiRequest<{
      id: number;
      participantId: number;
      articleId: number;
      phase: string;
    }>('/experiment/sessions', {
      method: 'POST',
      body: JSON.stringify({ participantId, articleId }),
    }),

  getSession: (sessionId: number) =>
    apiRequest<{
      id: number;
      participantId: number;
      articleId: number;
      profileId: number;
      abOrder: { A: string; B: string };
      preference: string | null;
      phase: string;
      summaryA: { id: number; content: string } | null;
      summaryB: { id: number; content: string } | null;
    }>(`/experiment/sessions/${sessionId}`),

  recordPreference: (sessionId: number, preference: 'A' | 'B') =>
    apiRequest<unknown>(`/experiment/sessions/${sessionId}/preference`, {
      method: 'POST',
      body: JSON.stringify({ preference }),
    }),

  submitFeedback: (sessionId: number, feedbackText: string) =>
    apiRequest<{
      id: number;
      sessionId: number;
      feedbackText: string;
      regeneratedSummaryId: number;
    }>(`/experiment/sessions/${sessionId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ feedbackText }),
    }),

  getRegenerated: (sessionId: number) =>
    apiRequest<{
      id: number;
      sessionId: number;
      feedbackText: string;
      improvementRating: string | null;
      summary: { id: number; content: string } | null;
    }>(`/experiment/sessions/${sessionId}/regenerated`),

  rateRegeneration: (sessionId: number, data: {
    improvementRating: 'improved' | 'same' | 'worse';
    utilityRating: number;
    clarityRating: number;
    adequacyRating: number;
    changeDescription?: string;
  }) =>
    apiRequest<unknown>(`/experiment/sessions/${sessionId}/rate-regeneration`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  submitRatingsAndPreference: (sessionId: number, data: {
    ratings: Array<{
      summaryId: number;
      abLabel: 'A' | 'B';
      utilidade: number;
      clareza: number;
      adequacaoPerfil: number;
      factualidadePercebida: number;
      comment?: string;
    }>;
    preference: 'A' | 'B';
    preferenceReason?: string;
  }) =>
    apiRequest<{ success: boolean }>(`/experiment/sessions/${sessionId}/ratings`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  submitPostTest: (data: {
    participantId: number;
    noticedDifference: string;
    differenceType?: string;
    wouldUseDaily: string;
    improvements?: string;
    comments?: string;
  }) =>
    apiRequest<{ success: boolean }>('/experiment/post-test', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
