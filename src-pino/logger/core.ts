import pino from 'pino';
import type { WideEvent, LogLevel } from './types';
import { prettyPrint } from './pretty';

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  messageKey: 'message',
  formatters: {
    level: (label) => ({ status: label }),
  },
});

export function log(level: LogLevel, data: WideEvent): void {
  if (isDev) prettyPrint(level, data);
  else logger[level](data);
}
