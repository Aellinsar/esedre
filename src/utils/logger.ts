import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  subsystem: string;
  message: string;
  context?: Record<string, unknown>;
}

const MAX_RING_BUFFER = 200;
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024; // 5 MB rotation threshold
const ringBuffer: LogEntry[] = [];
let debugEnabled = Boolean(process.env.ESEDRE_DEBUG);
let logFileOverride: string | undefined;

export function initLogger(options?: { debug?: boolean; logFile?: string }): void {
  if (options?.debug !== undefined) {
    debugEnabled = options.debug;
  } else if (process.env.ESEDRE_DEBUG) {
    debugEnabled = true;
  }
  if (options?.logFile) {
    logFileOverride = options.logFile;
  }
}

export function isDebugEnabled(): boolean {
  return debugEnabled || Boolean(process.env.ESEDRE_DEBUG);
}

export function getDefaultLogFilePath(): string {
  if (logFileOverride) return logFileOverride;
  return path.join(os.homedir(), '.esedre', 'logs', 'esedre-debug.log');
}

function rotateIfNeeded(logPath: string): void {
  try {
    if (!fs.existsSync(logPath)) return;
    const stat = fs.statSync(logPath);
    if (stat.size >= MAX_LOG_FILE_BYTES) {
      const rotated = `${logPath}.1`;
      try {
        if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
      } catch {}
      fs.renameSync(logPath, rotated);
    }
  } catch {}
}

export function writeLog(
  level: LogLevel,
  subsystem: string,
  message: string,
  context?: Record<string, unknown>
): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    subsystem,
    message,
    ...(context ? { context } : {}),
  };

  ringBuffer.push(entry);
  if (ringBuffer.length > MAX_RING_BUFFER) {
    ringBuffer.shift();
  }

  if (level === 'debug' && !isDebugEnabled()) {
    return;
  }

  if (isDebugEnabled() || level === 'warn' || level === 'error') {
    try {
      const logPath = getDefaultLogFilePath();
      const dir = path.dirname(logPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      rotateIfNeeded(logPath);
      fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {}
  }
}

export function logDebug(subsystem: string, message: string, context?: Record<string, unknown>): void {
  writeLog('debug', subsystem, message, context);
}

export function logInfo(subsystem: string, message: string, context?: Record<string, unknown>): void {
  writeLog('info', subsystem, message, context);
}

export function logWarn(subsystem: string, message: string, context?: Record<string, unknown>): void {
  writeLog('warn', subsystem, message, context);
}

export function logError(subsystem: string, message: string, context?: Record<string, unknown>): void {
  writeLog('error', subsystem, message, context);
}

export function getLogBuffer(): LogEntry[] {
  return [...ringBuffer];
}

export function clearLogBuffer(): void {
  ringBuffer.length = 0;
}
