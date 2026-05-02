import { Catch } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProblemDetail, useLogger } from './logger';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const error = exception instanceof Error ? exception : new Error(String(exception));

    try {
      useLogger().error(error);
    } catch {
      // Logger is unavailable outside a request context (e.g. bootstrap errors).
    }

    const problem = ProblemDetail.from(error, req.originalUrl || req.url);

    res.status(problem.status).json(problem.toJSON());
  }
}
