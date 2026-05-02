import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  LoggingContextOptions,
  WideEvent,
  LoggingStore,
  LoggerFacade,
} from './types';
import { createFacade, type FacadeStore } from './facade';

const storage = new AsyncLocalStorage<LoggingStore>();

// Exported for middleware and advanced integrations.
export function createStore(initialContext?: WideEvent): LoggingStore {
  const base = {
    context: { ...(initialContext ?? {}) },
    startedAt: performance.now(),
    level: 'info',
    emitted: false,
  } satisfies FacadeStore;

  const store: LoggingStore = {
    ...base,
    facade: createFacade(base),
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
