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

  req.accessCode = {
    code: (access as any).code,
    email: (access as any).email,
    role: (access as any).role,
    participantId: (access as any).participant_id,
  };
  next();
}

export async function requireManager(req: Request, res: Response, next: NextFunction) {
  await requireAuth(req, res, () => {
    if (req.accessCode?.role !== 'manager') {
      return res.status(403).json({ error: 'Acesso restrito' });
    }
    next();
  });
}
