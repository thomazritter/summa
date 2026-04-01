import pdf from 'pdf-parse';
import type { ArticleStructure, ArticleSection } from '@summarizer/shared';
import { MAX_PDF_SIZE } from '../utils/validation.js';

const PDF_SERVICE_URL = process.env.PDF_SERVICE_URL || 'http://127.0.0.1:5051';

export class PDFProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PDFProcessingError';
  }
}

export interface PDFProcessingResult {
  rawText: string;
  structuredContent: ArticleStructure;
  metadata: { title?: string; authors?: string };
}

/**
 * Process a PDF buffer and extract structured text.
 * Tries PyMuPDF service first (better column handling), falls back to pdf-parse.
 */
export const processPDF = async (buffer: Buffer): Promise<PDFProcessingResult> => {
  if (buffer.length > MAX_PDF_SIZE) {
    throw new PDFProcessingError(`PDF exceeds maximum size of ${MAX_PDF_SIZE / 1024 / 1024}MB`);
  }

  // Try PyMuPDF service first
  try {
    const result = await extractViaPyMuPDF(buffer);
    console.log('[PDF] Extracted via PyMuPDF service');
    return result;
  } catch (error) {
    console.warn('[PDF] PyMuPDF service unavailable, falling back to pdf-parse:', (error as Error).message);
  }

  // Fallback to pdf-parse (JavaScript)
  return extractViaPdfParse(buffer);
};

/**
 * Extract via PyMuPDF Python service (port 5051).
 * Better handling of multi-column layouts.
 */
const extractViaPyMuPDF = async (buffer: Buffer): Promise<PDFProcessingResult> => {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: 'application/pdf' });
  formData.append('file', blob, 'article.pdf');

  const response = await fetch(`${PDF_SERVICE_URL}/extract`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `PDF service returned ${response.status}`);
  }

  const data = await response.json() as {
    rawText: string;
    structuredContent: {
      abstract?: string;
      introduction?: string;
      methodology?: string;
      results?: string;
      discussion?: string;
      conclusion?: string;
      sections?: Array<{ title: string; content: string; level: number }>;
    };
    metadata: { title?: string; authors?: string; pageCount?: number };
  };

  return {
    rawText: data.rawText,
    structuredContent: {
      abstract: data.structuredContent.abstract || undefined,
      introduction: data.structuredContent.introduction || undefined,
      methodology: data.structuredContent.methodology || undefined,
      results: data.structuredContent.results || undefined,
      discussion: data.structuredContent.discussion || undefined,
      conclusion: data.structuredContent.conclusion || undefined,
      sections: data.structuredContent.sections || [],
    },
    metadata: {
      title: data.metadata.title || undefined,
      authors: data.metadata.authors || undefined,
    },
  };
};

/**
 * Fallback extraction using pdf-parse (JavaScript).
 * Less accurate for multi-column PDFs.
 */
const extractViaPdfParse = async (buffer: Buffer): Promise<PDFProcessingResult> => {
  let data;
  try {
    data = await pdf(buffer, { max: 100 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new PDFProcessingError(`Failed to parse PDF: ${message}`);
  }

  const rawText = data.text;
  const metadata = {
    title: data.info?.Title || extractTitleFromText(rawText),
    authors: data.info?.Author || undefined,
  };
  const structuredContent = structureArticleContent(rawText);

  console.log('[PDF] Extracted via pdf-parse (fallback)');
  return { rawText, structuredContent, metadata };
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
