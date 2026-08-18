import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken, type AccessTokenPayload } from '../modules/auth/auth.service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  try {
    req.user = verifyAccessToken(header.slice(7).trim());
    next();
  } catch (err) {
    next(err);
  }
}

/** Role gate. ADMIN implicitly satisfies every requirement. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (req.user.role === 'ADMIN' || roles.includes(req.user.role)) return next();
    next(forbidden(`This action requires one of: ${roles.join(', ')}`));
  };
}

export const requireAdmin = requireRole('ADMIN');
/** Anything that mutates students or launches jobs. */
export const requireTrainer = requireRole('ADMIN', 'TRAINER');
