# Technical Proposal: Adopting Wide Event Logging with Pino

**Author:** Angel
**Date:** May 2026
**Status:** Draft - Pending Review

---

## Executive Summary

This proposal recommends adopting the **Wide Event** logging pattern as the company-wide observability standard. Under this model, each logical unit of work, whether an HTTP request, Kafka consumer message, queue handler, or scheduled job, emits a single structured JSON log event at completion rather than multiple disconnected lines throughout execution.

The current proof of concept implements this pattern in `src/logger` using a small company-owned facade backed by **Pino**. Application code accumulates context through `useLogger().set(...)`; the logger emits once at the end of the unit of work; and the final JSON shape is optimized for Datadog indexing, error tracking, and cross-service querying.

---

## 1. Problem Statement

Our current logging setup, while functional, has two structural weaknesses that compound as the number of services and teams grows.

**Lack of enforced structure.** All teams share the same underlying logger, and severity levels are consistent. However, the logger does not enforce a standard for field names, formatting conventions, or how much context should accompany a given log entry. Developers are free to log as much or as little as they choose, and the result is that a single unit of work may produce anywhere from one to many log lines depending on who wrote the code. When debugging, engineers must manually correlate scattered entries because the logs themselves lack the structured context needed to tell a complete story.

**No standard for error reporting.** When errors occur, the information captured alongside them varies widely. Some log entries include a stack trace and relevant identifiers; others contain only a message string. There is no mechanism that consistently reports errors with fields like root cause, remediation, HTTP status, and cause chain. Datadog also commonly preserves only the primary stack trace, which makes nested `Error.cause` chains difficult to inspect unless we serialize them ourselves.

---

## 2. Proposed Solution: Wide Events

A Wide Event is a single JSON log entry emitted once at the end of a unit of work. Throughout execution, contextual data such as user identity, route name, worker metadata, downstream dependency details, and domain resource state is accumulated in an AsyncLocalStorage-backed store. When the operation completes successfully or with an error, all accumulated context is flushed as one structured event.

This approach optimizes logs for querying instead of for writing. Rather than scattering `console.log` calls or short logger lines throughout code, services produce one Datadog-friendly event containing the full operational story.

### 2.1 Runtime Tooling

The POC uses **Pino** as the only emit path.

```typescript
const logger = pino(
  {
    base: null,
    messageKey: 'message',
    formatters: {
      level: (label) => ({ status: label }),
    },
  },
  process.env.NODE_ENV !== 'production'
    ? createPrettyDestination()
    : pino.destination(1),
);
```

The implementation intentionally keeps the logging abstraction small:

1. `pino` writes production JSON to stdout for the Datadog Agent.
2. Development mode uses a custom pretty destination, but it pretty-prints the exact JSON Pino produced.
3. `base: null` avoids emitting host metadata that can override Datadog Agent attribution.
4. Pino's level formatter maps log levels to Datadog's `status` field.
5. The message key is explicitly `message`; the `WideEvent` type prevents accidental use of Pino's default `msg` field.

### 2.2 Logger Module API

The public API exported from `src/logger/index.ts` is:

```typescript
export { useLogger, runWithLoggingContext } from './context';
export { AppError, ProblemDetail, serializeError } from './error';
export type { WideEvent, LoggingContextOptions } from './types';
export { LoggingContextMiddleware } from './middleware';
export { UseLoggingContext } from './decorator';
export { NestLogger } from './nest-logger';
```

Application code normally uses `useLogger()` inside an active logging context:

```typescript
const log = useLogger();

log.set({
  source: { layer: 'controller' },
  route: { name: 'get-user' },
  user: { id },
});
```

The `LoggerFacade` supports these operations:

```typescript
type LoggerFacade = {
  set(data: WideEvent): void;
  info(message: string, context?: WideEvent): void;
  warn(message: string, context?: WideEvent): void;
  error(error: Error | string, context?: WideEvent): void;
  emit(overrides?: WideEvent): void;
  getContext(): WideEvent;
};
```

`set(...)` is the primary API for accumulating context. It deep-merges plain objects and ignores `null` or `undefined` values. `warn(...)` marks the final event as `warn`. `error(...)` marks the final event as `error` and stores a serialized error. `emit(...)` flushes the event once and ignores later emit attempts for the same context.

