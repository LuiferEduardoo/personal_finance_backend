import { NextFunction, Request, Response } from 'express';

const windows = new Map<string, { count: number; resetAt: number }>();

export function httpRateLimit(limit: number, windowMs = 60_000) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = request.ip || request.socket.remoteAddress || 'unknown';
    let window = windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowMs };
      windows.set(key, window);
    }
    window.count += 1;
    response.setHeader('RateLimit-Limit', limit);
    response.setHeader(
      'RateLimit-Remaining',
      Math.max(0, limit - window.count),
    );
    response.setHeader('RateLimit-Reset', Math.ceil(window.resetAt / 1000));
    if (window.count > limit) {
      response.setHeader(
        'Retry-After',
        Math.ceil((window.resetAt - now) / 1000),
      );
      response
        .status(429)
        .json({ statusCode: 429, message: 'Demasiadas solicitudes' });
      return;
    }
    next();
  };
}
