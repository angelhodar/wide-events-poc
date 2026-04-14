import pino from 'pino';
import type { DrainFunction, LogContext } from './types';

export const rootLogger = pino({
  name: process.env.PINO_SERVICE ?? 'nestjs-pino',
  level: process.env.PINO_LEVEL ?? 'info',
});

let globalDrain: DrainFunction | null = null;

export function configureDrain(drain: DrainFunction): void {
  globalDrain = drain;
}

export function logDirect(
  level: 'info' | 'warn' | 'error',
  data: LogContext,
  message: string,
): void {
  if (globalDrain) {
    globalDrain({ ...data, level, message });
  } else {
    rootLogger[level](data, message);
  }
}
