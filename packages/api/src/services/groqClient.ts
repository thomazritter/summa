const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const DEFAULT_TIMEOUT = 120000; // 2 minutes for LLM generation

export interface GenerateRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
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
        model: GROQ_MODEL,
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
    model: GROQ_MODEL,
    provider: 'groq',
  };
};
