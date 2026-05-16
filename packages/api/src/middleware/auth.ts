import { Request, Response, NextFunction } from 'express';
import { validateCode } from '../services/authService.js';

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      accessCode?: { code: string; email: string; role: string; participantId: number | null };
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const code = req.headers['x-access-code'] as string;
  if (!code) return res.status(401).json({ error: 'Codigo de acesso necessario' });

  const access = await validateCode(code);
  if (!access) return res.status(401).json({ error: 'Codigo invalido' });

  // If expires_at is set and has passed, the magic link has expired
  if (access.expires_at) {
    const expiresAt = new Date(access.expires_at);
    if (expiresAt < new Date()) {
      return res.status(401).json({ error: 'Link expirado' });
    }
  }

  req.accessCode = {
    code: access.code,
    email: access.email,
    role: access.role,
    participantId: access.participant_id,
  };
  next();
}
