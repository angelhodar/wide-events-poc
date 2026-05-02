import type { LoggerService } from '@nestjs/common';
import { log } from './core';

export class NestLogger implements LoggerService {
  log(message: string, ...params: unknown[]) {
    log('info', { message, context: lastString(params) });
  }

  warn(message: string, ...params: unknown[]) {
    log('warn', { message, context: lastString(params) });
  }

  error(message: string, ...params: unknown[]) {
    // NestJS calls error(msg, stack, context) or error(msg, context)
    const context = lastString(params);
    const stack =
      params.length >= 2 && typeof params[0] === 'string'
        ? params[0]
        : undefined;
    log('error', {
      message,
      context,
      // Datadog Error Tracking expects stack traces under error.stack.
      ...(stack && { error: { kind: 'Error', message, stack } }),
    });
  }
}

function lastString(params: unknown[]): string | undefined {
  const last = params.at(-1);
  return typeof last === 'string' ? last : undefined;
}
