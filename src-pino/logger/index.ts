// Context — the core wide-event API used in controllers, services, workers
export { useLogger, runWithLoggingContext } from './context';

// Errors
export { AppError, createError, HttpError, createHttpError, serializeError, parseAppError, toProblemDetail } from './error';
export type { ErrorCtx, SerializedError, ProblemDetail } from './error';

// Types
export type { WideEvent, LoggingContextOptions } from './types';

// NestJS wiring
export { LoggingContextMiddleware } from './middleware';
export { UseLoggingContext } from './decorator';
export { NestLogger } from './nest-logger';
