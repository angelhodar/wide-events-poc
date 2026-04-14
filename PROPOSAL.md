# Technical Proposal: Adopting Wide Event Logging

**Author:** Angel
**Date:** April 2026
**Status:** Draft — Pending Review

---

## Executive Summary

This proposal recommends adopting the **Wide Event** logging pattern as the company-wide observability standard. Under this model, each logical unit of work — whether an HTTP request, a Kafka consumer message, a queue handler or a scheduled job — emits a single, richly structured JSON log event at completion rather than multiple disconnected lines throughout execution. The change will enforce a consistent logging style across all teams and repositories, simplify debugging, and reduce Datadog indexing costs.

---

## 1. Problem Statement

Our current logging setup, while functional, has two structural weaknesses that compound as the number of services and teams grows.

**Lack of enforced structure.** All teams share the same underlying logger, and severity levels are consistent. However, the logger does not enforce a standard for field names, formatting conventions, or how much context should accompany a given log entry. Developers are free to log as much or as little as they choose, and the result is that a single unit of work may produce anywhere from one to a few log lines depending on who wrote the code. When debugging, engineers must manually correlate these scattered entries — even when distributed traces are available — because the logs themselves lack the structured context needed to tell a complete story.

**No standard for error reporting.** When errors occur, the information captured alongside them varies widely. Some log entries include a stack trace and relevant identifiers; others contain only a message string. There is no mechanism that forces errors to be reported in a structured, queryable format with consistent fields like root cause, affected user, or suggested remediation. Also, Datadog usually preserves just the main stack trace and doesn't provide more traces in case several errors are thrown using the `cause` prop for the `Error` class.

---

## 2. Proposed Solution: Wide Events

A Wide Event is a single JSON log entry emitted once at the end of a unit of work. Throughout execution, contextual data — user identity, subscription tier, feature flags, query durations, payload metadata — is silently accumulated on an in-memory object. When the operation completes (successfully or with an error), all of that context is flushed as one structured event.

This approach inverts the traditional model: instead of optimizing logs for writing (easy `console.log` calls scattered throughout code), it optimizes for querying — producing flat, high-cardinality JSON that log platforms like Datadog can index and facet natively.

### 2.1 Tooling

