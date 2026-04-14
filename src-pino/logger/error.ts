export type ErrorCtx = {
  why: string;
  fix: string;
};

export type SerializedError = {
  message: string;
  kind: string;
  stack: string | undefined;
  ctx?: ErrorCtx;
  status?: number;
  cause?: SerializedError;
};

type CreateErrorParams = {
  message: string;
  why: string;
  fix: string;
  cause?: Error;
};

type CreateHttpErrorParams = CreateErrorParams & {
  status?: number;
};

export class AppError extends Error {
  ctx: ErrorCtx;

  constructor(params: CreateErrorParams) {
    super(params.message, { cause: params.cause });
    this.name = 'AppError';
    this.ctx = { why: params.why, fix: params.fix };
  }
}

export class HttpError extends AppError {
  status: number;

  constructor(params: CreateHttpErrorParams) {
    super(params);
    this.name = 'HttpError';
    this.status = params.status ?? 500;
  }
}

export function createError(params: CreateErrorParams): AppError {
  return new AppError(params);
}

export function createHttpError(params: CreateHttpErrorParams): HttpError {
  return new HttpError(params);
}

export function serializeError(err: Error): SerializedError {
  const result: SerializedError = {
    message: err.message,
    kind: err.name,
    stack: err.stack,
  };

  if (err instanceof HttpError) {
    result.ctx = err.ctx;
    result.status = err.status;
  } else if (err instanceof AppError) {
    result.ctx = err.ctx;
  }

  if (err.cause instanceof Error) {
    result.cause = serializeError(err.cause);
  }

  return result;
}

export type ProblemDetail = {
  type?: string;
  title: string;
  status: number;
  detail?: string;   // why — root cause explanation
  instance?: string; // request path
  fix?: string;      // remediation guidance (RFC 7807 extension)
};

export function toProblemDetail(error: unknown, instance?: string): ProblemDetail {
  const parsed = parseAppError(error);
  return {
    title: parsed.message,
    status: parsed.status,
    detail: parsed.why,
    instance,
    fix: parsed.fix,
  };
}

export function parseAppError(error: unknown): {
  message: string;
  status: number;
  why?: string;
  fix?: string;
} {
  if (error instanceof HttpError) {
    return {
      message: error.message,
      status: error.status,
      why: error.ctx.why,
      fix: error.ctx.fix,
    };
  }

  if (error instanceof AppError) {
    return {
      message: error.message,
      status: 500,
      why: error.ctx.why,
      fix: error.ctx.fix,
    };
  }

  if (error instanceof Error) {
    return { message: error.message, status: 500 };
  }

  return { message: String(error), status: 500 };
}
