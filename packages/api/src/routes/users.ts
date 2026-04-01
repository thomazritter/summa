import { Router, NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { parseId } from '../utils/validation.js';

export const userRoutes = Router();

// Validation schemas
const createUserSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
});

// Get all users
userRoutes.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const users = db.prepare('SELECT * FROM users').all();
  res.json(users);
});

// Get user by ID
userRoutes.get('/:id', (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json(user);
});

// Create user
userRoutes.post('/', (req: Request, res: Response, next: NextFunction) => {
  const validation = createUserSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  const { name, email } = validation.data;
  const db = getDb();

  try {
    const result = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').run(name, email);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(user);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    next(error);
  }
});