### 2.3 Context Lifecycle

The context lifecycle is backed by Node.js `AsyncLocalStorage`.

```typescript
export async function runWithLoggingContext<T>(
  fn: () => Promise<T>,
  defaultContext?: WideEvent,
  options?: { rethrow?: boolean },
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
```

This gives us one reusable lifecycle for HTTP requests, scheduled jobs, workers, and message consumers.

#### HTTP requests

`LoggingContextMiddleware` creates a logging store for every HTTP request and seeds Datadog's `http` namespace:

```typescript
const requestId = req.header('x-request-id') ?? crypto.randomUUID();

const store = createStore({
  http: {
    method: req.method,
    request_id: requestId,
    url: req.originalUrl || req.url,
  },
});
```

When the response finishes, the middleware emits the event with `http.status_code`:

```typescript
res.on('finish', () => {
  useLogger().emit({ http: { status_code: res.statusCode } });
});
```

The app wires this middleware globally:

```typescript
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggingContextMiddleware).forRoutes('*');
  }
}
```

#### Scheduled jobs and workers

Class-based entry points use `@UseLoggingContext(...)`:

```typescript
@Cron('* * * * *')
@UseLoggingContext({ source: 'cron', job: 'syncUsers' }, { rethrow: false })
async handleSync() {
  const log = useLogger();

  log.set({
    sync: {
      startedAt: new Date().toISOString(),
    },
  });

  await this.syncUsersWorker.run();

  log.set({
    sync: {
      status: 'ok',
    },
  });
}
```

`rethrow` defaults to `true`. Setting `{ rethrow: false }` records and emits the error while preventing recurring schedulers from crashing the process.

#### Message consumers

Function-based entry points use `runWithLoggingContext(...)` directly:

```typescript
await consumer.run({
  eachMessage: ({ topic, partition, message }) =>
    runWithLoggingContext(
      async () => {
        const log = useLogger();
        const payload = JSON.parse(message.value.toString());

        log.set({
          event: { type: payload.type },
          user: { id: payload.userId },
        });

        await processEvent(payload);
      },
      {
        source: 'kafka',
        kafka: { topic, partition, offset: message.offset },
      },
    ),
});
```

### 2.4 Final Event Shape

The logger builds the final event with Datadog conventions in mind.

1. `duration` is owned by the logger and emitted in nanoseconds, matching Datadog's standard duration unit.
2. Datadog-recognized namespaces stay top-level: `db`, `dd`, `error`, `http`, `logger`, `network`, `span_id`, `trace_id`, and `usr`.
3. `message` stays top-level.
4. All other application context is grouped under `ctx`.
5. If application code tries to set `duration`, it is moved under `ctx.duration` so it does not conflict with logger-owned duration.

For example, application code may accumulate this context:

```typescript
log.set({
  source: { layer: 'controller' },
  route: { name: 'get-user-orders' },
  user: { id: 'usr_pro', plan: 'pro' },
  orders: { count: 2, totalRevenue: 6298 },
});
```

The resulting production log is a Pino JSON event shaped like this:

```json
{
  "status": "info",
  "time": 1777824000000,
  "duration": 42450000,
  "http": {
    "method": "GET",
    "request_id": "7b9f3a57-3d4d-4a90-b7c8-18c4d4674ab3",
    "url": "/users/usr_pro/orders",
    "status_code": 200
  },
  "ctx": {
    "source": { "layer": "controller" },
    "route": { "name": "get-user-orders" },
    "user": { "id": "usr_pro", "plan": "pro" },
    "orders": { "count": 2, "totalRevenue": 6298 }
  }
}
```

In Datadog, the business fields are queryable under `@ctx.*`, for example `@ctx.user.id`, `@ctx.user.plan`, `@ctx.route.name`, and `@ctx.orders.count`. Datadog-specific fields such as `@http.status_code`, `@duration`, and `@status` remain in their expected locations.

### 2.5 Context Payload Convention

