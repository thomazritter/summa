import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { parseId } from '../utils/validation.js';
import * as summarizationService from '../services/summarizationService.js';
import { SummarizationError, NotFoundError } from '../services/summarizationService.js';

export const summaryRoutes = Router();

// Validation schema
const generateSummarySchema = z.object({
  articleId: z.number().int().positive(),
  profileId: z.number().int().positive(),
});

// Generate summary
summaryRoutes.post('/generate', async (req: Request, res: Response, next: NextFunction) => {
  const validation = generateSummarySchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  try {
    const summary = await summarizationService.generateSummary(
      validation.data.articleId,
      validation.data.profileId
    );
    res.status(201).json(summary);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof SummarizationError) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// Get summary by ID
summaryRoutes.get('/:id', (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid summary ID' });
  }

  const summary = summarizationService.getSummaryById(id);
  if (!summary) {
    return res.status(404).json({ error: 'Summary not found' });
  }

  res.json(summary);
});

// Get summaries by article
summaryRoutes.get('/article/:articleId', (req: Request, res: Response) => {
  const articleId = parseId(req.params.articleId);
  if (articleId === null) {
    return res.status(400).json({ error: 'Invalid article ID' });
  }

  const summaries = summarizationService.getSummariesByArticle(articleId);
  res.json(summaries);
});

// Regenerate summary
summaryRoutes.post('/:id/regenerate', async (req: Request, res: Response, next: NextFunction) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid summary ID' });
  }

  try {
    const summary = await summarizationService.regenerateSummary(id);
    res.json(summary);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof SummarizationError) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});
