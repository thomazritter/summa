const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DEFAULT_TIMEOUT = 120000; // 2 minutes for LLM generation

// 429 retry policy: when Groq rejects with rate limit, parse the "Please try
// again in Xs/Xms" hint (or the Retry-After header), wait that long plus a
// small jitter, and retry up to N times. This matters for FineSurE batches
// where 3 calls per summary × dozens of summaries can hit the per-minute cap.
const MAX_429_RETRIES = 4;
const MAX_BACKOFF_MS = 60_000;

// ─── Model management ────────────────────────────────────────────────

export const AVAILABLE_MODELS = [
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', description: 'Modelo padrão (default)' },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B', description: 'Última geração Meta' },
  { id: 'qwen/qwen3-32b', name: 'Qwen 3 32B', description: 'Forte em raciocínio (Alibaba)' },
  { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', description: 'Maior modelo disponível (OpenAI)' },
  { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', description: 'OpenAI OSS médio porte' },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', description: 'Mais rápido e leve' },
];

let activeModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

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
  /** When the Groq response signals a retry hint (429 + body/header), this carries it. */
  retryAfterMs?: number;

  constructor(message: string, public statusCode?: number, retryAfterMs?: number) {
    super(message);
    this.name = 'LLMError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Parse "Please try again in 1.234s" or "...in 567ms" from a Groq 429 body. */
const extractRetryDelayFromBody = (body: string): number | null => {
  const secondsMatch = body.match(/try again in ([0-9]*\.?[0-9]+)\s*s\b/i);
  if (secondsMatch) {
    return Math.ceil(parseFloat(secondsMatch[1]) * 1000);
  }
  const msMatch = body.match(/try again in ([0-9]+)\s*ms\b/i);
  if (msMatch) {
    return parseInt(msMatch[1], 10);
  }
  return null;
};

/** Exponential backoff fallback when Groq sends a 429 without an explicit hint. */
const exponentialBackoffMs = (attempt: number): number =>
  Math.min(MAX_BACKOFF_MS, Math.pow(2, attempt) * 1000);

/** Single attempt to call Groq. Throws LLMError on any failure. */
const callGroqOnce = async (request: GenerateRequest): Promise<string> => {
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
      const rawBody = await response.text();
      let parsedMessage = response.statusText;
      try {
        const parsed = JSON.parse(rawBody) as { error?: { message?: string } };
        if (parsed.error?.message) {
          parsedMessage = parsed.error.message;
        }
      } catch {
        // body wasn't JSON; keep statusText as the message
      }

      let retryAfterMs: number | undefined;
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('retry-after');
        const fromHeader = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : null;
        const fromBody = extractRetryDelayFromBody(`${parsedMessage}\n${rawBody}`);
        const hint = fromHeader ?? fromBody;
        if (hint !== null && !Number.isNaN(hint) && hint > 0) {
          retryAfterMs = hint;
        }
      }

      throw new LLMError(
        `Groq API error: ${parsedMessage}`,
        response.status,
        retryAfterMs,
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

export const generateCompletion = async (request: GenerateRequest): Promise<string> => {
  if (!GROQ_API_KEY) {
    throw new LLMError('GROQ_API_KEY not configured');
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    try {
      return await callGroqOnce(request);
    } catch (error) {
      lastError = error;
      if (
        error instanceof LLMError &&
        error.statusCode === 429 &&
        attempt < MAX_429_RETRIES
      ) {
        const baseDelay = error.retryAfterMs ?? exponentialBackoffMs(attempt);
        const jitter = Math.floor(Math.random() * 250);
        const delay = Math.min(MAX_BACKOFF_MS, baseDelay + jitter);
        console.warn(
          `[groq] 429 rate-limited; retry ${attempt + 1}/${MAX_429_RETRIES} after ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
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
