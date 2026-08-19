import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import multer from 'multer';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isProd } from '../config/env.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route matches ${req.method} ${req.originalUrl}` } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: { code: err.code, message: err.message, details: err.details } });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }

  // body-parser (express.json / urlencoded) rejects malformed or oversized
  // bodies by throwing before any route runs. Those errors carry their own
  // HTTP status; without this they fall through to the 500 branch and a
  // client's typo looks like a server fault.
  if (isHttpBodyError(err)) {
    const status = err.status ?? err.statusCode ?? 400;
    const message =
      err.type === 'entity.parse.failed'
        ? 'The request body is not valid JSON.'
        : err.type === 'entity.too.large'
          ? 'The request body is too large.'
          : 'The request could not be read.';
    return res.status(status).json({
      error: { code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', message },
    });
  }

  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'The uploaded file exceeds the maximum allowed size' : err.message;
    return res.status(400).json({ error: { code: err.code, message } });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
      return res.status(409).json({ error: { code: 'CONFLICT', message: `A record with that ${target} already exists` } });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
    }
  }

  logger.error('Unhandled error', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong while handling the request',
      ...(isProd ? {} : { detail: err instanceof Error ? err.message : String(err) }),
    },
  });
}

interface HttpBodyError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
  expose?: boolean;
}

/** Detects the error shape body-parser throws for an unreadable request body. */
function isHttpBodyError(err: unknown): err is HttpBodyError {
  if (!(err instanceof Error)) return false;
  const candidate = err as HttpBodyError;
  const status = candidate.status ?? candidate.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 && typeof candidate.type === 'string';
}

/** Wraps an async handler so rejected promises reach the error middleware. */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(fn: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
