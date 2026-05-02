import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  createStore,
  runWithLoggerStore,
  useLogger,
} from './context';

@Injectable()
export class LoggingContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const requestId = req.header('x-request-id') ?? crypto.randomUUID();

    const store = createStore({
      requestId,
      http: {
        method: req.method,
        url: req.originalUrl || req.url,
      },
    });

    runWithLoggerStore(store, () => {
      res.on('finish', () => {
        useLogger().emit({ http: { status_code: res.statusCode } });
      });
      next();
    });
  }
}
