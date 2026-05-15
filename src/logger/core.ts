import pino from 'pino';
import type { WideEvent, LogLevel } from './types';
import {
  createPrettyDestination,
  createPrettyOptions,
  isPrettyEnabled,
} from './pretty';
import { redactWideEvent } from './redact';

const logger = pino(
  {
    // Let the Datadog Agent own host attribution; JSON hostname can override it.
    base: null,
    level: process.env.LOG_LEVEL ?? 'info',
    messageKey: 'message',
    timestamp: () => `,"timestamp":${Date.now()}`,
    formatters: {
      level: (label) => ({ status: label }),
    },
  },
  // Keep pino as the only emit path; prettiness is just another destination.
  isPrettyEnabled(process.env)
    ? createPrettyDestination(createPrettyOptions(process.env))
    : pino.destination(1),
);

type CoreLogger = {
  (level: LogLevel, data: WideEvent): void;
  debug(data: WideEvent): void;
  info(data: WideEvent): void;
  warn(data: WideEvent): void;
  error(data: WideEvent): void;
};

function write(level: LogLevel, data: WideEvent): void {
  redactWideEvent(data);
  logger[level](data);
}

export const log: CoreLogger = Object.assign(write, {
  debug: (data: WideEvent) => write('debug', data),
  info: (data: WideEvent) => write('info', data),
  warn: (data: WideEvent) => write('warn', data),
  error: (data: WideEvent) => write('error', data),
});
