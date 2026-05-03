import type { LoggingContextOptions, WideEvent } from './types';
import { runWithLoggingContext } from './context';

export function UseLoggingContext(
  defaultContext?: WideEvent,
  options?: LoggingContextOptions,
): MethodDecorator {
  return (_target, _propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (
      ...args: unknown[]
    ) => Promise<unknown>;

    descriptor.value = async function (...args: unknown[]) {
      return runWithLoggingContext<unknown>(
        () => original.apply(this, args) as Promise<unknown>,
        defaultContext,
        options,
      );
    };

    return descriptor;
  };
}
