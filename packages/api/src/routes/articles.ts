import { Router, Request, Response } from 'express';
import { queryOne, queryAll } from '../db/connection.js';
import { extractRawText, structureRawText, PDFProcessingError } from '../services/pdfProcessor.js';
import { validatePreStructuring, validateArticleScope, validatePostStructuring } from '../services/articleValidator.js';
import { parseId, safeJsonParse, MAX_PDF_SIZE } from '../utils/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createPdfUpload, createMulterErrorHandler } from '../utils/multerHelpers.js';
import type { ArticleRow } from '../types/rows.js';
import type { ArticleStructure } from '@summarizer/shared';

export const articleRoutes = Router();

// Configure multer for PDF uploads
const upload = createPdfUpload(MAX_PDF_SIZE);
const handleMulterError = createMulterErrorHandler(MAX_PDF_SIZE);

// Upload and process PDF
articleRoutes.post('/upload', upload.single('file'), handleMulterError, asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No PDF file provided' });
  }

  // Step 1: Cheap extraction via pdf-parse (no LLM call yet).
  const { rawText, metadata } = await extractRawText(req.file.buffer);

  // Step 2a: Pre-structuring validation (cheap, blocking) — text length only.
  const preValidation = validatePreStructuring(rawText);
  if (!preValidation.valid) {
    return res.status(422).json({
      error: 'Falha na validação do artigo',
      validation: { errors: preValidation.errors },
    });
  }

  // Step 2b: Scope validation (LLM, blocking) — rejects non-scientific
  // documents and articles not in English. Runs after the length check
  // and before the structuring call.
  const scopeValidation = await validateArticleScope(rawText);
  if (!scopeValidation.valid) {
    return res.status(422).json({
      error: 'Falha na validação do artigo',
      validation: { errors: scopeValidation.errors },
    });
  }

  // Step 3: LLM structuring (only after both validations pass).
  const structuredContent = await structureRawText(rawText);

  // Resolve uploaded_by from access code if present
  const uploadedBy = req.accessCode?.participantId ?? null;

  // Prefer the LLM-extracted title/authors (from structureRawText) over the
  // PDF metadata heuristics, since scientific PDFs frequently carry empty or
  // generator-default Title/Author fields.
  const resolvedTitle = structuredContent.title || metadata.title || 'Untitled Article';
  const resolvedAuthors = structuredContent.authors || metadata.authors || null;

  const inserted = await queryOne<ArticleRow>(
    `INSERT INTO articles (title, authors, raw_text, structured_content, uploaded_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      resolvedTitle,
      resolvedAuthors,
      rawText,
      JSON.stringify(structuredContent),
      uploadedBy,
    ]
  );

  if (!inserted) {
    return res.status(500).json({ error: 'Failed to create article' });
  }

  // Phase 2: Post-structuring validation (non-blocking warnings)
  const postValidation = validatePostStructuring(rawText, structuredContent);

  const sectionKeys = ['abstract', 'introduction', 'methodology', 'results', 'discussion', 'conclusion'] as const;
  const sectionsFound = sectionKeys.filter(
    s => structuredContent[s] && structuredContent[s]!.length > 50
  );

  res.status(201).json({
    article: mapRowToArticle(inserted),
    validation: {
      warnings: postValidation.warnings,
      sectionsFound,
    },
  });
}));

// Download article raw text as file. Ownership-scoped.
articleRoutes.get('/:id/download', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid article ID' });
  }

  const participantId = req.accessCode?.participantId;
  if (!participantId) {
    return res.status(404).json({ error: 'Article not found' });
  }

  const article = await queryOne<{ title: string; raw_text: string }>(
    'SELECT title, raw_text FROM articles WHERE id = $1 AND uploaded_by = $2',
    [id, participantId]
  );

  if (!article) {
    return res.status(404).json({ error: 'Article not found' });
  }

  const safeTitle = article.title.replace(/[^a-zA-Z0-9_\-. ]/g, '_');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.txt"`);
  res.send(article.raw_text);
}));

// Get article by ID. Ownership-scoped.
articleRoutes.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid article ID' });
  }

  const participantId = req.accessCode?.participantId;
  if (!participantId) {
    return res.status(404).json({ error: 'Article not found' });
  }

  const article = await queryOne<ArticleRow>(
    'SELECT * FROM articles WHERE id = $1 AND uploaded_by = $2',
    [id, participantId]
  );

  if (!article) {
    return res.status(404).json({ error: 'Article not found' });
  }

  res.json(mapRowToArticle(article));
}));

// List articles owned by the requesting participant.
articleRoutes.get('/', asyncHandler(async (req: Request, res: Response) => {
  const participantId = req.accessCode?.participantId;
  if (!participantId) {
    return res.json([]);
  }
  const articles = await queryAll<ArticleListRow>(
    'SELECT id, title, authors, year, doi, url, created_at FROM articles WHERE uploaded_by = $1',
    [participantId]
  );
  res.json(articles.map(row => ({
    id: row.id,
    title: row.title,
    authors: row.authors,
    year: row.year,
    doi: row.doi,
    url: row.url,
    createdAt: row.created_at,
  })));
}));

// Internal types
interface ArticleListRow {
  id: number;
  title: string;
  authors: string | null;
  year: number | null;
  doi: string | null;
  url: string | null;
  created_at: string;
}

const mapRowToArticle = (row: ArticleRow) => ({
  id: row.id,
  title: row.title,
  authors: row.authors,
  year: row.year,
  doi: row.doi,
  url: row.url,
  rawText: row.raw_text,
  structuredContent: safeJsonParse<ArticleStructure>(row.structured_content) || { sections: [] },
  createdAt: row.created_at,
});
