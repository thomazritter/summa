import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateCode, createAccessCode } from '../services/authService.js';
import { sendAccessCode } from '../services/emailService.js';
import { requireManager } from '../middleware/auth.js';
import { queryAll, execute } from '../db/connection.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const authRoutes = Router();

// Login — validate code
authRoutes.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const schema = z.object({ code: z.string().min(1) });
  const validation = schema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: 'Codigo invalido' });

  const access = await validateCode(validation.data.code);
  if (!access) return res.status(401).json({ error: 'Codigo nao encontrado' });

  // Mark as used if first time
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
