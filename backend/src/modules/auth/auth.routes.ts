import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { isProd } from '../../config/env.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { unauthorized } from '../../lib/errors.js';
import * as auth from './auth.service.js';

const REFRESH_COOKIE = 'tcp_refresh';

/** Brute-force protection on the credential endpoints specifically. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again in a few minutes.' } },
});

const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v), {
    message: 'Password must contain an uppercase letter, a lowercase letter and a digit',
  });

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  name: z.string().min(2).max(120),
  role: z.enum(['ADMIN', 'TRAINER', 'VIEWER']).optional(),
});
const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });

export const authRouter = Router();

function setRefreshCookie(res: import('express').Response, token: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    // The refresh cookie is only ever sent to /api/auth/*, and `strict` keeps a
    // cross-site request from silently minting a new access token.
    sameSite: 'strict',
    path: '/api/auth',
    expires: expiresAt,
  });
}

authRouter.post(
  '/login',
  loginLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await auth.login(req.body.email, req.body.password);
    setRefreshCookie(res, result.refreshToken, result.expiresAt);
    res.json({ accessToken: result.accessToken, user: result.user });
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) throw unauthorized('No active session');
    const result = await auth.refresh(token);
    setRefreshCookie(res, result.refreshToken, result.expiresAt);
    res.json({ accessToken: result.accessToken, user: result.user });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await auth.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user) throw unauthorized();
    res.json({ user: auth.toPublicUser(user) });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    await auth.changePassword(req.user!.sub, req.body.currentPassword, req.body.newPassword);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.json({ message: 'Password updated. Please sign in again.' });
  }),
);

// -- user administration ------------------------------------------------------

authRouter.get(
  '/users',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ data: users.map(auth.toPublicUser) });
  }),
);

authRouter.post(
  '/users',
  requireAuth,
  requireAdmin,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const user = await auth.register(req.body);
    res.status(201).json({ user });
  }),
);

authRouter.patch(
  '/users/:id',
  requireAuth,
  requireAdmin,
  validateBody(z.object({ role: z.enum(['ADMIN', 'TRAINER', 'VIEWER']).optional(), isActive: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({ where: { id: req.params.id! }, data: req.body });
    res.json({ user: auth.toPublicUser(user) });
  }),
);
