import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { queryOne, queryAll } from '../db/connection.js';
import { parseId } from '../utils/validation.js';

export const feedbackRoutes = Router();

const feedbackSchema = z.object({
  summaryId: z.number().int().positive(),
  utilityRating: z.number().int().min(1).max(5),
  technicalLevelRating: z.number().int().min(1).max(5),
  depthRating: z.number().int().min(1).max(5),
  comments: z.string().max(2000).optional(),
});

feedbackRoutes.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const validation = feedbackSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.errors });

  const { summaryId, utilityRating, technicalLevelRating, depthRating, comments } = validation.data;
  const userId = 1; // MVP: hardcoded user

  try {
    const feedback = await queryOne(
      `INSERT INTO feedback (summary_id, user_id, utility_rating, technical_level_rating, depth_rating, comments)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [summaryId, userId, utilityRating, technicalLevelRating, depthRating, comments || null]
    );
    res.status(201).json(feedback);
  } catch (error) {
    next(error);
  }
});

feedbackRoutes.get('/summary/:summaryId', async (req: Request, res: Response) => {
  const summaryId = parseId(req.params.summaryId);
  if (summaryId === null) return res.status(400).json({ error: 'Invalid summary ID' });

  const feedback = await queryAll('SELECT * FROM feedback WHERE summary_id = $1', [summaryId]);
  res.json(feedback);
});
