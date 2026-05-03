export type LogLevel = 'info' | 'warn' | 'error';

export type WideEvent = {
  message?: string;
  // Prevent accidental use of pino's default message key.
  msg?: never;
} & Record<string, unknown>;

export type LoggingContextOptions = {
  rethrow?: boolean;
};

export type LoggerFacade = {
  set(data: WideEvent): void;
  info(message: string, context?: WideEvent): void;
  warn(message: string, context?: WideEvent): void;
  error(error: Error | string, context?: WideEvent): void;
  emit(overrides?: WideEvent): void;
  getContext(): WideEvent;
};

export type LoggingStore = {
  context: WideEvent;
  startedAt: number;
  level: LogLevel;
  emitted: boolean;
  facade: LoggerFacade;
};
