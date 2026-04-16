import { createLogger } from 'evlog';
import { createLoggerStorage } from 'evlog/toolkit';

const { storage, useLogger } = createLoggerStorage('Non HTTP logging context');

export { useLogger };

type LogContext = Record<string, unknown>;
type LoggingContextOptions = {
  rethrow?: boolean;
};
type LoggingRunner<T> = () => Promise<T>;

export async function runWithLoggingContext<T>(
  fn: LoggingRunner<T>,
  defaultContext?: LogContext,
  options?: LoggingContextOptions,
): Promise<T | undefined> {
  const logger = createLogger(defaultContext);
  const shouldRethrow = options?.rethrow ?? true;

  return storage.run(logger, async () => {
    try {
      const result = await fn();
      logger.emit();
      return result;
    } catch (error) {
      logger.error(error as Error);
      logger.emit();

      if (shouldRethrow) {
        throw error;
      }

      return undefined;
    }
  });
}

export function UseLoggingContext(
  defaultContext?: LogContext,
  options?: LoggingContextOptions,
): MethodDecorator {
  return (_target, _propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (
      ...args: unknown[]
    ) => Promise<unknown>;

    descriptor.value = async function (...args: unknown[]) {
      return runWithLoggingContext(
        () => original.apply(this, args),
        defaultContext,
        options,
      );
    };

    return descriptor;
  };
}
