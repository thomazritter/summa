import pdf from 'pdf-parse';
import type { ArticleStructure, ArticleSection } from '@summarizer/shared';
import { MAX_PDF_SIZE } from '../utils/validation.js';
import { generateCompletion } from './groqClient.js';

export class PDFProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PDFProcessingError';
  }
}

export interface PDFExtractionResult {
  rawText: string;
  metadata: { title?: string; authors?: string };
}

export interface PDFProcessingResult extends PDFExtractionResult {
  structuredContent: ArticleStructure;
}

/**
 * Extract raw text + metadata from a PDF buffer (cheap, no LLM call).
 * Run this first so the caller can validate the document before paying
 * for the LLM structuring step.
 */
export const extractRawText = async (buffer: Buffer): Promise<PDFExtractionResult> => {
  if (buffer.length > MAX_PDF_SIZE) {
    throw new PDFProcessingError(`PDF exceeds maximum size of ${MAX_PDF_SIZE / 1024 / 1024}MB`);
  }

  let data;
  try {
    data = await pdf(buffer, { max: 100 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new PDFProcessingError(`Failed to parse PDF: ${message}`);
  }

  // Some PDFs include NUL bytes (0x00) in the extracted text. PostgreSQL TEXT
  // columns reject them with "invalid byte sequence for encoding UTF8: 0x00",
  // so strip them up front.
  const sanitize = (s: string) => s.replace(/\x00/g, '');
  const rawText = sanitize(data.text);
  const titleSrc: string = data.info?.Title || extractTitleFromText(rawText) || '';
  const title = sanitize(titleSrc);
  const authors = data.info?.Author ? sanitize(data.info.Author) : undefined;

  return {
    rawText,
    metadata: { title, authors },
  };
};

/**
 * Structure the raw text into article sections via LLM, with regex fallback.
 * Run only after pre-structuring validation passes.
 */
export const structureRawText = async (rawText: string): Promise<ArticleStructure> => {
  const llmStructure = await structureWithLLM(rawText);
  if (llmStructure) {
    console.log('[PDF] Structured via LLM');
    return llmStructure;
  }
  console.log('[PDF] Structured via regex fallback');
  return structureArticleContent(rawText);
};

/**
 * Process a PDF buffer end-to-end (extraction + structuring).
 * Kept for callers that don't need the intermediate validation step.
 */
export const processPDF = async (buffer: Buffer): Promise<PDFProcessingResult> => {
  const extracted = await extractRawText(buffer);
  const structuredContent = await structureRawText(extracted.rawText);
  return { ...extracted, structuredContent };
};

/**
 * Use the LLM to identify and extract article sections from raw text.
 * More accurate than regex for non-standard headers and multilingual articles.
 * Returns null on failure so the caller can fall back to regex.
 */
const MAX_STRUCTURING_CHARS = 30000;

const truncateAtWordBoundary = (text: string, limit: number): string => {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  // Back off to the last whitespace so we don't leave a half-word at the end,
  // which can produce a malformed string inside the requested JSON payload.
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > limit - 200 ? cut.slice(0, lastSpace) : cut;
};

const structureWithLLM = async (rawText: string): Promise<ArticleStructure | null> => {
  try {
    const truncatedText = truncateAtWordBoundary(rawText, MAX_STRUCTURING_CHARS);
    const prompt = `Analise este texto de artigo científico e identifique as seções.
Retorne APENAS um JSON válido (sem markdown, sem \`\`\`, sem texto antes ou depois):
{
  "abstract": "texto completo da seção ou null",
  "introduction": "texto completo da seção ou null",
  "methodology": "texto completo da seção ou null",
  "results": "texto completo da seção ou null",
  "discussion": "texto completo da seção ou null",
  "conclusion": "texto completo da seção ou null"
}

IMPORTANTE: COPIE o texto original de cada seção integralmente. NÃO resuma nem altere o conteúdo.
Use null (sem aspas) para seções não encontradas no texto.

TEXTO DO ARTIGO:
${truncatedText}`;

    const response = await generateCompletion({
      prompt,
      temperature: 0.1,
      maxTokens: 8192,
    });

    // Strip markdown code fences if present
    let cleaned = response.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    // Find the JSON object boundaries
    const startIdx = cleaned.indexOf('{');
    const endIdx = cleaned.lastIndexOf('}');
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      console.warn('[PDF] LLM structuring failed: no valid JSON object found in response');
      return null;
    }

    const jsonStr = cleaned.slice(startIdx, endIdx + 1);
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    // Validate: each known field should be a string or null
    const validKeys = ['abstract', 'introduction', 'methodology', 'results', 'discussion', 'conclusion'] as const;
    const structure: ArticleStructure = { sections: [] };

    for (const key of validKeys) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        structure[key] = value;
      }
      // null or missing values are left as undefined
    }

    // Check that at least one section was extracted
    const hasContent = validKeys.some((key) => structure[key] !== undefined);
    if (!hasContent) {
      console.warn('[PDF] LLM structuring returned no sections');
      return null;
    }

    return structure;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn('[PDF] LLM structuring failed, will use regex fallback:', message);
    return null;
  }
};

const extractTitleFromText = (text: string): string | undefined => {
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  if (lines.length > 0 && lines[0].length < 200) {
    return lines[0].trim();
  }
  return undefined;
};

const structureArticleContent = (text: string): ArticleStructure => {
  const sections: ArticleSection[] = [];
  const structure: ArticleStructure = { sections };

  const sectionPatterns = [
    { pattern: /^(?:\d+[\.\s]+)?(abstract|resumo)[:\s—]*/i, key: 'abstract' as const },
    { pattern: /^(?:\d+[\.\s]+)?(introduction|introdu[çc][ãa]o)[:\s]*/i, key: 'introduction' as const },
    { pattern: /^(?:\d+[\.\s]+)?(methodology|methods|materials and methods|metodologia|m[ée]todos|experimental\s+(?:setup|design))[:\s]*/i, key: 'methodology' as const },
    { pattern: /^(?:\d+[\.\s]+)?(results|resultados|results and discussion)[:\s]*/i, key: 'results' as const },
    { pattern: /^(?:\d+[\.\s]+)?(discussion|discuss[ãa]o)[:\s]*/i, key: 'discussion' as const },
    { pattern: /^(?:\d+[\.\s]+)?(conclusion|conclusions|conclus[ãa]o|conclus[õo]es)[:\s]*/i, key: 'conclusion' as const },
  ];

  const lines = text.split('\n');
  let currentSection: ArticleSection | null = null;
  let currentContent: string[] = [];
  let currentKey: keyof ArticleStructure | null = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    let isHeader = false;
    for (const { pattern, key } of sectionPatterns) {
      if (pattern.test(trimmedLine)) {
        if (currentSection && currentKey) {
          currentSection.content = currentContent.join('\n').trim();
          sections.push(currentSection);
          structure[currentKey] = currentSection.content;
        }
        currentSection = { title: trimmedLine, content: '', level: 1 };
        currentContent = [];
        currentKey = key;
        isHeader = true;
        break;
      }
    }

    if (!isHeader && currentSection) {
      currentContent.push(trimmedLine);
    }
  }

  if (currentSection && currentKey) {
    currentSection.content = currentContent.join('\n').trim();
    sections.push(currentSection);
    structure[currentKey] = currentSection.content;
  }

  return structure;
};
