import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  validateCode,
  validateMagicLink,
  createAccessCode,
  createMagicLink,
  countRecentMagicLinks,
} from '../services/authService.js';
import { sendAccessCode, sendMagicLinkEmail } from '../services/emailService.js';
import { requireManager } from '../middleware/auth.js';
import { queryAll, execute } from '../db/connection.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const authRoutes = Router();

// Login — validate code (supports both admin-created codes and magic links)
authRoutes.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const schema = z.object({ code: z.string().min(1) });
  const validation = schema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: 'Codigo invalido' });

  // Use validateMagicLink which also handles expiration checks
  const access = await validateMagicLink(validation.data.code);
  if (!access) return res.status(401).json({ error: 'Codigo nao encontrado ou expirado' });

  // Mark as used if first time (for admin-created codes without expires_at)
  if (!access.used_at) {
    await execute('UPDATE access_codes SET used_at = CURRENT_TIMESTAMP WHERE id = $1', [access.id]);
  }

  res.json({
    code: access.code,
    email: access.email,
    role: access.role,
    participantId: access.participant_id,
  });
}));

// Self-service magic link — send login link to email
authRoutes.post('/magic-link', asyncHandler(async (req: Request, res: Response) => {
  const schema = z.object({ email: z.string().email() });
  const validation = schema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: 'Email invalido' });

  const { email } = validation.data;

  // Rate limit: 3 magic link requests per email per 15 minutes
  const WINDOW_MS = 15 * 60 * 1000;
  const MAX_REQUESTS = 3;
  const recentCount = await countRecentMagicLinks(email, WINDOW_MS);
  if (recentCount >= MAX_REQUESTS) {
    // Still return 200 to prevent email enumeration
    return res.json({ message: 'Se este email existir, enviaremos um link de acesso.' });
  }

  try {
    const { code } = await createMagicLink(email);
    await sendMagicLinkEmail(email, code);
  } catch {
    // Swallow errors to prevent email enumeration via timing attacks
    // In dev, createMagicLink/sendMagicLinkEmail will log to console
  }

  // Always return the same response regardless of outcome
  res.json({ message: 'Se este email existir, enviaremos um link de acesso.' });
}));

// Manager: create and send participant code
authRoutes.post('/invite', requireManager, asyncHandler(async (req: Request, res: Response) => {
  const schema = z.object({ email: z.string().email() });
  const validation = schema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: 'Email invalido' });

  const code = await createAccessCode(validation.data.email, 'participant');
  await sendAccessCode(validation.data.email, code);
  res.json({ code, email: validation.data.email });
}));

// Manager: list all codes
authRoutes.get('/codes', requireManager, asyncHandler(async (_req: Request, res: Response) => {
  const codes = await queryAll('SELECT * FROM access_codes ORDER BY created_at DESC');
  res.json(codes);
}));
