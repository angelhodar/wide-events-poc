// Context — the core wide-event API used in controllers, services, workers
export { useLogger, runWithLoggingContext } from './context';

// Errors
export { AppError, ProblemDetail, serializeError } from './error';
export type { SerializedError } from './error';

// Types
export type { WideEvent, LoggingContextOptions } from './types';

// NestJS wiring
export { LoggingContextMiddleware } from './middleware';
export { UseLoggingContext } from './decorator';
export { NestLogger } from './nest-logger';
