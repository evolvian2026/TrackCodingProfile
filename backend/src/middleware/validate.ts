import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, output } from 'zod';

/** Validates and replaces `req.body` with the parsed (and coerced) result. */
export function validateBody<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(result.error);
    req.body = result.data as output<S>;
    next();
  };
}

/**
 * Validates `req.query`. Express exposes `query` through a getter that later
 * versions make read-only, so the parsed result is attached separately and read
 * back with `parsedQuery`.
 */
export function validateQuery<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) return next(result.error);
    (req as Request & { validatedQuery?: unknown }).validatedQuery = result.data;
    next();
  };
}

export function parsedQuery<T>(req: Request): T {
  return (req as Request & { validatedQuery?: T }).validatedQuery as T;
}
