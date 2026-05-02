import type { LogLevel, WideEvent } from './types';
import type { SerializedError } from './error';

const c = {
  reset: '\x1B[0m',
  dim: '\x1B[2m',
  red: '\x1B[31m',
  green: '\x1B[32m',
  yellow: '\x1B[33m',
  cyan: '\x1B[36m',
  gray: '\x1B[90m',
};

const levelColor: Record<LogLevel, string> = {
  info: c.cyan,
  warn: c.yellow,
  error: c.red,
};

function isSerializedError(value: unknown): value is SerializedError {
  return typeof value === 'object' && value !== null && 'kind' in value && 'message' in value;
}

function formatStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const frames = stack.split('\n').slice(1); // drop the "Error: message" first line
  const appFrames = frames.filter((f) => !f.includes('node_modules'));
  const relevant = appFrames.length > 0 ? appFrames.slice(0, 2) : frames.slice(0, 2);
  return relevant.map((f) => f.trim()).join('\n');
}

function printError(err: SerializedError, indent: string): void {
  console.log(`${indent}${c.red}${err.kind}:${c.reset} ${err.message}`);
  if (err.why)  console.log(`${indent}  ${c.dim}why:${c.reset} ${err.why}`);
  if (err.fix)  console.log(`${indent}  ${c.dim}fix:${c.reset} ${err.fix}`);
  const stack = formatStack(err.stack);
  if (stack) console.log(`${indent}  ${c.dim}${stack}${c.reset}`);
  if (err.cause) {
    console.log(`${indent}  ${c.dim}caused by:${c.reset}`);
    printError(err.cause, indent + '    ');
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);

  if (typeof value === 'object') {
    const pairs: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      pairs.push(typeof v === 'object' ? `${k}=${JSON.stringify(v)}` : `${k}=${v}`);
    }
    return pairs.join(' ');
  }
  
  return String(value);
}

export function prettyPrint(level: LogLevel, event: WideEvent): void {
  // Flatten the ctx wrapper that context.ts emits for structured JSON logging
  const flat: Record<string, unknown> = { ...event };

  if (flat.ctx && typeof flat.ctx === 'object' && !Array.isArray(flat.ctx)) {
    Object.assign(flat, flat.ctx);
    delete flat.ctx;
  }

  const { message, http, duration, ...rest } = flat as {
    message?: string;
    http?: { method?: string; url?: string; status_code?: number };
    duration?: number;
    [key: string]: unknown;
  };

  const ts = new Date().toISOString().slice(11, 23);
  const lc = levelColor[level] ?? c.reset;
  const service = process.env.SERVICE_NAME ?? 'app';

  let header = `${c.dim}${ts}${c.reset} ${lc}${level.toUpperCase()}${c.reset} ${c.cyan}[${service}]${c.reset}`;

  if (http?.method && http?.url) header += ` ${http.method} ${http.url}`;

  if (http?.status_code !== undefined) {
    const sc = http.status_code >= 400 ? c.red : c.green;
    header += ` ${sc}${http.status_code}${c.reset}`;
  }

  if (duration !== undefined) {
    header += ` ${c.dim}in ${duration}ms${c.reset}`;
  }

  if (message) header += ` ${c.dim}${message}${c.reset}`;

  console.log(header);

  const entries = Object.entries(rest).filter(([, v]) => v !== undefined);
  const last = entries.length - 1;

  entries.forEach(([key, value], i) => {
    const prefix = i === last ? '└─' : '├─';
    if (isSerializedError(value)) {
      console.log(`  ${c.dim}${prefix}${c.reset} ${c.cyan}${key}:${c.reset}`);
      printError(value, '      ');
    } else {
      console.log(`  ${c.dim}${prefix}${c.reset} ${c.cyan}${key}:${c.reset} ${formatValue(value)}`);
    }
  });
}
