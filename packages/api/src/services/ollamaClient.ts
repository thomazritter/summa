const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT = 120000; // 2 minutes for LLM generation

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    num_predict?: number;
  };
}

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

export class OllamaError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'OllamaError';
  }
}

export const generateCompletion = async (request: OllamaGenerateRequest): Promise<string> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...request,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new OllamaError(`Ollama error: ${error}`, response.status);
    }

    const data: OllamaGenerateResponse = await response.json();
    return data.response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new OllamaError('Ollama request timed out');
    }
    if (error instanceof OllamaError) {
      throw error;
    }
    throw new OllamaError(`Failed to connect to Ollama: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    clearTimeout(timeoutId);
  }
};

export const checkOllamaHealth = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

export const listModels = async (): Promise<OllamaModel[]> => {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.models || [];
  } catch {
    return [];
  }
};

export const getOllamaStatus = async (): Promise<{
  healthy: boolean;
  models: OllamaModel[];
  url: string;
}> => {
  const healthy = await checkOllamaHealth();
  const models = healthy ? await listModels() : [];
  return {
    healthy,
    models,
    url: OLLAMA_BASE_URL,
  };
};
