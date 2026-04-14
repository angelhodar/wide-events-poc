export type LogContext = Record<string, unknown>;

export type LoggingContextOptions = {
  rethrow?: boolean;
};

export type DrainFunction = (event: LogContext) => void;
