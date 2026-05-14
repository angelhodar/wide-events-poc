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
    messageKey: 'message',
    timestamp: false,
    formatters: {
      level: (label) => ({ status: label }),
    },
  },
  // Keep pino as the only emit path; prettiness is just another destination.
  isPrettyEnabled(process.env)
    ? createPrettyDestination(createPrettyOptions(process.env))
    : pino.destination(1),
);

export function log(level: LogLevel, data: WideEvent): void {
  redactWideEvent(data);
  logger[level](data);
}
