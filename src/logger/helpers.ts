import type { WideEvent } from './types';

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeInto(target: WideEvent, source: WideEvent) {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue;

    const current = target[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      mergeInto(current, value);
      continue;
    }

    target[key] = value;
  }
}
