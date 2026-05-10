const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DEFAULT_TIMEOUT = 120000; // 2 minutes for LLM generation

// ─── Model management ────────────────────────────────────────────────

export const AVAILABLE_MODELS = [
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', description: 'Melhor qualidade (default)' },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B', description: 'Última geração Meta' },
  { id: 'qwen/qwen3-32b', name: 'Qwen 3 32B', description: 'Forte em raciocínio (Alibaba)' },
  { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', description: 'Maior modelo disponível (OpenAI)' },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', description: 'Mais rápido e leve' },
];

let activeModel = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

export function getActiveModel(): string {
  return activeModel;
}

export function setActiveModel(model: string): void {
  activeModel = model;
}

export interface GenerateRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;  // per-request override, falls back to activeModel
}

export interface GenerateResponse {
  content: string;
  model: string;
  totalTokens?: number;
}

export class LLMError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'LLMError';
  }
}

export const generateCompletion = async (request: GenerateRequest): Promise<string> => {
  if (!GROQ_API_KEY) {
    throw new LLMError('GROQ_API_KEY not configured');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model || activeModel,
        messages: [{ role: 'user', content: request.prompt }],
        temperature: request.temperature ?? 0.3,
        max_tokens: request.maxTokens ?? 2000,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new LLMError(
        `Groq API error: ${(error as Record<string, Record<string, string>>).error?.message || response.statusText}`,
        response.status,
      );
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new LLMError('Groq request timed out');
    }
    if (error instanceof LLMError) {
      throw error;
    }
    throw new LLMError(
      `Failed to call Groq API: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  } finally {
    clearTimeout(timeoutId);
  }
};

export const checkGroqHealth = async (): Promise<boolean> => {
  if (!GROQ_API_KEY) return false;
  try {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

export const getGroqStatus = async (): Promise<{
  healthy: boolean;
  model: string;
  provider: string;
}> => {
  const healthy = await checkGroqHealth();
  return {
    healthy,
    model: activeModel,
    provider: 'groq',
  };
};
