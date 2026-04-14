import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  createHttpLoggerContext,
  runWithLoggerStore,
  useLogger,
} from './context';

@Injectable()
export class LoggingContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const requestId = req.header('x-request-id') ?? crypto.randomUUID();

    const store = createHttpLoggerContext({
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
    });

    runWithLoggerStore(store, () => {
      res.on('finish', () => {
        try {
          useLogger().emit({ status: res.statusCode });
        } catch {
          // The response may finish outside the expected context lifecycle.
        }
      });

      next();
    });
  }
}
