import fs from 'node:fs';
import path from 'node:path';
import { resolveStoreDir } from '../server/daemon.js';

/**
 * Run record for a detached (--bg) worker. Written by `ese crew dispatch --bg` so that a dead
 * worker can be detected later (PID gone while its lease is still held) and so every worker has
 * a log file whose path is printed at dispatch time.
 */
export interface WorkerRunRecord {
  pid: number;
  workerId: string;
  role: string;
  mode: 'implement' | 'plan';
  ticketId: number | string;
  ticketKey: string;
  system: string;
  startedAt: string;
  logFile: string;
}

function sanitize(part: string | number): string {
  return String(part).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export function getWorkerLogPath(workerId: string, ticketKey: string, workspaceRoot?: string): string {
  const store = resolveStoreDir(workspaceRoot);
  return path.join(store, 'logs', `worker-${sanitize(workerId)}-${sanitize(ticketKey)}.log`);
}

function getWorkerRunDir(workspaceRoot?: string): string {
  const dir = path.join(resolveStoreDir(workspaceRoot), 'run');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getWorkerRunFile(workerId: string, ticketKey: string, workspaceRoot?: string): string {
  return path.join(getWorkerRunDir(workspaceRoot), `worker-${sanitize(workerId)}-${sanitize(ticketKey)}.json`);
}

export function writeWorkerRun(record: WorkerRunRecord, workspaceRoot?: string): void {
  try {
    fs.writeFileSync(
      getWorkerRunFile(record.workerId, record.ticketKey, workspaceRoot),
      JSON.stringify(record, null, 2) + '\n',
      'utf-8'
    );
  } catch {
    // run records are best-effort diagnostics; never block dispatch
  }
}

export function readWorkerRuns(workspaceRoot?: string): WorkerRunRecord[] {
  const out: WorkerRunRecord[] = [];
  try {
    const dir = getWorkerRunDir(workspaceRoot);
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.startsWith('worker-') || !entry.endsWith('.json')) continue;
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf-8')) as WorkerRunRecord;
        if (rec && typeof rec.pid === 'number') out.push(rec);
      } catch {
        // skip corrupt record
      }
    }
  } catch {
    // no run dir yet
  }
  return out;
}

export function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM means the process exists but belongs to another user
    return err && err.code === 'EPERM';
  }
}

/** Returns the last `maxLines` lines (bounded to the last `maxBytes`) of a file, or '' if unreadable. */
export function tailFile(filePath: string, maxLines = 15, maxBytes = 8192): string {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const lines = buf.toString('utf-8').split(/\r?\n/).filter((l) => l.length > 0);
      return lines.slice(-maxLines).join('\n');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

/**
 * Maps `<project>-<ticketId>` (lowercase) to a stale-worker reason for every run record whose
 * process is gone. Callers decide whether a matching lease is still held.
 */
export function findDeadWorkers(workspaceRoot?: string): Map<string, WorkerRunRecord> {
  const dead = new Map<string, WorkerRunRecord>();
  for (const rec of readWorkerRuns(workspaceRoot)) {
    if (!isPidAlive(rec.pid)) {
      dead.set(rec.ticketKey.toLowerCase(), rec);
    }
  }
  return dead;
}
