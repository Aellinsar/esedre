import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isDebugEnabled,
  setDebugOverride,
  sanitizeString,
  sanitizeContext,
  logDebug,
  setDaemonLogPath,
} from '../src/utils/logger.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Attack-Resistant Security Logger (src/utils/logger.ts)', () => {
  let tempDir: string;
  let stderrMock: ReturnType<typeof vi.spyOn>;
  let capturedStderr: string[] = [];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-logger-test-'));
    capturedStderr = [];
    stderrMock = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      capturedStderr.push(String(chunk));
      return true;
    });
    setDebugOverride(null);
    setDaemonLogPath(null);
    delete process.env.ESEDRE_DEBUG;
  });

  afterEach(() => {
    stderrMock.mockRestore();
    setDebugOverride(null);
    setDaemonLogPath(null);
    delete process.env.ESEDRE_DEBUG;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Config Discovery & Activation', () => {
    it('is disabled by default when no env var or override is set', () => {
      expect(isDebugEnabled()).toBe(false);
      logDebug('subsystem', 'This should not be logged');
      expect(capturedStderr).toHaveLength(0);
    });

    it('activates when ESEDRE_DEBUG=1 is set', () => {
      process.env.ESEDRE_DEBUG = '1';
      expect(isDebugEnabled()).toBe(true);
      logDebug('auth', 'Diagnostic active');
      expect(capturedStderr).toHaveLength(1);
      expect(capturedStderr[0]).toContain('[DEBUG] [esedre:auth] Diagnostic active');
    });

    it('honors runtime setDebugOverride', () => {
      setDebugOverride(true);
      expect(isDebugEnabled()).toBe(true);
      logDebug('network', 'Override active');
      expect(capturedStderr).toHaveLength(1);

      setDebugOverride(false);
      expect(isDebugEnabled()).toBe(false);
      logDebug('network', 'Should be silenced');
      expect(capturedStderr).toHaveLength(1);
    });
  });

  describe('Confidentiality: Secret Scrubbing', () => {
    it('recursively scrubs sensitive keys in context objects', () => {
      const payload = {
        workerId: 'thug-1',
        token: 'ghp_secretToken123456',
        mcpToken: 'mcp_super_secret',
        password: 'myPassword!',
        apiKey: 'sk-ant-api03-secret',
        authorization: 'Bearer secret_header',
        nested: {
          credential: 'my-db-pass',
          privateKey: '-----BEGIN RSA PRIVATE KEY-----',
          safeField: 'harmless value',
        },
      };

      const sanitized = sanitizeContext(payload) as any;
      expect(sanitized.workerId).toBe('thug-1');
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.mcpToken).toBe('[REDACTED]');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.apiKey).toBe('[REDACTED]');
      expect(sanitized.authorization).toBe('[REDACTED]');
      expect(sanitized.nested.credential).toBe('[REDACTED]');
      expect(sanitized.nested.privateKey).toBe('[REDACTED]');
      expect(sanitized.nested.safeField).toBe('harmless value');
    });

    it('strips basic authentication credentials embedded in URLs', () => {
      const url = 'https://admin:superSecretPass123@gateway.esedre.local:5674/mcp';
      const clean = sanitizeString(url);
      expect(clean).toBe('https://***:***@gateway.esedre.local:5674/mcp');
      expect(clean).not.toContain('superSecretPass123');
    });

    it('redacts raw Bearer token signatures in strings', () => {
      const msg = 'User provided header: Bearer abc123def456.xyz789 for authentication';
      const clean = sanitizeString(msg);
      expect(clean).toBe('User provided header: Bearer [REDACTED] for authentication');
    });
  });

  describe('Integrity: CRLF Injection & ANSI Escape Defense', () => {
    it('escapes newlines and carriage returns to maintain single atomic lines', () => {
      const maliciousInput = 'Normal message\r\n[2026-10-09T00:00:00.000Z] [DEBUG] [esedre:fake] Injected entry\nAnother line';
      const clean = sanitizeString(maliciousInput);
      expect(clean).not.toContain('\r');
      expect(clean).not.toContain('\n');
      expect(clean).toContain('\\r\\n');
      expect(clean).toContain('\\n');
    });

    it('strips ANSI color and terminal control escape codes', () => {
      const ansiInput = '\x1b[31;1mRed Alert\x1b[0m \x1b[2J\x1b[HClear Screen Exploit';
      const clean = sanitizeString(ansiInput);
      expect(clean).toBe('Red Alert Clear Screen Exploit');
      expect(clean).not.toContain('\x1b');
    });

    it('strips non-printable ASCII control characters', () => {
      const dirty = 'Hello\x00\x07World\x1F!';
      const clean = sanitizeString(dirty);
      expect(clean).toBe('HelloWorld!');
    });
  });

  describe('Resource Bounds & DoS Prevention', () => {
    it('detects circular references without throwing or locking the process', () => {
      const circularObj: any = { name: 'Root Node' };
      circularObj.self = circularObj;
      circularObj.child = { parent: circularObj };

      const sanitized = sanitizeContext(circularObj) as any;
      expect(sanitized.name).toBe('Root Node');
      expect(sanitized.self).toBe('[CIRCULAR]');
      expect(sanitized.child.parent).toBe('[CIRCULAR]');
    });

    it('enforces maximum recursion depth cap of 5 levels', () => {
      const deeplyNested: any = {
        l1: {
          l2: {
            l3: {
              l4: {
                l5: {
                  l6: {
                    value: 'too deep',
                  },
                },
              },
            },
          },
        },
      };

      const sanitized = sanitizeContext(deeplyNested) as any;
      expect(sanitized.l1.l2.l3.l4.l5).toBe('[MAX_DEPTH_EXCEEDED]');
    });

    it('truncates oversized strings exceeding 2048 characters', () => {
      const giantString = 'A'.repeat(3000);
      const clean = sanitizeString(giantString);
      expect(clean.length).toBeLessThan(3000);
      expect(clean).toContain('... [TRUNCATED]');
    });
  });

  describe('Availability & Anti-Termination Invariants', () => {
    it('handles stderr write errors (like EPIPE) gracefully without throwing', () => {
      setDebugOverride(true);
      stderrMock.mockImplementation(() => {
        const err = new Error('write EPIPE');
        (err as any).code = 'EPIPE';
        throw err;
      });

      // Must not throw
      expect(() => {
        logDebug('pipe-test', 'Testing broken pipe error');
      }).not.toThrow();
    });

    it('writes to daemon log file safely when configured', () => {
      setDebugOverride(true);
      const logFile = path.join(tempDir, 'daemon.log');
      setDaemonLogPath(logFile);

      logDebug('daemon-subsystem', 'Daemon started successfully', { port: 5674 });
      expect(fs.existsSync(logFile)).toBe(true);

      const content = fs.readFileSync(logFile, 'utf-8');
      expect(content).toContain('[DEBUG] [esedre:daemon-subsystem] Daemon started successfully {"port":5674}');
    });

    it('handles daemon log file write errors (like read-only directory) safely without throwing', () => {
      setDebugOverride(true);
      // Point to an invalid directory
      setDaemonLogPath('/invalid/directory/path/that/does/not/exist/daemon.log');

      expect(() => {
        logDebug('daemon-fail', 'Testing disk failure');
      }).not.toThrow();
    });
  });
});