To get the full benefit of Wide Events, the shape of the context payload must be consistent across services. Without a convention, teams will diverge, for example one service logging `userId`, another `user_id`, and another `uid`.

The proposed convention is to group application context under resource namespaces before it reaches the final `ctx` object. Each key represents a domain resource, workflow, route, or infrastructure component, and each value contains the relevant properties for that unit of work.

#### Convention rules

1. Application context should use resource keys such as `user`, `order`, `route`, `sync`, `kafka`, `s3`, or `subscription`.
2. Resource keys should be singular nouns in camelCase unless the domain concept is naturally plural, such as `orders` for an aggregate result.
3. Property keys within a resource should be short and direct: `id`, `email`, `plan`, `topic`, `offset`, `bucket`, `key`.
4. Do not duplicate the resource name inside the property: use `user.id`, not `user.userId`.
5. Use Datadog-reserved top-level namespaces only when intentionally targeting Datadog semantics.

#### Examples

```typescript
log.set({
  user: { id: 'usr_8f2k', plan: 'pro', role: 'admin' },
  subscription: { id: 'sub_3x9w', status: 'active' },
});
```

```typescript
runWithLoggingContext(handler, {
  source: 'kafka',
  kafka: {
    topic: 'order-events',
    partition: 3,
    offset: '18472',
    consumerGroup: 'order-processors',
  },
});
```

```typescript
log.set({
  order: { id: 'ord_7k3m', status: 'pending', itemCount: 3, total: 9999 },
  payment: { provider: 'stripe', chargeId: 'ch_1N2x', method: 'card' },
});
```

### 2.6 Structured Error Handling

The logger module includes shared error types and serialization utilities.

```typescript
export class AppError extends Error {
  why: string;
  fix: string;

  constructor(params: {
    message: string;
    why: string;
    fix: string;
    cause?: Error;
  }) {
    super(params.message, { cause: params.cause });
    this.name = 'AppError';
    this.why = params.why;
    this.fix = params.fix;
  }
}
```

`ProblemDetail` extends `AppError` for HTTP-facing failures. It adds `status`, optional `type`, optional `instance`, and a `toJSON()` method that returns an RFC 7807-style response body:

```typescript
throw new ProblemDetail({
  title: 'Payment failed',
  status: 402,
  why: 'Card declined by issuer',
  fix: 'Try a different payment method',
});
```

The global exception filter converts thrown errors to `ProblemDetail`, logs the error through the active request context when available, and returns the problem response:

```typescript
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const error =
      exception instanceof Error ? exception : new Error(String(exception));

    try {
      useLogger().error(error);
    } catch {
      // Logger is unavailable outside a request context, such as bootstrap errors.
    }

    const problem = ProblemDetail.from(error, req.originalUrl || req.url);
    res.status(problem.status).json(problem.toJSON());
  }
}
```

`serializeError(...)` preserves the full cause chain:

```typescript
export type SerializedError = {
  message: string;
  kind: string;
  stack: string | undefined;
  why?: string;
  fix?: string;
  status?: number;
  cause?: SerializedError;
};
```

When an error is logged, the final event includes a top-level `error` object for Datadog Error Tracking:

```json
{
  "status": "error",
  "time": 1777824000000,
  "duration": 38100000,
  "http": {
    "method": "GET",
    "request_id": "7b9f3a57-3d4d-4a90-b7c8-18c4d4674ab3",
    "url": "/checkout",
    "status_code": 402
  },
  "error": {
    "message": "Payment failed",
    "kind": "ProblemDetail",
    "stack": "ProblemDetail: Payment failed\n    at AppService.checkout ...",
    "why": "Card declined by issuer",
    "fix": "Try a different payment method",
    "status": 402
  },
  "ctx": {
    "checkout": { "step": "charge" }
  }
}
```

Every level of `error.cause` is recursively serialized when present, making nested failures queryable instead of relying on Datadog to infer cause chains from a single stack trace.

### 2.7 NestJS Framework Logs

The POC also provides `NestLogger`, an implementation of Nest's `LoggerService`:

```typescript
const app = await NestFactory.create(AppModule, { logger: new NestLogger() });
```

