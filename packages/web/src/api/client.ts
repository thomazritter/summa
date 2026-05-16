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

export interface ArticleUploadResponse {
  article: {
    id: number;
    title: string;
    authors: string | null;
    rawText: string;
    structuredContent: Record<string, unknown> | null;
  };
  validation: {
    warnings: string[];
    errors?: string[];
    sectionsFound: string[];
  };
}

export const articleApi = {
  upload: async (file: File): Promise<ArticleUploadResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    const headers: Record<string, string> = {};
    const code = sessionStorage.getItem('accessCode');
    if (code) {
      headers['x-access-code'] = code;
    }
    const response = await fetch(`${API_BASE}/articles/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }
    return response.json();
  },
};

export const authApi = {
  login: (code: string) =>
    apiRequest<{ code: string; email: string; role: string; participantId: number | null }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  requestMagicLink: (email: string) =>
    apiRequest<{ message: string }>('/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email }),
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
    preferenceStats: {
      personalizedChosen: number;
      genericChosen: number;
      total: number;
      personalizedPercentage: number;
      genericPercentage: number;
    };
    ratingByType: {
      personalized: { avgRating: number; count: number };
      generic: { avgRating: number; count: number };
    };
    ratingByProfile: Record<string, {
      avgRating: number;
      count: number;
      personalizedChosen: number;
      total: number;
    }>;
    pAccuracy: Array<{
      articleId: number;
      articleTitle: string;
      pAccuracyRouge: number;
      avgPairwiseRougeL: number;
    }>;
  }>('/manager/results'),

  getParticipants: () => apiRequest<Array<{
    id: number;
    name: string;
    experienceLevel: string;
    yearsExperience: number;
    postTest: Record<string, string> | null;
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

  getProductRatings: () => apiRequest<{
    total: number;
    means: {
      utilidade: number | null;
      clareza: number | null;
      adequacao_perfil: number | null;
      factualidade_percebida: number | null;
    };
    ratings: Array<{
      id: number;
      summaryId: number;
      participantId: number;
      participantName: string | null;
      utilidade: number;
      clareza: number;
      adequacaoPerfil: number;
      factualidadePercebida: number;
      comment: string | null;
      createdAt: string;
    }>;
  }>('/manager/product-ratings'),
};

export interface SummaryResult {
  id: number;
  content: string;
  modelId: string;
  factualityScore: number | null;
}

export const userApi = {
  getArticles: () =>
    apiRequest<Array<{
      id: number;
      title: string;
      authors: string | null;
      createdAt: string;
      pAccuracy: {
        pAccuracyRouge: number | null;
        avgPairwiseRougeL: number | null;
      } | null;
      summaries: Array<{
        id: number;
        content: string;
        modelId: string | null;
        modelLabel: string | null;
        factualityScore: number | null;
        factualityDetails: Array<{
          sentence: string;
          label: 'supported' | 'neutral' | 'contradicted';
          confidence: number;
          category: string;
          rationale: string;
        }> | null;
        completenessScore: number | null;
        concisenessScore: number | null;
        keyfactAlignment: Array<{
          fact: string;
          covered: boolean;
          lineNumbers: number[];
        }> | null;
        rouge1: number | null;
        rouge2: number | null;
        rougeL: number | null;
        bertScore: number | null;
        parentSummaryId: number | null;
        profile: {
          expertise: string;
          focus: string;
          depth: string;
          context: string;
          domain?: string | null;
          currentProject?: string | null;
        } | null;
        generatedAt: string;
      }>;
    }>>('/user/articles'),

  summarize: (articleId: number) =>
    apiRequest<SummaryResult>('/user/summarize', {
      method: 'POST',
      body: JSON.stringify({ articleId }),
    }),

  deleteSummary: (summaryId: number) =>
    apiRequest<{ success: boolean }>(`/user/summaries/${summaryId}`, {
      method: 'DELETE',
    }),

  rateSummary: (
    summaryId: number,
    data: {
      utilidade: number;
      clareza: number;
      adequacao_perfil: number;
      factualidade_percebida: number;
      comment?: string;
    },
  ) =>
    apiRequest<{
      id: number;
      createdAt: string;
      utilidade: number;
      clareza: number;
      adequacao_perfil: number;
      factualidade_percebida: number;
      comment?: string;
    }>(`/user/summaries/${summaryId}/rate`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getRating: (summaryId: number) =>
    apiRequest<{
      rating: {
        id: number;
        utilidade: number;
        clareza: number;
        adequacao_perfil: number;
        factualidade_percebida: number;
        comment: string | null;
        createdAt: string;
      } | null;
    }>(`/user/summaries/${summaryId}/rating`),
};

export const experimentApi = {
  uploadCv: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const headers: Record<string, string> = {};
    const code = sessionStorage.getItem('accessCode');
    if (code) {
      headers['x-access-code'] = code;
    }
    const response = await fetch(`${API_BASE}/experiment/cv-profile`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'CV processing failed' }));
      throw new Error(error.error || 'CV processing failed');
    }
    return response.json();
  },

  registerParticipant: (data: {
    name: string;
    experienceLevel: string;
    yearsExperience: number;
    readingFrequency: string;
    topicFamiliarity: string;
    structurePreference?: string;
    readingGoal?: string;
    preferredLength?: string;
    profileSource?: string;
  }) =>
    apiRequest<{ id: number; name: string; experienceLevel: string }>('/experiment/participants', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  registerFromCv: (data: {
    name: string;
    experienceLevel: string;
    dimensions: Record<string, string>;
    structurePreference: string;
    domain?: string;
    currentProject?: string;
  }) =>
    apiRequest<{ id: number; name: string; experienceLevel: string }>('/experiment/participants/from-cv', {
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

  evaluateSession: (sessionId: number, data: {
    preference: 'A' | 'B';
    rating: number;
    comment?: string;
  }) =>
    apiRequest<{ success: boolean }>(`/experiment/sessions/${sessionId}/evaluate`, {
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

  getProfile: () =>
    apiRequest<{
      dimensions: Record<string, string | null>;
      sources: Record<string, string>;
      profileSource: string;
    }>('/experiment/profile'),

  updateProfile: (overrides: Record<string, string>) =>
    apiRequest<{
      dimensions: Record<string, string | null>;
      sources: Record<string, string>;
      profileSource: string;
    }>('/experiment/profile', {
      method: 'PUT',
      body: JSON.stringify({ overrides }),
    }),

  resetProfile: () =>
    apiRequest<{
      dimensions: Record<string, string | null>;
      sources: Record<string, string>;
      profileSource: string;
    }>('/experiment/profile/reset', {
      method: 'POST',
    }),

  refreshProfileFromCv: async (file: File): Promise<{
    dimensions: Record<string, string | null>;
    sources: Record<string, string>;
    profileSource: string;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    const headers: Record<string, string> = {};
    const code = sessionStorage.getItem('accessCode');
    if (code) {
      headers['x-access-code'] = code;
    }
    const response = await fetch(`${API_BASE}/experiment/profile/refresh-from-cv`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Falha ao atualizar perfil via CV' }));
      throw new Error(error.error || 'Falha ao atualizar perfil via CV');
    }
    return response.json();
  },
};
