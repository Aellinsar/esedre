import fs from 'node:fs';
import path from 'node:path';
import { readGlobalConfig } from '../config.js';

let debugOverride: boolean | null = null;
let daemonLogPath: string | null = null;

const SENSITIVE_KEY_REGEX = /^(?:token|mcptoken|secret|password|key|apikey|authorization|bearer|credential|privatekey)$/i;
const SENSITIVE_SUBSTRING_REGEX = /(?:bearer|token|secret|password|apikey|authorization|credential)/i;
const BASIC_AUTH_URL_REGEX = /(https?:\/\/)([^:\s@]+):([^@\s]+)@/g;
const BEARER_TOKEN_REGEX = /Bearer\s+[a-zA-Z0-9_\-\.]+/gi;
const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B-\x0C\x0E-\x1F]/g;

const MAX_STRING_LENGTH = 2048;
const MAX_DEPTH = 5;
const MAX_LINE_LENGTH = 16384;

/**
 * Configure runtime override for debug logging.
 */
export function setDebugOverride(enabled: boolean | null): void {
  debugOverride = enabled;
}

/**
 * Configure daemon log file destination path.
 */
export function setDaemonLogPath(logPath: string | null): void {
  daemonLogPath = logPath;
}

/**
 * Check if security debug logging is currently active.
 */
export function isDebugEnabled(): boolean {
  if (debugOverride !== null) {
    return debugOverride;
  }
  if (process.env.ESEDRE_DEBUG === '1' || process.env.ESEDRE_DEBUG === 'true') {
    return true;
  }
  try {
    const globalCfg = readGlobalConfig();
    return globalCfg?.debug === true;
  } catch {
    return false;
  }
}

/**
 * Sanitize a string against log injection (CRLF), ANSI spoofing,
 * embedded credentials, and bearer tokens.
 */
export function sanitizeString(val: string): string {
  if (typeof val !== 'string') return '';

  let sanitized = val;

  // 1. Strip ANSI escape sequences
  sanitized = sanitized.replace(ANSI_ESCAPE_REGEX, '');

  // 2. Strip non-printable ASCII control characters
  sanitized = sanitized.replace(CONTROL_CHAR_REGEX, '');

  // 3. Strip basic auth credentials in URLs
  sanitized = sanitized.replace(BASIC_AUTH_URL_REGEX, '$1***:***@');

  // 4. Redact raw Bearer tokens
  sanitized = sanitized.replace(BEARER_TOKEN_REGEX, 'Bearer [REDACTED]');

  // 5. CRLF injection defense: escape newlines and carriage returns
  sanitized = sanitized.replace(/\r\n/g, '\\r\\n').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

  // 6. Truncate oversized strings
  if (sanitized.length > MAX_STRING_LENGTH) {
    sanitized = sanitized.slice(0, MAX_STRING_LENGTH) + '... [TRUNCATED]';
  }

  return sanitized;
}

/**
 * Recursively sanitize context objects against sensitive keys,
 * circular references, deep recursion, and log injection.
 */
export function sanitizeContext(
  val: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): unknown {
  try {
    if (val === null || val === undefined) {
      return val;
    }

    if (typeof val === 'string') {
      return sanitizeString(val);
    }

    if (typeof val === 'number' || typeof val === 'boolean') {
      return val;
    }

    if (typeof val === 'function') {
      return '[FUNCTION]';
    }

    if (typeof val === 'symbol') {
      return val.toString();
    }

    if (typeof val === 'object') {
      // Cycle detection
      if (seen.has(val)) {
        return '[CIRCULAR]';
      }
      seen.add(val);

      // Depth limit
      if (depth >= MAX_DEPTH) {
        return '[MAX_DEPTH_EXCEEDED]';
      }

      if (val instanceof Error) {
        return {
          name: sanitizeString(val.name),
          message: sanitizeString(val.message),
          stack: val.stack ? sanitizeString(val.stack) : undefined,
        };
      }

      if (val instanceof Date) {
        return val.toISOString();
      }

      if (Array.isArray(val)) {
        return val.map((item) => sanitizeContext(item, depth + 1, seen));
      }

      const sanitizedObj: Record<string, unknown> = {};
      for (const [key, propVal] of Object.entries(val)) {
        const cleanKey = sanitizeString(key);
        if (SENSITIVE_KEY_REGEX.test(key) || SENSITIVE_SUBSTRING_REGEX.test(key)) {
          sanitizedObj[cleanKey] = '[REDACTED]';
        } else {
          sanitizedObj[cleanKey] = sanitizeContext(propVal, depth + 1, seen);
        }
      }
      return sanitizedObj;
    }

    return String(val);
  } catch {
    return '[SANITIZATION_FAILED]';
  }
}

/**
 * Emit a structured, security-sanitized debug log entry.
 * Guaranteed never to throw an uncaught exception or crash the process.
 */
export function logDebug(subsystem: string, message: string, context?: unknown): void {
  try {
    if (!isDebugEnabled()) {
      return;
    }

    const timestamp = new Date().toISOString();
    const cleanSubsystem = sanitizeString(subsystem).replace(/\s+/g, '-');
    const cleanMessage = sanitizeString(message);

    let contextPart = '';
    if (context !== undefined) {
      try {
        const sanitized = sanitizeContext(context);
        contextPart = ' ' + JSON.stringify(sanitized);
      } catch {
        contextPart = ' [CONTEXT_SERIALIZATION_FAILED]';
      }
    }

    let line = `[${timestamp}] [DEBUG] [esedre:${cleanSubsystem}] ${cleanMessage}${contextPart}\n`;

    if (line.length > MAX_LINE_LENGTH) {
      line = line.slice(0, MAX_LINE_LENGTH - 20) + '... [TRUNCATED]\n';
    }

    // 1. In daemon mode with log path, write to daemon log file
    if (daemonLogPath) {
      try {
        const dir = path.dirname(daemonLogPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.appendFileSync(daemonLogPath, line, 'utf-8');
      } catch {
        // Fail-safe: ignore disk/permission write errors
      }
    }

    // 2. Write to process.stderr in CLI/worker mode
    try {
      if (process.stderr && typeof process.stderr.write === 'function') {
        process.stderr.write(line);
      }
    } catch {
      // Catch EPIPE or broken pipe silently without throwing
    }
  } catch {
    // Top-level fail-safe: logger must never abort calling processes
  }
}
