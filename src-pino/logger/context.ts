import { AsyncLocalStorage } from 'node:async_hooks';
import type { LogContext, LoggingContextOptions } from './types';
import { serializeError } from './error';
import { logDirect } from './core';

type LogLevel = 'info' | 'warn' | 'error';

type RequestLog = {
  level: 'info' | 'warn';
  message: string;
};

type LoggerFacade = {
  set(data: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(error: Error | string, context?: LogContext): void;
  emit(overrides?: LogContext): void;
  getContext(): LogContext;
};

type LoggingStore = {
  context: LogContext;
  startedAt: number;
  hasWarn: boolean;
  hasError: boolean;
  emitted: boolean;
  requestLogs: RequestLog[];
  facade: LoggerFacade;
};

const storage = new AsyncLocalStorage<LoggingStore>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeInto(target: LogContext, source: LogContext) {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue;

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
      store.requestLogs.push({ level: 'info', message });
    },

    warn(message: string, context?: LogContext) {
      store.hasWarn = true;
      if (context) mergeInto(store.context, context);
      store.requestLogs.push({ level: 'warn', message });
    },

    error(error: Error | string, context?: LogContext) {
      store.hasError = true;
      if (context) mergeInto(store.context, context);
      const err = typeof error === 'string' ? new Error(error) : error;
      mergeInto(store.context, { error: serializeError(err) });
    },

    emit(overrides?: LogContext) {
      if (store.emitted) return;
      store.emitted = true;

      const level: LogLevel = store.hasError
        ? 'error'
        : store.hasWarn
          ? 'warn'
          : 'info';

      const event: LogContext = {
        ...store.context,
        durationMs: Date.now() - store.startedAt,
      };

      if (store.requestLogs.length > 0) {
        event.requestLogs = store.requestLogs;
      }

      if (overrides) mergeInto(event, overrides);

      // logDirect routes to drain if configured, otherwise to pino
      logDirect(level, event, 'wide-event');
    },

    getContext() {
      return { ...store.context };
    },
  };
}

function createStore(initialContext?: LogContext): LoggingStore {
  const store: LoggingStore = {
    context: { ...(initialContext ?? {}) },
    startedAt: Date.now(),
    hasWarn: false,
    hasError: false,
    emitted: false,
    requestLogs: [],
    facade: null as unknown as LoggerFacade,
  };
  store.facade = buildFacade(store);
  return store;
}

export function useLogger(): LoggerFacade {
  const store = storage.getStore();

  if (!store) {
    throw new Error(
      'useLogger() was called outside of an active logging context.',
    );
  }

  return store.facade;
}

export function runWithLoggerStore<T>(store: LoggingStore, fn: () => T): T {
  return storage.run(store, fn);
}

export function createHttpLoggerContext(input: {
  requestId: string;
  method: string;
  path: string;
}): LoggingStore {
  return createStore({
    requestId: input.requestId,
    method: input.method,
    path: input.path,
  });
}

export async function runWithLoggingContext<T>(
  fn: () => Promise<T>,
  defaultContext?: LogContext,
  options?: LoggingContextOptions,
): Promise<T | undefined> {
  const store = createStore(defaultContext);
  const shouldRethrow = options?.rethrow ?? true;

  return storage.run(store, async () => {
    try {
      const result = await fn();
      store.facade.emit();
      return result;
    } catch (error) {
      store.facade.error(error as Error);
      store.facade.emit();
      if (shouldRethrow) throw error;
      return undefined;
    }
  });
}

// Exported only for use by middleware — not part of the public app API
export type { LoggingStore };
