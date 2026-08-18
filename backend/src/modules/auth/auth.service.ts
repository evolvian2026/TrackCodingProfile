import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role, User } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { conflict, unauthorized } from '../../lib/errors.js';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  lastLoginAt: Date | null;
}

export const toPublicUser = (user: User): PublicUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  lastLoginAt: user.lastLoginAt,
});

export const hashPassword = (plain: string) => bcrypt.hash(plain, env.BCRYPT_ROUNDS);

export function signAccessToken(user: Pick<User, 'id' | 'email' | 'role'>): string {
  const payload: AccessTokenPayload = { sub: user.id, email: user.email, role: user.role };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_TTL } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
  } catch {
    throw unauthorized('Session expired or invalid. Please sign in again.');
  }
}

/** Refresh tokens are random opaque strings; only their hash is stored. */
async function issueRefreshToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(48).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 86_400_000);
  await prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  return { token, expiresAt };
}

export async function register(input: { email: string; password: string; name: string; role?: Role }): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw conflict('An account with that email already exists');

  const user = await prisma.user.create({
    data: {
      email,
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      role: input.role ?? 'VIEWER',
    },
  });
  return toPublicUser(user);
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });

  // Always run a bcrypt comparison so a missing account and a wrong password
  // take the same amount of time.
  const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const matches = await bcrypt.compare(password, hash);

  if (!user || !matches) throw unauthorized('Incorrect email or password');
  if (!user.isActive) throw unauthorized('This account has been deactivated');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const refresh = await issueRefreshToken(user.id);

  return {
    accessToken: signAccessToken(user),
    refreshToken: refresh.token,
    expiresAt: refresh.expiresAt,
    user: toPublicUser({ ...user, lastLoginAt: new Date() }),
  };
}

export async function refresh(rawToken: string): Promise<AuthResult> {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });

  if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  if (!stored.user.isActive) throw unauthorized('This account has been deactivated');

  // Rotate: the presented token is burned and a fresh one issued.
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  const next = await issueRefreshToken(stored.userId);

  return {
    accessToken: signAccessToken(stored.user),
    refreshToken: next.token,
    expiresAt: next.expiresAt,
    user: toPublicUser(stored.user),
  };
}

export async function logout(rawToken?: string): Promise<void> {
  if (!rawToken) return;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized();
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw unauthorized('Current password is incorrect');
  }
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
  // Force every other session to re-authenticate.
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function purgeExpiredRefreshTokens(): Promise<number> {
  const res = await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return res.count;
}