This keeps framework logs on the same Pino output path. Nest error logs map stack traces to `error.stack`, which is the field Datadog Error Tracking expects.

### 2.8 Automatic Redaction

Before any event reaches Pino, `core.log(...)` calls `redactWideEvent(...)`. This gives HTTP wide events, worker events, cron events, and direct Nest framework logs the same sanitization path.

The current redaction layer intentionally stays small and built-in:

1. Sensitive key redaction replaces values for keys such as `authorization`, `cookie`, `password`, `token`, `apiKey`, `privateKey`, `clientSecret`, and `ssn` with `[REDACTED]`, regardless of where they appear in the event tree.
2. Smart string masking partially masks common high-risk values while preserving enough debugging signal: credit cards, email addresses, phone numbers, JWTs, and bearer tokens.
3. The implementation is not configurable yet. If a service needs custom redaction paths or domain-specific regexes, that should be added behind a concrete requirement rather than preemptively expanding the logger API.

For example, a context value like `user.email = "alice@example.com"` becomes `a***@***.com`, a phone number like `+1 555 123 4567` becomes `+1******67`, a credit card becomes `****1111`, and `headers.authorization` becomes `[REDACTED]`.

---

## 3. Expected Benefits

### 3.1 Enforced Consistency Across Teams

The Wide Event pattern, combined with the resource context convention and shared error utilities, removes ambiguity from how teams log. Every service emits one event per unit of work with standardized placement for status, duration, HTTP metadata, Datadog-reserved fields, business context, and errors.

### 3.2 Reduced Datadog Indexing Costs

By collapsing multiple log lines per action into a single completion event, the total number of indexed log events in Datadog should decrease. The exact savings depend on service behavior, but reducing event count directly reduces indexing volume.

### 3.3 Query-Driven Debugging

With Wide Events, engineers can query the final state of a unit of work instead of reconstructing it from scattered lines. Example Datadog queries include:

```text
@status:error @ctx.user.plan:pro @ctx.route.name:get-user-orders
```

```text
@http.status_code:402 @error.kind:ProblemDetail @ctx.checkout.step:charge
```

### 3.4 Structured, Actionable Errors

`AppError`, `ProblemDetail`, and `serializeError` enforce a consistent error format with `why`, `fix`, HTTP status when applicable, stack trace, and recursive cause serialization. This makes errors more useful for engineers and for automated agents that need machine-readable failure context.

### 3.5 Automatic PII Redaction

Sensitive values are sanitized centrally in the logger before Pino emits the event. This reduces the chance that rich context accumulation accidentally sends credentials, tokens, payment data, email addresses, phone numbers, or other PII to Datadog.

### 3.6 Minimal Runtime Dependency

The POC does not depend on a specialized wide-event logging framework. It uses Pino for high-performance JSON emission and keeps the company-specific behavior in a small module that we own. This makes the API easier to standardize internally and reduces the risk of being locked into a third-party abstraction.

### 3.7 Better Local Development Output

Development mode uses a custom pretty destination so developers can read logs easily while still exercising the same JSON event shape Pino emits in production. This avoids a common failure mode where local logs look useful but production logs have a different structure.

---

## 4. Rollout Plan

**Proof of Concept.** Use this repository to validate the logger module against representative flows: HTTP controller and service calls, handled HTTP errors, scheduled cron jobs, worker calls, and future message consumer examples. Confirm the emitted JSON shape in production mode matches Datadog expectations.

**Datadog Validation.** Deploy one instrumented service or sandbox build to a development environment. Validate facets, queries, Error Tracking behavior, `duration` units, `http.*` parsing, and `ctx.*` business context indexing.

**Production Readiness.** Before broader rollout, add or confirm remaining production controls: payload size guidance, sampling policy if needed, and service-level conventions for common resources such as `user`, `account`, `subscription`, `order`, `route`, and `kafka`.

**Automated Migration.** Once the POC confirms the expected improvements, provide teams with an automation workflow that installs dependencies, wires `LoggingContextMiddleware`, configures `NestLogger`, introduces shared error types, and refactors entry points to use `useLogger().set(...)` and `runWithLoggingContext(...)`.

---

*For questions or discussion, please reach out directly or comment on this document.*
