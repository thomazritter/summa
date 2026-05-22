import pdf from 'pdf-parse';
import type { ArticleStructure } from '@summarizer/shared';
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
 * Use the LLM to identify and extract the abstract, title and authors from raw
 * text. The abstract is the only section the downstream pipeline (FineSurE
 * keyfact extraction) consumes; title and authors fill the article record so
 * the UI can show them without depending on the brittle PDF metadata or
 * heuristic regex.
 *
 * Input is passed in full — truncating biases the abstract identification
 * (especially for editorial formats that place the abstract between authors
 * and DOI without an explicit "Abstract:" header). Llama 3.3 70B on Groq has
 * a 128K-token context window, comfortably above any realistic scientific
 * paper. Returns null on failure so the caller can fall back to regex.
 */
const structureWithLLM = async (rawText: string): Promise<ArticleStructure | null> => {
  try {
    const prompt = `Analise este texto de artigo científico e identifique o título, os autores e o resumo/abstract.
Retorne APENAS um JSON válido (sem markdown, sem \`\`\`, sem texto antes ou depois):
{
  "title": "título completo do artigo, copiado integralmente do texto, ou null",
  "authors": "lista de autores separados por vírgula, na ordem em que aparecem, ou null",
  "abstract": "texto completo do abstract ou null"
}

IMPORTANTE: COPIE o texto original do abstract integralmente. NÃO resuma nem altere o conteúdo.
Para o título, use o texto exato como aparece no artigo (sem reformatar).
Para os autores, capture os nomes que aparecem na linha de autoria, normalmente logo abaixo do título.
Use null (sem aspas) para qualquer campo que não seja encontrado no texto.

ABSTRACT SEM RÓTULO EXPLÍCITO: alguns artigos (notadamente os do formato
Nature Communications) não trazem o cabeçalho "Abstract:" antes do resumo
do artigo. Nesse caso, identifique o abstract como o parágrafo único de
prosa contínua localizado entre os autores/afiliações e o primeiro de:
(a) cabeçalho de seção numerada como "1. Introduction" ou "Introduction",
(b) link de DOI ("https://doi.org/..."), ou (c) bloco "Keywords:". Esse
parágrafo costuma resumir motivação, método e resultado em uma única
sequência de 100-300 palavras. Capture-o integralmente como abstract.

TEXTO DO ARTIGO:
${rawText}`;

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

    const abstractValue = parsed.abstract;
    if (typeof abstractValue !== 'string' || abstractValue.trim().length === 0) {
      console.warn('[PDF] LLM structuring returned no abstract');
      return null;
    }

    const titleValue = typeof parsed.title === 'string' && parsed.title.trim().length > 0
      ? parsed.title.trim()
      : undefined;
    const authorsValue = typeof parsed.authors === 'string' && parsed.authors.trim().length > 0
      ? parsed.authors.trim()
      : undefined;

    return { title: titleValue, authors: authorsValue, abstract: abstractValue, sections: [] };
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

/**
 * Regex fallback for abstract detection when the LLM call fails. Walks the
 * text line-by-line and captures everything between an "Abstract"/"Resumo"
 * header and the next section header (introduction, methodology, etc.).
 */
const structureArticleContent = (text: string): ArticleStructure => {
  const structure: ArticleStructure = { sections: [] };

  const abstractHeader = /^(?:\d+[\.\s]+)?(abstract|resumo)[:\s—]*/i;
  const stopHeader = /^(?:\d+[\.\s]+)?(introduction|introdu[çc][ãa]o|methodology|methods|materials and methods|metodologia|m[ée]todos|experimental\s+(?:setup|design)|results|resultados|discussion|discuss[ãa]o|conclusion|conclus[ãa]o|keywords|palavras-chave)[:\s]*/i;

  const lines = text.split('\n');
  let capturing = false;
  const buffer: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    if (capturing && stopHeader.test(trimmedLine)) {
      break;
    }
    if (abstractHeader.test(trimmedLine)) {
      capturing = true;
      continue;
    }
    if (capturing) {
      buffer.push(trimmedLine);
    }
  }

  const abstract = buffer.join('\n').trim();
  if (abstract.length > 0) {
    structure.abstract = abstract;
  }

  return structure;
};
