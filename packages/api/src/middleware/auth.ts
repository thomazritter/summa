import { Request, Response, NextFunction } from 'express';
import { validateCode } from '../services/authService.js';

// Single source of truth for the role allowlist. The access_codes CHECK
// constraint already restricts inserts, but enforcing the same set at the
// middleware layer keeps an unexpected role (constraint drop, manual
// INSERT bypassing the app) from silently authorising requests.
const ALLOWED_ROLES = ['participant', 'manager'] as const;
type AllowedRole = typeof ALLOWED_ROLES[number];

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      accessCode?: { code: string; email: string; role: AllowedRole; participantId: number | null };
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

  if (!ALLOWED_ROLES.includes(access.role as AllowedRole)) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  req.accessCode = {
    code: access.code,
    email: access.email,
    role: access.role as AllowedRole,
    participantId: access.participant_id,
  };
  next();
}
