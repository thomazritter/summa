const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
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
    apiRequest<Array<{ id: number; title: string; authors: string | null; year: number | null }>>('/experiment/articles'),

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

  rateRegeneration: (sessionId: number, improvementRating: 'improved' | 'same' | 'worse') =>
    apiRequest<unknown>(`/experiment/sessions/${sessionId}/rate-regeneration`, {
      method: 'POST',
      body: JSON.stringify({ improvementRating }),
    }),
};
