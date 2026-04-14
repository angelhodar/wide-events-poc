import {
  useLogger,
  runWithLoggingContext,
  type LogContext,
  type LoggingContextOptions,
} from './logging-context';
export { useLogger };

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
