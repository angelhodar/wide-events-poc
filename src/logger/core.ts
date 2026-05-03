import pino from 'pino';
import type { WideEvent, LogLevel } from './types';
import { createPrettyDestination } from './pretty';
import { redactWideEvent } from './redact';

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino(
  {
    // Let the Datadog Agent own host attribution; JSON hostname can override it.
    base: null,
    messageKey: 'message',
    formatters: {
      level: (label) => ({ status: label }),
    },
  },
  // Keep pino as the only emit path; dev prettiness is just another destination.
  isDev ? createPrettyDestination() : pino.destination(1),
);

export function log(level: LogLevel, data: WideEvent): void {
  redactWideEvent(data);
  logger[level](data);
}
