import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ResolvedSession } from "../modules/accounts/sessions.js";

/** The header Next forwards after reading its host-only session cookie. */
export const SESSION_ID_HEADER = "x-session-id";

export interface SessionResolver {
  resolve(id: string): Promise<ResolvedSession | null>;
}

declare module "express-serve-static-core" {
  interface Request {
    auth?: ResolvedSession;
  }
}

/**
 * Resolves identity at the API boundary so authorization always sees the
 * account row as it is now, including a changed role or deleted account.
 */
export function sessionContext(sessionsRepository: SessionResolver): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const sessionId = req.get(SESSION_ID_HEADER);
    if (!sessionId) {
      next();
      return;
    }

    try {
      const resolved = await sessionsRepository.resolve(sessionId);
      if (resolved) req.auth = resolved;
      next();
    } catch (error) {
      next(error);
    }
  };
}
