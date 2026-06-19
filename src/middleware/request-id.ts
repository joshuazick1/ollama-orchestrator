import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const headerId = req.headers['x-request-id'];
  const id = typeof headerId === 'string' && headerId.length > 0 ? headerId : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
