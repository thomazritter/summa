import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as profileService from '../services/profileService.js';
import { parseId } from '../utils/validation.js';

export const profileRoutes = Router();

// Validation schemas
const createProfileSchema = z.object({
  name: z.string().min(1).max(100),
  expertise: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
  focus: z.enum(['concepts', 'methodology', 'results', 'applications', 'all']),
  depth: z.enum(['brief', 'moderate', 'detailed', 'comprehensive']),
  context: z.enum(['quick_review', 'learning', 'research', 'teaching']),
});

// Get questionnaire for new profile creation
profileRoutes.get('/questionnaire', (req: Request, res: Response) => {
  res.json(profileService.getProfileQuestions());
});

// Get all profiles for a user
profileRoutes.get('/user/:userId', (req: Request, res: Response) => {
  const userId = parseId(req.params.userId);
  if (userId === null) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  const profiles = profileService.getProfilesByUserId(userId);
  res.json(profiles);
});

// Get single profile
profileRoutes.get('/:id', (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid profile ID' });
  }

  const profile = profileService.getProfileById(id);
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  res.json(profile);
});

// Create profile
profileRoutes.post('/:userId', (req: Request, res: Response, next: NextFunction) => {
  const userId = parseId(req.params.userId);
  if (userId === null) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  const validation = createProfileSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  try {
    const profile = profileService.createProfile(userId, validation.data);
    res.status(201).json(profile);
  } catch (error) {
    next(error);
  }
});

// Update profile
profileRoutes.patch('/:id', (req: Request, res: Response, next: NextFunction) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid profile ID' });
  }

  const validation = createProfileSchema.partial().safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.errors });
  }

  try {
    const profile = profileService.updateProfile(id, validation.data);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

// Delete profile
profileRoutes.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid profile ID' });
  }

  try {
    const deleted = profileService.deleteProfile(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
