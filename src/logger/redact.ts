const REDACTED = '[REDACTED]';

const sensitiveKeys = new Set([
  'apikey',
  'authorization',
  'clientsecret',
  'cookie',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
  'setcookie',
  'ssn',
  'token',
]);

const maskers: [RegExp, (match: string) => string][] = [
  [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, maskCreditCard],
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, maskEmail],
  [
    /(?:\+\d{1,3}[\s.-]?\(?\d{1,4}\)?|\(\d{1,4}\))(?:[\s.-]?\d{2,4}){2,4}\b/g,
    maskPhone,
  ],
  [/\beyJ[\w-]*\.[\w-]*\.[\w-]*\b/g, () => 'eyJ***.***'],
  [/\bBearer\s+[\w\-.~+/]{8,}=*/gi, () => 'Bearer ***'],
];

export function redactWideEvent(event: Record<string, unknown>): void {
  redactValue(event, new WeakSet<object>());
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return maskString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;

  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = redactValue(value[i], seen);
    }
    return value;
  }

  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    record[key] = isSensitiveKey(key) ? REDACTED : redactValue(child, seen);
  }

  return value;
}

function maskString(value: string): string {
  let result = value;

  for (const [pattern, mask] of maskers) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, mask);
  }

  return result;
}

function maskCreditCard(value: string): string {
  return `****${value.replace(/[\s-]/g, '').slice(-4)}`;
}

function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at < 1) return '***@***';

  const tld = value.slice(value.lastIndexOf('.'));
  return `${value[0]}***@***${tld}`;
}

function maskPhone(value: string): string {
  const digits = value.replace(/[^\d]/g, '');
  const countryCode = value.startsWith('+')
    ? (value.match(/^\+\d{1,3}/)?.[0] ?? '+')
    : '';

  if (digits.length <= 2) return '***';
  return `${countryCode}******${digits.slice(-2)}`;
}

function isSensitiveKey(key: string): boolean {
  return sensitiveKeys.has(key.replace(/[\s_.-]/g, '').toLowerCase());
}
