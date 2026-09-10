import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureGlobalEsedreStore,
  getDaemonStateFile,
  getDaemonState,
  isProcessAlive,
  pingDaemon,
  startDaemon,
  stopDaemon,
  getDaemonStatus,
} from '../src/server/daemon.js';
import { CURRENT_ESEDRE_VERSION } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');

describe('Esedre Daemon & Global Runtime Store', () => {
  const TEST_PORT = 5890;

  afterAll(async () => {
    try {
      await stopDaemon({ port: TEST_PORT, quiet: true, workspaceRoot });
    } catch {}
  });

  it('ensureGlobalEsedreStore creates directory, verifies write probe, and removes probe file', () => {
    const store = ensureGlobalEsedreStore();
    expect(store.path).toBeTruthy();
    expect(fs.existsSync(store.path)).toBe(true);
    expect(store.ok).toBe(true);

    // Verify no leftover .probe-* files
    const files = fs.readdirSync(store.path);
    const probeFiles = files.filter((f) => f.startsWith('.probe-'));
    expect(probeFiles.length).toBe(0);
  });

  it('isProcessAlive correctly identifies current process and dead process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(9999999)).toBe(false);
  });

  it('getDaemonState handles corrupted state files gracefully by self-healing', () => {
    const stateFile = getDaemonStateFile(TEST_PORT, workspaceRoot);
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, '<<< INVALID NOT JSON >>>', 'utf-8');

    expect(fs.existsSync(stateFile)).toBe(true);
    const state = getDaemonState(TEST_PORT, workspaceRoot);
    expect(state).toBeNull();
    // Corrupted state file should be unlinked automatically
    expect(fs.existsSync(stateFile)).toBe(false);
  });

  it('pingDaemon returns not responding for inactive port', async () => {
    const ping = await pingDaemon(TEST_PORT, 150);
    expect(ping.responding).toBe(false);
    expect(ping.isEsedre).toBe(false);
  });

  it('starts background daemon, provides status, handles duplicate start idempotently, and stops cleanly', async () => {
    // 1. Start daemon
    const state = await startDaemon({ port: TEST_PORT, quiet: true, workspaceRoot });
    expect(state.pid).toBeGreaterThan(0);
    expect(state.port).toBe(TEST_PORT);

    // 2. Query status
    const status = await getDaemonStatus({ port: TEST_PORT, workspaceRoot });
    expect(status.running).toBe(true);
    expect(status.pid).toBe(state.pid);
    expect(status.port).toBe(TEST_PORT);

    // 3. Duplicate start is completely idempotent
    const state2 = await startDaemon({ port: TEST_PORT, quiet: true, workspaceRoot });
    expect(state2.pid).toBe(state.pid);

    // 4. Ping directly
    const ping = await pingDaemon(TEST_PORT, 400);
    expect(ping.responding).toBe(true);
    expect(ping.isEsedre).toBe(true);

    // 5. Stop daemon
    const stopped = await stopDaemon({ port: TEST_PORT, quiet: true, workspaceRoot });
    expect(stopped).toBe(true);

    // 6. Verify status is stopped
    const statusAfter = await getDaemonStatus({ port: TEST_PORT, workspaceRoot });
    expect(statusAfter.running).toBe(false);

    // 7. Duplicate stop returns false gracefully
    const stoppedAgain = await stopDaemon({ port: TEST_PORT, quiet: true, workspaceRoot });
    expect(stoppedAgain).toBe(false);
  }, 15000);

  it('correctly detects stale daemon version when running daemon version does not match installed version', async () => {
    const stateFile = getDaemonStateFile(TEST_PORT, workspaceRoot);
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        pid: process.pid,
        port: TEST_PORT,
        startedAt: new Date().toISOString(),
        version: '0.1.0',
        workspaceRoot,
        logFile: 'dummy.log',
      }),
      'utf-8'
    );

    const status = await getDaemonStatus({ port: TEST_PORT, workspaceRoot });
    expect(status.version).toBe('0.1.0');
    expect(status.staleVersion).toBe(true);
    expect(status.installedVersion).toBe(CURRENT_ESEDRE_VERSION);

    if (fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile);
    }
  });
});