The library that provides this pattern in a built-in way is **Evlog** ([evlog.dev](https://www.evlog.dev)). Evlog is a zero-dependency, high-performance TypeScript logging library with native integrations for NestJS and other major frameworks. It provides structured error utilities out of the box that enforce a consistent, machine-readable error format across the codebase.

The library is actively maintained with regular releases and a growing ecosystem of framework adapters and drain integrations.

### 2.2 Extending Coverage to Non-HTTP Flows

Evlog's built-in framework integration covers HTTP request lifecycles. A significant portion of our workload, however, runs as Kafka consumers, SQS workers, and cron jobs — all of which fall outside that scope.

To close this gap, I propose a lightweight wrapper using `evlog/toolkit` that leverages Node.js `AsyncLocalStorage` to manage the Wide Event lifecycle for any entry point. `AsyncLocalStorage` is a stable Node.js API with negligible performance impact, and it eliminates the need to pass a logger instance through every function call.

The wrapper exposes two interfaces: a `runWithLoggingContext` function for standalone async work, and a `@UseLoggingContext()` NestJS decorator for class-based entry points.

```typescript
import { createLogger } from 'evlog';
import { createLoggerStorage } from 'evlog/toolkit';

const { storage, useLogger } = createLoggerStorage('Logger context');

export { useLogger };

type LogContext = Record<string, unknown>;

export async function runWithLoggingContext<T>(
  fn: () => Promise<T>,
  defaultContext?: LogContext,
): Promise<T> {
  const logger = createLogger(defaultContext);

  return storage.run(logger, async () => {
    try {
      const result = await fn();
      logger.emit();
      return result;
    } catch (error) {
      logger.error(error as Error);
      logger.emit();
      throw error;
    }
  });
}

export function UseLoggingContext(defaultContext?: LogContext): MethodDecorator {
  return (_target, _propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value;

    descriptor.value = function (...args: any[]) {
      return runWithLoggingContext(() => original.apply(this, args), defaultContext);
    };

    return descriptor;
  };
}
```

#### Usage with a NestJS class method

```typescript
@UseLoggingContext({ source: 'sqs-worker', queue: 'orders' })
async processMessage(message: OrderMessage) {
    const logger = useLogger();
    logger.assign({ orderId: message.id, attempt: message.retryCount });

    // Business logic executes here.
    // On completion or error, the decorator automatically emits
    // a single Wide Event containing all accumulated context.
}
```

#### Usage with a Kafka consumer (`@confluentinc/kafka-javascript`)

For non-class entry points like a Kafka `eachMessage` handler, the `runWithLoggingContext` function is used directly:

```typescript
await consumer.run({
  eachMessage: ({ topic, partition, message }) =>
    runWithLoggingContext(
      async () => {
        const log = useLogger();
        const payload = JSON.parse(message.value.toString());
        log.set({ eventType: payload.type, user: { id: payload.userId } });
        await processEvent(payload);
      },
      { source: 'kafka', kafka: { topic, offset: message.offset } },
    ),
});
```

### 2.3 Context Payload Convention

To get the full benefit of Wide Events, the shape of the context payload must be consistent across services. Without a convention, teams will inevitably diverge — one service logging `userId`, another `user_id`, another `uid` — and the ability to query across services breaks down.

The proposed convention is to **group context fields under a resource namespace**, following the pattern `{ <resource>: { <properties> } }`. Each top-level key represents a domain resource or infrastructure component, and its value is an object containing the relevant properties for that resource in the current unit of work.

#### Convention rules

1. **Every piece of context belongs under a resource key.** There should be no loose top-level fields like `userId` or `kafkaTopic`. Instead, the user's ID goes under `user`, the Kafka metadata goes under `kafka`, and so on.
2. **Resource keys are singular nouns** in camelCase: `user`, `order`, `cart`, `kafka`, `s3`, `subscription`.
3. **Property keys within a resource are short and direct**: `id`, `email`, `plan`, `topic`, `offset`, `bucket`, `key`. No redundant prefixes — `user.id` is self-explanatory, `user.userId` is not.
4. **Domain entities specific to the service follow the same pattern.** If a service manages invoices, the context uses `invoice: { id, status, total }`, not `invoiceId`, `invoiceStatus`, `invoiceTotal`.

#### Examples

**User and subscription context** (set early in the request lifecycle):

```typescript
log.set({
  user: { id: 'usr_8f2k', plan: 'pro', role: 'admin' },
  subscription: { id: 'sub_3x9w', status: 'active', trialEndsAt: '2026-05-01' },
});
```

**Kafka consumer metadata** (set via default context in `runWithLoggingContext`):

```typescript
runWithLoggingContext(handler, {
  source: 'kafka',
  kafka: { topic: 'order-events', partition: 3, offset: '18472', consumerGroup: 'order-processors' },
});
```

**S3 interaction** (set when an upload or fetch occurs):

```typescript
log.set({
  s3: { bucket: 'company-uploads', key: 'avatars/usr_8f2k/profile.jpg', sizeBytes: 245891 },
});
```

**Domain entity** (set by the service's business logic):

```typescript
log.set({
  order: { id: 'ord_7k3m', status: 'pending', itemCount: 3, total: 9999 },
  payment: { provider: 'stripe', chargeId: 'ch_1N2x', method: 'card' },
});
```

#### Resulting Wide Event

When the unit of work completes, all of these calls merge into a single flat JSON event. A Kafka consumer processing an order might produce:

```json
{
  "level": "info",
  "source": "kafka",
  "duration": 142,
  "kafka": { "topic": "order-events", "partition": 3, "offset": "18472", "consumerGroup": "order-processors" },
  "user": { "id": "usr_8f2k", "plan": "pro", "role": "admin" },
  "order": { "id": "ord_7k3m", "status": "completed", "itemCount": 3, "total": 9999 },
  "payment": { "provider": "stripe", "chargeId": "ch_1N2x", "method": "card" }
}
```

In Datadog, every nested field becomes a queryable facet: `@user.plan`, `@order.status`, `@kafka.topic`, `@payment.provider`. This is what makes cross-service queries possible — because every service that touches a `user` logs it under `user.id`, not a service-specific variation.

### 2.4 Structured Error Handling

One of the problems described in Section 1 is that errors are logged inconsistently and Datadog loses the cause chain. To solve this, we introduce a shared `AppError` class and a serialization utility that together enforce a uniform error shape across all services.

#### The `AppError` class

Every error thrown in application code should be an `AppError` (or wrapped in one). It extends the native `Error` with two mandatory context fields — `why` (root cause in plain language) and `fix` (a concrete remediation step) — and supports the standard `cause` property for chaining underlying errors.

```typescript
export type ErrorCtx = {
  why: string;
  fix: string;
};

export type SerializedError = {
  message: string;
  kind: string;
  stack: string | undefined;
  cause?: SerializedError;
};

type CreateErrorParams = Pick<Error, 'message' | 'cause'> & ErrorCtx;

export class AppError extends Error {
  ctx: ErrorCtx;

  constructor({ message, why, fix, cause }: CreateErrorParams) {
    super(message, { cause });
    this.name = 'AppError';
    this.ctx = { why, fix };
  }
}

export function createError(params: CreateErrorParams): AppError {
  return new AppError(params);
}

export function serializeError(err: Error): SerializedError {
  const result: SerializedError = { message: err.message, kind: err.name, stack: err.stack };
  if (err.cause instanceof Error) result.cause = serializeError(err.cause);
  return result;
}
```

The `createError` factory is the preferred way to instantiate errors throughout the codebase. It keeps call sites concise and makes it easy to enforce the `why`/`fix` contract at the type level — a developer cannot create an `AppError` without providing both fields.

#### Usage example

```typescript
const user = await db.findUser(userId);
if (!user) {
  throw createError({
    message: 'User not found',
    why: 'No user record exists for the given ID',
    fix: 'Verify the user ID is correct and the account has not been deleted',
  });
}

try {
  await stripe.charges.create({ amount: order.total, customer: user.stripeId });
} catch (err) {
  throw createError({
    message: 'Payment failed',
    why: 'Stripe charge was declined by the card issuer',
    fix: 'Retry with a different payment method or contact the cardholder',
    cause: err,
  });
}
```

In the second example, the original Stripe SDK error is preserved as the `cause`. When serialized, the full chain is retained — something Datadog's default error handling discards.

#### The Datadog drain

To get these structured errors into Datadog, we use a custom Evlog drain that writes NDJSON to stdout (where the Datadog agent picks it up). The drain calls `serializeError` to recursively flatten the entire cause chain into a queryable JSON structure:

```typescript
type DatadogLog = {
  message: string;
  status: string;
  ctx: Record<string, unknown>;
  error?: SerializedError;
};

function datadogDrain({ event }: DrainContext) {
  const { message = '', level, error, ...rest } = event;
  const err = error as Error | undefined;

  const log: DatadogLog = {
    message: err?.message ?? (message as string),
    status: level,
    ctx: rest,
  };

  if (err) log.error = serializeError(err);

  process.stdout.write(JSON.stringify(log) + '\n');
}
```

When a `payment failed` error is thrown with a Stripe cause, the resulting log event looks like this:

```json
{
  "message": "Payment failed",
  "status": "error",
  "ctx": {
    "source": "sqs-worker",
    "user": { "id": "usr_8f2k", "plan": "pro" },
    "order": { "id": "ord_7k3m", "total": 9999 }
  },
  "error": {
    "message": "Payment failed",
    "kind": "AppError",
    "stack": "AppError: Payment failed\n    at processOrder (/src/orders/process.ts:42:11)...",
    "cause": {
      "message": "Your card was declined.",
      "kind": "StripeCardError",
      "stack": "StripeCardError: Your card was declined.\n    at ...",
      "cause": null
    }
  }
}
```

Every level of the cause chain is preserved and queryable in Datadog: `@error.kind`, `@error.cause.kind`, `@error.cause.message`. This solves the problem described in Section 1 — engineers can see exactly what failed, why it failed at the application level, and what the underlying infrastructure error was, all in a single log entry.

---

## 3. Expected Benefits

### 3.1 Enforced Consistency Across Teams

The Wide Event pattern, combined with the context payload convention and structured error utilities, removes ambiguity from how teams log. Every service emits the same shape of output: one event per unit of work, with standardized resource-namespaced fields for identity, timing, errors, and business context. This consistency is enforced by the tooling and the convention rather than by code review alone.

### 3.2 Reduced Datadog Indexing Costs

By collapsing multiple log lines per action into a single event, the total number of indexed log events in Datadog will decrease. The magnitude depends on the service, but any reduction in event count translates directly into lower indexing costs.

### 3.3 Query-Driven Debugging

With Wide Events, every field becomes a high-cardinality facet that Datadog can index and query natively. Instead of searching for a `user_id` and reading through scattered lines, engineers can run targeted queries such as: *"Show me all errors for premium-tier users who triggered the new checkout feature flag in the last 24 hours."*

### 3.4 Structured, Actionable Errors

The `AppError` class and `serializeError` utility enforce a consistent error format with `why`, `fix`, and a fully preserved cause chain. When an error occurs, the Wide Event contains the full execution context — stack trace, user state, request payload, downstream latency — alongside these structured error fields, all in a single record. This eliminates guesswork and makes errors immediately actionable, both for engineers and for automated agents.

### 3.5 Automatic PII Redaction

Evlog includes built-in automatic redaction that scrubs personally identifiable information from events before they reach console output or any external drain. In production (`NODE_ENV === 'production'`), redaction is enabled by default with no configuration required.

Rather than replacing values with a flat `[REDACTED]` string, Evlog applies smart partial masking that preserves enough context for debugging while protecting the actual data. Built-in patterns cover credit card numbers, email addresses, IPv4 addresses, phone numbers, JWTs, bearer tokens, and IBANs. For example, an email like `alice@example.com` is masked to `a***@***.com`, and a credit card number is reduced to `****1111`.

Teams can extend the built-in patterns with custom redaction paths (e.g., `user.password`, `headers.authorization`) and custom regex patterns for domain-specific sensitive fields. This means that as services accumulate richer context in their Wide Events, the risk of accidentally persisting PII in Datadog is mitigated at the library level rather than relying on individual developers to remember to sanitize their log calls.

---

## 4. Rollout Plan

**Proof of Concept.** Select one microservice and instrument it with Wide Events alongside existing logging in a separate branch and deploy to dev for a few days and play with queries using this new format. This phase also serves to validate the `@UseLoggingContext()` wrapper and `runWithLoggingContext` utility working as expected and matching Datadog's output format.

**Automated Migration.** Once the PoC confirms the expected improvements, provide teams with a Claude Code skill that automates adoption across remaining services. The skill will install dependencies, inject the async context utility, and refactor entry points to use the new logging pattern — requiring minimal manual effort from each team.

---

## 5. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Large event payloads for complex workflows | Enforce a maximum field policy and exclude verbose payloads (e.g., full request bodies) by default; Evlog supports sampling to control volume further |
| Adoption resistance from teams | The automated Claude Code skill reduces the migration to a single command; no manual refactoring required |
| Evlog library maturity | The library is actively maintained with regular releases and a growing community; our custom wrapper abstracts Evlog behind our own interface, allowing us to swap implementations without service-level changes if needed |

---

*For questions or discussion, please reach out directly or comment on this document.*