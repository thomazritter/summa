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
};

// Product-mode profile endpoints. Replace experimentApi for any profile
// interaction (registration via questionnaire or CV, view, edit).
export const profileApi = {
  registerParticipant: (data: {
    name: string;
    expertise: string;
    focus: string;
    depth: string;
    context: string;
    structurePreference?: string;
    domain?: string;
    currentProject?: string;
  }) =>
    apiRequest<{ id: number; name: string }>('/profile/participants', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  registerFromCv: (data: {
    name: string;
    dimensions: Record<string, string>;
    structurePreference: string;
    domain?: string;
    currentProject?: string;
  }) =>
    apiRequest<{ id: number; name: string }>('/profile/participants/from-cv', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getParticipant: (id: number) =>
    apiRequest<{ id: number; name: string }>(`/profile/participants/${id}`),

  uploadCv: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const headers: Record<string, string> = {};
    const code = sessionStorage.getItem('accessCode');
    if (code) {
      headers['x-access-code'] = code;
    }
    const response = await fetch(`${API_BASE}/profile/cv`, {
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

  getProfile: () =>
    apiRequest<{
      dimensions: Record<string, string | null>;
      sources: Record<string, string>;
      profileSource: string;
    }>('/profile'),

  updateProfile: (overrides: Record<string, string>) =>
    apiRequest<{
      dimensions: Record<string, string | null>;
      sources: Record<string, string>;
      profileSource: string;
    }>('/profile', {
      method: 'PUT',
      body: JSON.stringify({ overrides }),
    }),

  resetProfile: () =>
    apiRequest<{
      dimensions: Record<string, string | null>;
      sources: Record<string, string>;
      profileSource: string;
    }>('/profile/reset', {
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
    const response = await fetch(`${API_BASE}/profile/refresh-from-cv`, {
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

