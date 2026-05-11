import { Router, Request, Response } from 'express';
import { queryOne, queryAll } from '../db/connection.js';
import { extractRawText, structureRawText, PDFProcessingError } from '../services/pdfProcessor.js';
import { validatePreStructuring, validatePostStructuring } from '../services/articleValidator.js';
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

  // Step 2: Pre-structuring validation (blocking) — runs BEFORE the LLM call
  // so invalid documents are rejected without wasting an API call.
  const preValidation = validatePreStructuring(rawText);
  if (!preValidation.valid) {
    return res.status(422).json({
      error: 'Article validation failed',
      validation: { errors: preValidation.errors },
    });
  }

  // Step 3: LLM structuring (only after validation passes).
  const structuredContent = await structureRawText(rawText);

  // Resolve uploaded_by from access code if present
  const uploadedBy = req.accessCode?.participantId ?? null;

  const inserted = await queryOne<ArticleRow>(
    `INSERT INTO articles (title, authors, raw_text, structured_content, uploaded_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      metadata.title || 'Untitled Article',
      metadata.authors || null,
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

// Download article raw text as file
articleRoutes.get('/:id/download', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid article ID' });
  }

  const article = await queryOne<{ title: string; raw_text: string }>(
    'SELECT title, raw_text FROM articles WHERE id = $1',
    [id]
  );

  if (!article) {
    return res.status(404).json({ error: 'Article not found' });
  }

  const safeTitle = article.title.replace(/[^a-zA-Z0-9_\-. ]/g, '_');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.txt"`);
  res.send(article.raw_text);
}));

// Get article by ID
articleRoutes.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid article ID' });
  }

  const article = await queryOne<ArticleRow>('SELECT * FROM articles WHERE id = $1', [id]);

  if (!article) {
    return res.status(404).json({ error: 'Article not found' });
  }

  res.json(mapRowToArticle(article));
}));

// Get all articles (list view - without full content)
articleRoutes.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const articles = await queryAll<ArticleListRow>(
    'SELECT id, title, authors, year, doi, url, created_at FROM articles'
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
