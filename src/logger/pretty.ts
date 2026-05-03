import type pino from 'pino';
import type { LogLevel, WideEvent } from './types';
import type { SerializedError } from './error';

const color = {
  reset: '\x1B[0m',
  dim: '\x1B[2m',
  red: '\x1B[31m',
  green: '\x1B[32m',
  yellow: '\x1B[33m',
  cyan: '\x1B[36m',
};

const levelColor: Record<LogLevel, string> = {
  info: color.cyan,
  warn: color.yellow,
  error: color.red,
};

const systemFields = new Set([
  'ctx',
  'dd',
  'duration',
  'hostname',
  'http',
  'level',
  'message',
  'pid',
  'status',
  'time',
]);

type PrettyEvent = WideEvent & {
  ctx?: Record<string, unknown>;
  duration?: number;
  http?: Record<string, unknown>;
  status?: string;
  time?: number | string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSerializedError(value: unknown): value is SerializedError {
  return isRecord(value) && 'kind' in value && 'message' in value;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return JSON.stringify(value);

  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) =>
        isRecord(v) || Array.isArray(v)
          ? `${k}=${JSON.stringify(v)}`
          : `${k}=${String(v)}`,
      )
      .join(' ');
  }

  return String(value as string | number | boolean | symbol | bigint);
}

function formatTime(value: unknown): string {
  const date =
    typeof value === 'number' || typeof value === 'string'
      ? new Date(value)
      : new Date();

  if (Number.isNaN(date.getTime())) return formatTime(Date.now());
  return date.toLocaleTimeString('en-GB', { hour12: false });
}

function formatDuration(value: number): string {
  // Production keeps Datadog's nanosecond convention; humans read milliseconds.
  const ms = value / 1_000_000;
  return Number.isInteger(ms) ? `${ms}ms` : `${ms.toFixed(2)}ms`;
}

function stackPreview(stack: string | undefined): string[] {
  if (!stack) return [];

  const frames = stack
    .split('\n')
    .slice(1) // drop the "Error: message" first line
    .map((frame) => frame.trim())
    .filter(Boolean);

  const appFrames = frames.filter((frame) => !frame.includes('node_modules'));
  return (appFrames.length > 0 ? appFrames : frames).slice(0, 2);
}

function pushError(
  lines: string[],
  err: SerializedError,
  indent: string,
): void {
  lines.push(`${indent}${color.red}${err.kind}:${color.reset} ${err.message}`);
  if (err.why)
    lines.push(`${indent}  ${color.dim}why:${color.reset} ${err.why}`);
  if (err.fix)
    lines.push(`${indent}  ${color.dim}fix:${color.reset} ${err.fix}`);

  for (const frame of stackPreview(err.stack)) {
    lines.push(`${indent}  ${color.dim}${frame}${color.reset}`);
  }

  if (err.cause) {
    lines.push(`${indent}  ${color.dim}caused by:${color.reset}`);
    pushError(lines, err.cause, `${indent}    `);
  }
}

export function prettyPrint(event: PrettyEvent): void {
  const level = (event.status ?? 'info') as LogLevel;
  const service = process.env.DD_SERVICE ?? process.env.SERVICE_NAME ?? 'app';
  const http = isRecord(event.http) ? event.http : undefined;
  const fields: [string, unknown][] = [];

  let header = `${color.dim}${formatTime(event.time)}${color.reset} ${levelColor[level] ?? color.reset}${String(level).toUpperCase()}${color.reset} ${color.cyan}[${service}]${color.reset}`;

  if (typeof http?.method === 'string' && typeof http.url === 'string') {
    header += ` ${http.method} ${http.url}`;
  }

  if (typeof http?.status_code === 'number') {
    const statusColor = http.status_code >= 400 ? color.red : color.green;
    header += ` ${statusColor}${http.status_code}${color.reset}`;
  }

  if (event.duration !== undefined) {
    header += ` ${color.dim}in ${formatDuration(event.duration)}${color.reset}`;
  }

  if (event.message) header += ` ${color.dim}${event.message}${color.reset}`;

  if (event.ctx) {
    for (const [key, value] of Object.entries(event.ctx)) {
      if (value !== undefined) fields.push([key, value]);
    }
  }

  for (const [key, value] of Object.entries(event)) {
    if (!systemFields.has(key) && value !== undefined)
      fields.push([key, value]);
  }

  const lines = [header];

  for (const [index, [key, value]] of fields.entries()) {
    const prefix = index === fields.length - 1 ? '└─' : '├─';
    lines.push(
      `  ${color.dim}${prefix}${color.reset} ${color.cyan}${key}:${color.reset}`,
    );

    if (isSerializedError(value)) {
      pushError(lines, value, '      ');
    } else {
      lines[lines.length - 1] += ` ${formatValue(value)}`;
    }
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

export function createPrettyDestination(): pino.DestinationStream {
  return {
    write(line: string) {
      try {
        // Pretty-print the exact JSON pino produced, including formatters/hooks.
        prettyPrint(JSON.parse(line) as PrettyEvent);
      } catch {
        process.stdout.write(line.endsWith('\n') ? line : `${line}\n`);
      }
    },
  };
}
