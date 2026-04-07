import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validateCode, createAccessCode } from '../services/authService.js';
import { sendAccessCode } from '../services/emailService.js';
import { requireManager } from '../middleware/auth.js';
import { getDb } from '../db/connection.js';

export const authRoutes = Router();

// Login — validate code
authRoutes.post('/login', (req: Request, res: Response) => {
  const schema = z.object({ code: z.string().min(1) });
  const validation = schema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: 'Codigo invalido' });

  const access = validateCode(validation.data.code);
  if (!access) return res.status(401).json({ error: 'Codigo nao encontrado' });

  const row = access as any;

  // Mark as used if first time
  if (!row.used_at) {
    const db = getDb();
    db.prepare('UPDATE access_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
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
    const code = createAccessCode(validation.data.email, 'participant');
    await sendAccessCode(validation.data.email, code);
    res.json({ code, email: validation.data.email });
  } catch (error) {
    next(error);
  }
});

// Manager: list all codes
authRoutes.get('/codes', requireManager, (req: Request, res: Response) => {
  const db = getDb();
  const codes = db.prepare('SELECT * FROM access_codes ORDER BY created_at DESC').all();
  res.json(codes);
});
