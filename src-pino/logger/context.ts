import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  LoggingContextOptions,
  WideEvent,
  LoggingStore,
  LoggerFacade,
} from './types';
import { serializeError } from './error';
import { log } from './core';
import { mergeInto } from './helpers';

const storage = new AsyncLocalStorage<LoggingStore>();

type BuildFacadeOptions = Omit<LoggingStore, 'facade'>

function buildFacade(store: BuildFacadeOptions): LoggerFacade {
  return {
    set(data: WideEvent) {
      mergeInto(store.context, data);
    },

    info(message: string, context?: WideEvent) {
      if (context) mergeInto(store.context, context);
      void message;
    },

    warn(message: string, context?: WideEvent) {
      store.level = 'warn';
      if (context) mergeInto(store.context, context);
      void message;
    },

    error(error: Error | string, context?: WideEvent) {
      store.level = 'error';
      if (context) mergeInto(store.context, context);
      const err = typeof error === 'string' ? new Error(error) : error;
      mergeInto(store.context, { error: serializeError(err) });
    },

    emit(overrides?: WideEvent) {
      if (store.emitted) return;

      store.emitted = true;

      const { message, ...ctx } = store.context

      const event: WideEvent = {
        ctx,
        message,
        duration: Date.now() - store.startedAt,
      };

      if (overrides) mergeInto(event, overrides);

      log(store.level, event);
    },

    getContext() {
      return { ...store.context };
    },
  };
}

// Exported for middleware and advanced integrations.
export function createStore(initialContext?: WideEvent): LoggingStore {
  const base = {
    context: { ...(initialContext ?? {}) },
    startedAt: Date.now(),
    level: 'info',
    emitted: false,
  } satisfies BuildFacadeOptions;

  const store: LoggingStore = {
    ...base,
    facade: buildFacade(base),
  };

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

export async function runWithLoggingContext<T>(
  fn: () => Promise<T>,
  defaultContext?: WideEvent,
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
