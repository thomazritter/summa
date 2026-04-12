import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { queryOne, queryAll } from '../db/connection.js';
import { parseId } from '../utils/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const userRoutes = Router();

// Validation schemas
const createUserSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
});

// Get all users
userRoutes.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const users = await queryAll('SELECT * FROM users');
  res.json(users);
}));

// Get user by ID
userRoutes.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  const user = await queryOne('SELECT * FROM users WHERE id = $1', [id]);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json(user);
}));

// Create user
userRoutes.post('/', asyncHandler(async (req: Request, res: Response) => {
  const validation = createUserSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  const { name, email } = validation.data;

  try {
    const user = await queryOne(
      'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
      [name, email]
    );
    res.status(201).json(user);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as Record<string, unknown>).code === '23505') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    throw error;
  }
}));
