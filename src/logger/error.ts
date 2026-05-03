export type SerializedError = {
  message: string;
  kind: string;
  stack: string | undefined;
  why?: string;
  fix?: string;
  status?: number;
  cause?: SerializedError;
};

type AppErrorParams = {
  message: string;
  why: string;
  fix: string;
  cause?: Error;
};

export class AppError extends Error {
  why: string;
  fix: string;

  constructor(params: AppErrorParams) {
    super(params.message, { cause: params.cause });
    this.name = 'AppError';
    this.why = params.why;
    this.fix = params.fix;
  }
}

type ProblemDetailParams = {
  title: string;
  status: number;
  why: string;
  fix: string;
  instance?: string;
  type?: string;
  cause?: Error;
};

export class ProblemDetail extends AppError {
  status: number;
  instance?: string;
  type?: string;

  constructor(params: ProblemDetailParams) {
    super({
      message: params.title,
      why: params.why,
      fix: params.fix,
      cause: params.cause,
    });
    this.name = 'ProblemDetail';
    this.status = params.status;
    this.instance = params.instance;
    this.type = params.type;
  }

  toJSON() {
    return {
      type: this.type,
      title: this.message,
      status: this.status,
      detail: this.why,
      fix: this.fix,
      instance: this.instance,
    };
  }

  static from(error: unknown, instance?: string): ProblemDetail {
    if (error instanceof ProblemDetail) {
      error.instance = instance;
      return error;
    }

    if (error instanceof AppError) {
      return new ProblemDetail({
        title: error.message,
        status: 500,
        why: error.why,
        fix: error.fix,
        instance,
        cause: error,
      });
    }

    if (error instanceof Error) {
      return new ProblemDetail({
        title: error.message,
        status: 500,
        why: 'An unexpected error occurred',
        fix: 'Contact support if the problem persists',
        instance,
        cause: error,
      });
    }

    return new ProblemDetail({
      title: String(error),
      status: 500,
      why: 'An unexpected error occurred',
      fix: 'Contact support if the problem persists',
      instance,
    });
  }
}

export function serializeError(err: Error): SerializedError {
  const result: SerializedError = {
    message: err.message,
    kind: err.name,
    stack: err.stack,
  };

  if (err instanceof ProblemDetail) {
    result.why = err.why;
    result.fix = err.fix;
    result.status = err.status;
  } else if (err instanceof AppError) {
    result.why = err.why;
    result.fix = err.fix;
  }

  if (err.cause instanceof Error) {
    result.cause = serializeError(err.cause);
  }

  return result;
}
