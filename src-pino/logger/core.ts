import pino from 'pino';
import type { WideEvent, LogLevel } from './types';

const logger = pino({
  messageKey: 'message',
  transport: {
    target: 'pino-pretty',
  },
});

export function log(level: LogLevel, data: WideEvent): void {
  logger[level](data);
}
