export type AppErrorOptions = {
  message: string;
  cause?: Error;
  details?: Record<string, unknown>;
};

export type HttpErrorOptions = AppErrorOptions & {
  status?: number;
  why?: string;
  fix?: string;
  link?: string;
};

export class AppError extends Error {
  details?: Record<string, unknown>;

  constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'AppError';
    this.details = options.details;
  }
}

export class HttpError extends AppError {
  status: number;
  why?: string;
  fix?: string;
  link?: string;

  constructor(options: HttpErrorOptions) {
    super(options);
    this.name = 'HttpError';
    this.status = options.status ?? 500;
    this.why = options.why;
    this.fix = options.fix;
    this.link = options.link;
  }
}

export function createHttpError(options: HttpErrorOptions): HttpError {
  return new HttpError(options);
}

export function parseAppError(error: unknown): {
  message: string;
  status: number;
  why?: string;
  fix?: string;
  link?: string;
} {
  if (error instanceof HttpError) {
    return {
      message: error.message,
      status: error.status,
      why: error.why,
      fix: error.fix,
      link: error.link,
    };
  }

  if (error instanceof AppError) {
    return {
      message: error.message,
      status: 500,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      status: 500,
    };
  }

  return {
    message: String(error),
    status: 500,
  };
}
