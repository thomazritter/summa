import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { queryOne, queryAll } from '../db/connection.js';
import { processPDF, PDFProcessingError } from '../services/pdfProcessor.js';
import { parseId, safeJsonParse, MAX_PDF_SIZE } from '../utils/validation.js';
import type { ArticleStructure } from '@summarizer/shared';

export const articleRoutes = Router();

// Custom error for file type validation
class FileTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileTypeError';
  }
}

// Configure multer for PDF uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PDF_SIZE,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new FileTypeError('Only PDF files are allowed'));
    }
  },
});

// Multer error handling middleware
const handleMulterError = (err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `File too large. Maximum size is ${MAX_PDF_SIZE / 1024 / 1024}MB` });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err instanceof FileTypeError) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
};

// Upload and process PDF
articleRoutes.post('/upload', upload.single('file'), handleMulterError, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file provided' });
    }

    const { rawText, structuredContent, metadata } = await processPDF(req.file.buffer);

    const inserted = await queryOne<ArticleRow>(
      `INSERT INTO articles (title, authors, raw_text, structured_content)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        metadata.title || 'Untitled Article',
        metadata.authors || null,
        rawText,
        JSON.stringify(structuredContent),
      ]
    );

    if (inserted) {
      res.status(201).json(mapRowToArticle(inserted));
    } else {
      res.status(500).json({ error: 'Failed to create article' });
    }
  } catch (error) {
    if (error instanceof PDFProcessingError) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// Download article raw text as file
articleRoutes.get('/:id/download', async (req: Request, res: Response) => {
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
});

// Get article by ID
articleRoutes.get('/:id', async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid article ID' });
  }

  const article = await queryOne<ArticleRow>('SELECT * FROM articles WHERE id = $1', [id]);

  if (!article) {
    return res.status(404).json({ error: 'Article not found' });
  }

  res.json(mapRowToArticle(article));
});

// Get all articles (list view - without full content)
articleRoutes.get('/', async (req: Request, res: Response) => {
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
});

// Internal types
interface ArticleRow {
  id: number;
  title: string;
  authors: string | null;
  year: number | null;
  doi: string | null;
  url: string | null;
  raw_text: string;
  structured_content: string;
  created_at: string;
}

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
