import { AsyncLocalStorage } from 'node:async_hooks';
import pino, { type Logger as PinoLogger } from 'pino';

export type LogContext = Record<string, unknown>;

export type LoggingContextOptions = {
  rethrow?: boolean;
};

type LogLevel = 'info' | 'warn' | 'error';

type LoggerFacade = {
  set(data: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(error: Error | string, context?: LogContext): void;
  emit(overrides?: LogContext): void;
  getContext(): LogContext;
};

type LoggingStore = {
  logger: PinoLogger;
  context: LogContext;
  startedAt: number;
  hasWarn: boolean;
  hasError: boolean;
  emitted: boolean;
};

type LoggingRunner<T> = () => Promise<T>;

const storage = new AsyncLocalStorage<LoggingStore>();

const rootLogger = pino({
  name: process.env.PINO_SERVICE ?? 'nestjs-pino',
  level: process.env.PINO_LEVEL ?? 'info',
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeInto(target: LogContext, source: LogContext) {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) {
      continue;
    }

    const current = target[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      mergeInto(current, value);
      continue;
    }

    target[key] = value;
  }
}

function buildFacade(store: LoggingStore): LoggerFacade {
  return {
    set(data: LogContext) {
      mergeInto(store.context, data);
    },
    info(message: string, context?: LogContext) {
      if (context) mergeInto(store.context, context);
      store.logger.info({ message });
    },
    warn(message: string, context?: LogContext) {
      store.hasWarn = true;
      if (context) mergeInto(store.context, context);
      store.logger.warn({ message });
    },
    error(error: Error | string, context?: LogContext) {
      store.hasError = true;
      if (context) mergeInto(store.context, context);
      const err = typeof error === 'string' ? new Error(error) : error;
      mergeInto(store.context, {
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack,
        },
      });
    },
    emit() {
      if (store.emitted) return;

      const level: LogLevel = store.hasError
        ? 'error'
        : store.hasWarn
          ? 'warn'
          : 'info';

      const event = {
        ...store.context,
        durationMs: Date.now() - store.startedAt,
      };

      store.logger[level](event, 'wide-event');
      store.emitted = true;
    },
    getContext() {
      return { ...store.context };
    },
  };
}

function createStore(logger: PinoLogger, initialContext?: LogContext): LoggingStore {
  return {
    logger,
    context: { ...(initialContext ?? {}) },
    startedAt: Date.now(),
    hasWarn: false,
    hasError: false,
    emitted: false,
  };
}

export function useLogger(): LoggerFacade {
  const store = storage.getStore();

  if (!store) {
    throw new Error(
      'useLogger() was called outside of an active logging context.',
    );
  }

  return buildFacade(store);
}

export function runWithLoggerStore<T>(store: LoggingStore, fn: () => T): T {
  return storage.run(store, fn);
}

export function createHttpLoggerContext(input: {
  requestId: string;
  method: string;
  path: string;
}): LoggingStore {
  const logger = rootLogger.child({
    requestId: input.requestId,
    method: input.method,
    path: input.path,
  });

  return createStore(logger, {
    requestId: input.requestId,
    method: input.method,
    path: input.path,
  });
}

export async function runWithLoggingContext<T>(
  fn: LoggingRunner<T>,
  defaultContext?: LogContext,
  options?: LoggingContextOptions,
): Promise<T | undefined> {
  const store = createStore(rootLogger, defaultContext);
  const shouldRethrow = options?.rethrow ?? true;

  return storage.run(store, async () => {
    const log = buildFacade(store);

    try {
      const result = await fn();
      log.emit();
      return result;
    } catch (error) {
      log.error(error as Error);
      log.emit();

      if (shouldRethrow) throw error;

      return;
    }
  });
}
