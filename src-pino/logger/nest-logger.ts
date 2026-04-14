import type { LoggerService } from '@nestjs/common';
import { logDirect } from './core';

/**
 * Bridges NestJS's internal LoggerService to the same output path as wide events.
 * When a drain is configured (e.g. useDatadogDrain()), framework logs go through
 * it too — keeping all stdout output in the same structured format.
 *
 * Usage in main.ts:
 *   const app = await NestFactory.create(AppModule, { logger: new NestLogger() });
 */
export class NestLogger implements LoggerService {
  log(message: unknown, ...params: unknown[]) {
    logDirect('info', { context: lastString(params) }, String(message));
  }

  error(message: unknown, ...params: unknown[]) {
    // NestJS calls error(msg, stack, context) or error(msg, context)
    const context = lastString(params);
    const stack =
      params.length >= 2 && typeof params[0] === 'string'
        ? params[0]
        : undefined;
    logDirect('error', { context, ...(stack && { stack }) }, String(message));
  }

  warn(message: unknown, ...params: unknown[]) {
    logDirect('warn', { context: lastString(params) }, String(message));
  }

  // NestJS debug and verbose map to info — pino's debug/trace levels are
  // separate concerns from the wide-event pattern and not needed in this POC.
  debug(message: unknown, ...params: unknown[]) {
    logDirect('info', { context: lastString(params) }, String(message));
  }

  verbose(message: unknown, ...params: unknown[]) {
    logDirect('info', { context: lastString(params) }, String(message));
  }
}

function lastString(params: unknown[]): string | undefined {
  const last = params[params.length - 1];
  return typeof last === 'string' ? last : undefined;
}
