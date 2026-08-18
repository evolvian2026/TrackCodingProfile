export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code: string = 'APP_ERROR',
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, msg, 'BAD_REQUEST', details);
export const unauthorized = (msg = 'Authentication required') => new AppError(401, msg, 'UNAUTHORIZED');
export const forbidden = (msg = 'You do not have access to this resource') => new AppError(403, msg, 'FORBIDDEN');
export const notFound = (msg = 'Resource not found') => new AppError(404, msg, 'NOT_FOUND');
export const conflict = (msg: string, details?: unknown) => new AppError(409, msg, 'CONFLICT', details);
export const payloadTooLarge = (msg: string) => new AppError(413, msg, 'PAYLOAD_TOO_LARGE');
export const tooManyRequests = (msg = 'Too many requests') => new AppError(429, msg, 'RATE_LIMITED');
