import type { NextFunction, Request, Response } from 'express';

export type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => void | Promise<void>;

/**
 * Wraps an async (or sync) Express handler so that:
 *  - synchronous throws are forwarded to `next(err)`
 *  - rejected promises are forwarded to `next(err)`
 *
 * The outer `try/catch` catches throws raised before `Promise.resolve` runs
 * (sync throws inside the handler); the `.catch(next)` handles rejections
 * returned via the promise. The `void` operator on the returned promise
 * suppresses Node's unhandled-rejection warning. Express 4 does not await
 * the return value, but the `.catch(next)` already handles the rejection —
 * `void` keeps lint and `--unhandled-rejections=strict` quiet.
 */
export const asyncHandler =
  (fn: AsyncRequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    try {
      void Promise.resolve(fn(req, res, next)).catch(next);
    } catch (err) {
      next(err);
    }
  };
