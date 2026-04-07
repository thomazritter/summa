import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validateCode, createAccessCode } from '../services/authService.js';
import { sendAccessCode } from '../services/emailService.js';
import { requireManager } from '../middleware/auth.js';
import { queryAll, execute } from '../db/connection.js';

export const authRoutes = Router();

// Login — validate code
authRoutes.post('/login', async (req: Request, res: Response) => {
  const schema = z.object({ code: z.string().min(1) });
  const validation = schema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: 'Codigo invalido' });

  const access = await validateCode(validation.data.code);
  if (!access) return res.status(401).json({ error: 'Codigo nao encontrado' });

  const row = access as Record<string, unknown>;

  // Mark as used if first time
  if (!row.used_at) {
    await execute('UPDATE access_codes SET used_at = CURRENT_TIMESTAMP WHERE id = $1', [row.id]);
  }

  res.json({
    code: row.code,
    email: row.email,
    role: row.role,
    participantId: row.participant_id,
  });
});

// Manager: create and send participant code
authRoutes.post('/invite', requireManager, async (req: Request, res: Response, next: NextFunction) => {
  const schema = z.object({ email: z.string().email() });
  const validation = schema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: 'Email invalido' });

  try {
    const code = await createAccessCode(validation.data.email, 'participant');
    await sendAccessCode(validation.data.email, code);
    res.json({ code, email: validation.data.email });
  } catch (error) {
    next(error);
  }
});

// Manager: list all codes
authRoutes.get('/codes', requireManager, async (req: Request, res: Response) => {
  const codes = await queryAll('SELECT * FROM access_codes ORDER BY created_at DESC');
  res.json(codes);
});
