import { log } from './core';
import { serializeError } from './error';
import { mergeInto } from './helpers';
import type { LoggerFacade, LoggingStore, WideEvent } from './types';

export type FacadeStore = Omit<LoggingStore, 'facade'>;

// These namespaces have Datadog meaning, so keep them top-level instead of ctx.*.
const datadogContextKeys = new Set([
  'db',
  'dd',
  'error',
  'http',
  'logger',
  'network',
  'span_id',
  'trace_id',
  'usr',
]);

function buildEvent(store: FacadeStore): WideEvent {
  const ctx: WideEvent = {};
  const event: WideEvent = {
    // Datadog's standard duration field is nanoseconds, not milliseconds.
    duration: Math.round((performance.now() - store.startedAt) * 1_000_000),
  };

  for (const [key, value] of Object.entries(store.context)) {
    if (value === undefined) continue;
    if (key === 'message') {
      event.message = value as string;
    } else if (key === 'duration') {
      // The logger owns top-level duration; user-provided timings stay custom.
      ctx.duration = value;
    } else if (datadogContextKeys.has(key)) {
      event[key] = value;
    } else {
      ctx[key] = value;
    }
  }

  if (Object.keys(ctx).length > 0) event.ctx = ctx;
  return event;
}

export function createFacade(store: FacadeStore): LoggerFacade {
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
      if (overrides) mergeInto(store.context, overrides);

      log(store.level, buildEvent(store));
    },

    getContext() {
      return { ...store.context };
    },
  };
}
