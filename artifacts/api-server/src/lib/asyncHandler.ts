import { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async route handler so any rejected promise is forwarded to the
 * global Express error handler instead of leaving an unhandled rejection.
 *
 * The inner handler may return anything (Response, void, etc.) — TypeScript
 * will not complain about mixed return paths.
 */
type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler = (fn: AsyncHandler): RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
