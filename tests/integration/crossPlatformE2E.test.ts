import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initWorkspace } from '../../src/upgrade.js';
import { ensureAntigravityPreToolHookScript } from '../../src/mcp/antigravityHook.js';
import { FilesystemStorageAdapter } from '../../src/storage/filesystem.js';
import { getDaemonStateFile, stopDaemon, pingDaemon } from '../../src/server/daemon.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const cliScript = path.join(repoRoot, 'dist', 'esedre.mjs');

async function getFreePortBlock(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const basePort = typeof addr === 'object' && addr ? addr.port : 15674;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(basePort);
      });
    });
    srv.on('error', reject);
  });
}

function httpGetJson(url: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode || 0, body: raw });
          }
        });
      })
      .on('error', reject);
  });
}

describe('Tier 2: Cross-Platform Black-Box Subprocess, MCP Pipe & Daemon E2E (Esedre-100)', () => {
  let tempRoot: string;
  let customGlobalDir: string;
  let originalGlobalEnv: string | undefined;
  let originalBundleEnv: string | undefined;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-xplat-e2e-'));
    customGlobalDir = path.join(tempRoot, 'global-esedre');
    fs.mkdirSync(customGlobalDir, { recursive: true });
    originalGlobalEnv = process.env.ESEDRE_GLOBAL_DIR;
    originalBundleEnv = process.env.ESEDRE_BUNDLE_PATH;
    process.env.ESEDRE_GLOBAL_DIR = customGlobalDir;
    process.env.ESEDRE_BUNDLE_PATH = cliScript;
  });

  afterEach(() => {
    if (originalGlobalEnv !== undefined) {
      process.env.ESEDRE_GLOBAL_DIR = originalGlobalEnv;
    } else {
      delete process.env.ESEDRE_GLOBAL_DIR;
    }
    if (originalBundleEnv !== undefined) {
      process.env.ESEDRE_BUNDLE_PATH = originalBundleEnv;
    } else {
      delete process.env.ESEDRE_BUNDLE_PATH;
    }
    if (fs.existsSync(tempRoot)) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {}
    }
  });

  describe('1. Multi-Shell Wrapper & Tracked .agents/mcp.json Subprocess Execution', () => {
    it('executes platform-native wrappers and cross-platform .esedre/ese.mjs launcher', () => {
      const wsDir = path.join(tempRoot, 'wrapper-exec-ws');
      fs.mkdirSync(wsDir, { recursive: true });
      initWorkspace(wsDir, { projectCode: 'WRAP' });

      // 1. Universal Node launcher (.esedre/ese.mjs) must work on every OS
      const mjsPath = path.join(wsDir, '.esedre', 'ese.mjs');
      expect(fs.existsSync(mjsPath)).toBe(true);
      const mjsOut = execFileSync(process.execPath, [mjsPath, '--version'], {
        cwd: wsDir,
        encoding: 'utf-8',
        env: { ...process.env, ESEDRE_GLOBAL_DIR: customGlobalDir },
      }).trim();
      expect(mjsOut).toContain('esedre v');

      if (process.platform === 'win32') {
        // 2a. Windows CMD wrapper (.esedre/ese.cmd)
        const cmdPath = path.join(wsDir, '.esedre', 'ese.cmd');
        const cmdOut = execFileSync('cmd.exe', ['/c', cmdPath, '--version'], {
          cwd: wsDir,
          encoding: 'utf-8',
          windowsHide: true,
          env: { ...process.env, ESEDRE_GLOBAL_DIR: customGlobalDir },
        }).trim();
        expect(cmdOut).toContain('esedre v');

        // 2b. Windows PowerShell wrapper (.esedre/ese.ps1)
        const ps1Path = path.join(wsDir, '.esedre', 'ese.ps1');
        const ps1Out = execFileSync(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path, '--version'],
          {
            cwd: wsDir,
            encoding: 'utf-8',
            windowsHide: true,
            env: { ...process.env, ESEDRE_GLOBAL_DIR: customGlobalDir },
          }
        ).trim();
        expect(ps1Out).toContain('esedre v');
      } else {
        // 2c. POSIX direct kernel shebang execution (./.esedre/ese and repo ./.esedre/ese)
        const posixWrapper = path.join(wsDir, '.esedre', 'ese');
        const posixOut = execFileSync(posixWrapper, ['--version'], {
          cwd: wsDir,
          encoding: 'utf-8',
          env: { ...process.env, ESEDRE_GLOBAL_DIR: customGlobalDir },
        }).trim();
        expect(posixOut).toContain('esedre v');

        const repoPosixWrapper = path.join(repoRoot, '.esedre', 'ese');
        const repoPosixOut = execFileSync(repoPosixWrapper, ['--version'], {
          cwd: repoRoot,
          encoding: 'utf-8',
          env: { ...process.env, ESEDRE_GLOBAL_DIR: customGlobalDir },
        }).trim();
        expect(repoPosixOut).toContain('esedre v');
      }
    });

    it('spawns the repository tracked .agents/mcp.json server command on the current OS and completes MCP initialize', async () => {
      const repoMcpJsonPath = path.join(repoRoot, '.agents', 'mcp.json');
      const repoMcpJson = JSON.parse(fs.readFileSync(repoMcpJsonPath, 'utf-8'));
      const serverCfg = repoMcpJson.mcpServers?.esedre;
      expect(serverCfg).toBeDefined();

      const responseLine = await new Promise<string>((resolve, reject) => {
        const child = spawn(serverCfg.command, serverCfg.args || [], {
          cwd: repoRoot,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, ESEDRE_GLOBAL_DIR: customGlobalDir },
        });

        let stdoutBuf = '';
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`Timed out waiting for MCP initialize response. Stdout: ${stdoutBuf}`));
        }, 8000);

        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });

        child.stdout.on('data', (chunk) => {
          stdoutBuf += chunk.toString('utf-8');
          const newlineIdx = stdoutBuf.indexOf('\n');
          if (newlineIdx !== -1) {
            clearTimeout(timer);
            const firstLine = stdoutBuf.slice(0, newlineIdx).trim();
            child.kill();
            resolve(firstLine);
          }
        });

        const initReq = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'xplat-e2e', version: '1.0.0' },
          },
        });
        child.stdin.write(initReq + '\n');
      });

      const parsed = JSON.parse(responseLine);
      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(1);
      expect(parsed.result?.serverInfo?.name).toBe('esedre');
    });
  });

  describe('2. Full Black-Box CLI Lifecycle & Chunked Pipe Hook Execution', { timeout: 60000 }, () => {
    it('executes full CLI workflow (init hub/workspace, create, link, lease, plan, comment, release, snapshot)', () => {
      const hubDir = path.join(tempRoot, 'e2e-hub');
      const wsDir = path.join(tempRoot, 'e2e-ws');
      fs.mkdirSync(hubDir, { recursive: true });
      fs.mkdirSync(wsDir, { recursive: true });

      const run = (args: string[], cwd = wsDir) =>
        execFileSync(process.execPath, [cliScript, ...args], {
          cwd,
          encoding: 'utf-8',
          env: { ...process.env, ESEDRE_GLOBAL_DIR: customGlobalDir },
        }).trim();

      run(['init', hubDir, '--hub'], tempRoot);
      run(['init', '--project', 'E2E', '--name', 'E2E Verification', '--hub', hubDir], tempRoot);
      run(['init', wsDir, '--project', 'E2E'], tempRoot);

      const created1 = JSON.parse(
        run([
          'create',
          '--title',
          'Blocker E2E Ticket',
          '--type',
          'Platform',
          '--priority',
          'Critical',
          '--summary',
          'Blocker ticket summary',
          '--json',
        ])
      );
      expect(created1.meta.id).toBe(1);

      const created2 = JSON.parse(
        run([
          'create',
          '--title',
          'Dependent E2E Ticket',
          '--type',
          'Feature',
          '--priority',
          'High',
          '--json',
        ])
      );
      expect(created2.meta.id).toBe(2);

      run(['link', 'E2E-1', 'E2E-2', '--relation', 'blocks', '--json']);

      const blockedCheck = JSON.parse(run(['get', 'E2E-2', '--json']));
      expect(blockedCheck.isBlocked).toBe(true);

      run(['lease', 'claim', 'E2E-1', '--holder', 'e2e-runner', '--ttl', '30', '--json']);
      run(['plan', 'E2E-1', '--set', '# E2E Plan\n\n- Step A\n- Step B']);
      run(['comment', 'E2E-1', '--author', 'e2e-runner', '--text', 'Completed verification']);
      run(['lease', 'release', 'E2E-1', '--holder', 'e2e-runner', '--status', 'Completed', '--json']);

      const unblockedCheck = JSON.parse(run(['get', 'E2E-2', '--json']));
      expect(unblockedCheck.isBlocked).toBe(false);

      run(['snapshot']);
      const snapshotPath = path.join(wsDir, '.esedre', 'snapshot.json');
      expect(fs.existsSync(snapshotPath)).toBe(true);
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      expect(snapshot.tickets).toHaveLength(2);
      expect(snapshot.tickets[0].status).toBe('Completed');
    });

    it('normalizes CRLF/CR, unescapes shell-literal \\n / \\r\\n without corrupting Windows paths, and handles --file / --plan-file with spaces and mixed separators', () => {
      const hubDir = path.join(tempRoot, 'newline-hub');
      const wsDir = path.join(tempRoot, 'newline-ws');
      const specsDir = path.join(wsDir, 'specs with spaces');
      fs.mkdirSync(hubDir, { recursive: true });
      fs.mkdirSync(specsDir, { recursive: true });

      const run = (args: string[], cwd = wsDir) =>
        execFileSync(process.execPath, [cliScript, ...args], {
          cwd,
          encoding: 'utf-8',
          env: { ...process.env, ESEDRE_GLOBAL_DIR: customGlobalDir },
        }).trim();

      run(['init', hubDir, '--hub'], tempRoot);
      run(['init', '--project', 'NL', '--name', 'Newline & Path Project', '--hub', hubDir], tempRoot);
      run(['init', wsDir, '--project', 'NL'], tempRoot);

      // Write CRLF markdown files inside a directory with spaces
      const crlfDetail = [
        '# Ticket #1: File & Newline Ticket',
        '**Type**: Feature  ',
        '**Priority**: High  ',
        '**Complexity**: Medium  ',
        '**Estimated Effort**: 2.0 - 4.0 hours  ',
        '',
        '### Summary',
        'Loaded from CRLF file in folder with spaces.',
        '',
        '### Feature Breakdown',
        '- Support mixed slash --file paths',
        '- Normalize CRLF to LF on disk',
        '',
        '### Technical Details',
        '- Preserve Windows paths like C:\\new_folder\\notes\\index.ts',
      ].join('\r\n');

      const crlfPlan = ['# CRLF Plan', '', '1. Step One', '2. Step Two'].join('\r\n');
      const crlfComment = ['Comment line 1 from CRLF file', 'Comment line 2 from CRLF file'].join('\r\n');

      fs.writeFileSync(path.join(specsDir, 'detail-spec.md'), crlfDetail + '\r\n', 'utf-8');
      fs.writeFileSync(path.join(specsDir, 'plan-spec.md'), crlfPlan + '\r\n', 'utf-8');
      fs.writeFileSync(path.join(specsDir, 'comment-note.md'), crlfComment + '\r\n', 'utf-8');

      // Pass Windows backslash separator in --file and forward slash in --plan-file (works on both Windows & Linux)
      const created = JSON.parse(
        run([
          'create',
          '--title',
          'File & Newline Ticket',
          '--file',
          'specs with spaces\\detail-spec.md',
          '--plan-file',
          'specs with spaces/plan-spec.md',
          '--json',
        ])
      );
      expect(created.meta.id).toBe(1);
      expect(created.detail.summary).toBe('Loaded from CRLF file in folder with spaces.');
      expect(created.detail.breakdown).toEqual([
        'Support mixed slash --file paths',
        'Normalize CRLF to LF on disk',
      ]);

      // Verify on-disk files in hub were written strictly with LF (zero CR)
      const onDiskDetail = fs.readFileSync(
        path.join(hubDir, 'projects', 'NL', 'tickets', '1', 'detail.md'),
        'utf-8'
      );
      const onDiskPlan = fs.readFileSync(
        path.join(hubDir, 'projects', 'NL', 'tickets', '1', 'implementation_plan.md'),
        'utf-8'
      );
      expect(onDiskDetail).not.toContain('\r');
      expect(onDiskPlan).not.toContain('\r');

      // Test shell-literal \n and \r\n in --summary and --detail while preserving Windows C:\new_folder\notes path
      const updated = JSON.parse(
        run([
          'update',
          'NL-1',
          '--detail',
          '### Summary\\r\\nUpdated via literal escaped newlines.\\n\\n### Technical Details\\n- Inspect C:\\new_folder\\notes\\app.ts\\n- Verify /tmp/linux/path.ts',
          '--last-hash',
          created.sha1,
          '--json',
        ])
      );
      expect(updated.detail.summary).toBe('Updated via literal escaped newlines.');
      expect(updated.detail.technicalDetails).toEqual([
        'Inspect C:\\new_folder\\notes\\app.ts',
        'Verify /tmp/linux/path.ts',
      ]);

      // Test shell-literal \n in `ese plan --set` with OCC --last-hash
      const planSaved = JSON.parse(
        run([
          'plan',
          'NL-1',
          '--set',
          '# Escaped Plan\\n\\n1. First line\\n2. Second line',
          '--last-hash',
          updated.sha1,
          '--json',
        ])
      );
      expect(planSaved.planMarkdown).toBe('# Escaped Plan\n\n1. First line\n2. Second line');

      // Test `ese comment` with both --file (mixed separator + CRLF) and --text (literal \n)
      const cmtFromFile = JSON.parse(
        run(['comment', 'NL-1', '--file', 'specs with spaces\\comment-note.md', '--json'])
      );
      expect(cmtFromFile.text).toBe('Comment line 1 from CRLF file\nComment line 2 from CRLF file');

      const cmtFromInline = JSON.parse(
        run(['comment', 'NL-1', '--text', 'First inline line.\\nSecond inline line.', '--json'])
      );
      expect(cmtFromInline.text).toBe('First inline line.\nSecond inline line.');

      const rawCommentsJson = fs.readFileSync(
        path.join(hubDir, 'projects', 'NL', 'tickets', '1', 'comments.json'),
        'utf-8'
      );
      expect(rawCommentsJson).not.toContain('\\r');
    });

    it('executes configure, upgrade, projects, project set, rename-project, milestones, list filters, unlink, top-level lease aliases, and allow-list exit codes', () => {
      const hubDir = path.join(tempRoot, 'full-cli-hub');
      const wsDir = path.join(tempRoot, 'full-cli-ws');
      fs.mkdirSync(hubDir, { recursive: true });
      fs.mkdirSync(wsDir, { recursive: true });

      const run = (args: string[], cwd = wsDir) =>
        execFileSync(process.execPath, [cliScript, ...args], {
          cwd,
          encoding: 'utf-8',
          env: { ...process.env, ESEDRE_GLOBAL_DIR: customGlobalDir },
        }).trim();

      run(['init', hubDir, '--hub'], tempRoot);
      run(['init', '--project', 'ALPHA', '--name', 'Alpha Project', '--hub', hubDir], tempRoot);
      run(['init', '--project', 'SECRET', '--name', 'Secret Project', '--hub', hubDir], tempRoot);
      run(['init', wsDir, '--project', 'ALPHA'], tempRoot);

      // 1. configure subcommands
      const cfgHub = JSON.parse(run(['configure', 'add', hubDir, '--json']));
      expect(cfgHub.type).toBe('hub');
      const cfgProj = JSON.parse(run(['configure', 'add', wsDir, '--json']));
      expect(cfgProj.type).toBe('project');
      run(['configure', 'set', 'port', '5688']);
      const cfgView = JSON.parse(run(['configure', '--json']));
      expect(cfgView.config.port).toBe(5688);

      // 2. milestone create / list / get / update + ticket inheritedFeatureFlag
      const msCreated = JSON.parse(
        run([
          'milestone',
          'create',
          '--title',
          'v1.0 Cross-OS',
          '--status',
          'Active',
          '--flag',
          'FF_XPLAT_V1',
          '--target-date',
          '2026-12-31',
          '--desc',
          'Cross-platform milestone',
          '--json',
        ])
      );
      expect(msCreated.title).toBe('v1.0 Cross-OS');
      expect(msCreated.featureFlag).toBe('FF_XPLAT_V1');

      const t1 = JSON.parse(
        run([
          'create',
          '--title',
          'Milestone Ticket 1',
          '--type',
          'Feature',
          '--priority',
          'High',
          '--milestone',
          'v1.0 Cross-OS',
          '--json',
        ])
      );
      expect(t1.meta.inheritedFeatureFlag).toBe('FF_XPLAT_V1');

      const t2 = JSON.parse(
        run(['create', '--title', 'Secondary Ticket 2', '--type', 'Bug', '--priority', 'Low', '--json'])
      );

      const msList = JSON.parse(run(['milestone', 'list', '--json']));
      expect(msList).toHaveLength(1);
      const msGet = JSON.parse(run(['milestone', 'get', String(msCreated.id), '--json']));
      expect(msGet.tickets).toHaveLength(1);
      const msUpd = JSON.parse(
        run(['milestone', 'update', String(msCreated.id), '--status', 'Completed', '--json'])
      );
      expect(msUpd.status).toBe('Completed');

      // 3. link + unlink + list filters + top-level lease aliases (claim, renew, leases, release)
      run(['link', 'ALPHA-1', 'blocks', 'ALPHA-2', '--json']);
      expect(JSON.parse(run(['get', 'ALPHA-2', '--json'])).isBlocked).toBe(true);
      run(['unlink', 'ALPHA-1', 'ALPHA-2', '--json']);
      expect(JSON.parse(run(['get', 'ALPHA-2', '--json'])).isBlocked).toBe(false);

      const filteredList = JSON.parse(
        run(['list', '--type', 'Bug', '--priority', 'Low', '--search', 'Secondary', '--json'])
      );
      expect(filteredList).toHaveLength(1);
      expect(filteredList[0].id).toBe(t2.meta.id);

      const tableOut = run(['list']);
      expect(tableOut).toContain('Milestone Ticket 1');

      const claimed = JSON.parse(run(['claim', 'ALPHA-1', '--holder', 'cli-agent', '--ttl', '20', '--json']));
      expect(claimed.lease.holder).toBe('cli-agent');
      const renewed = JSON.parse(run(['renew', 'ALPHA-1', '--holder', 'cli-agent', '--ttl', '45', '--json']));
      expect(renewed.lease.ttlMinutes).toBe(45);
      const activeLeases = JSON.parse(run(['leases', '--json']));
      expect(activeLeases.total).toBeGreaterThanOrEqual(1);
      const released = JSON.parse(
        run(['release', 'ALPHA-1', '--holder', 'cli-agent', '--status', 'Completed', '--json'])
      );
      expect(released.released).toBe(true);

      // 4. project set, projects, rename-project, upgrade
      const projUpdated = JSON.parse(
        run(['project', 'set', 'ALPHA', '--name', 'Alpha Renamed', '--description', 'New desc', '--json'])
      );
      expect(projUpdated.name).toBe('Alpha Renamed');
      const allProjs = JSON.parse(run(['projects', '--json']));
      expect(allProjs.some((p: any) => p.code === 'ALPHA')).toBe(true);

      const renamed = JSON.parse(
        run(['rename-project', 'ALPHA', 'BETA', '--name', 'Beta Project', '--json'])
      );
      expect(renamed.newCode).toBe('BETA');
      const betaTicket = JSON.parse(run(['get', 'BETA-1', '--json']));
      expect(betaTicket.meta.id).toBe(1);

      const upgRes = JSON.parse(run(['upgrade', wsDir, '--json']));
      expect(upgRes.upgrade.wrappersPlanted).toBe(true);

      // 5. Agent Project Allow-List (allowedProjects) CLI exit code enforcement
      execFileSync(
        process.execPath,
        [cliScript, 'create', '--project', 'SECRET', '--title', 'Classified Ticket', '--json'],
        {
          cwd: hubDir,
          encoding: 'utf-8',
          env: { ...process.env, ESEDRE_GLOBAL_DIR: customGlobalDir },
        }
      );

      let unauthorizedThrew = false;
      try {
        run(['get', 'SECRET-1', '--json']);
      } catch (err: any) {
        unauthorizedThrew = true;
        expect(err.status).toBe(1);
      }
      expect(unauthorizedThrew).toBe(true);
    });

    it('executes multi-turn MCP stdio session (tools/list, create, update with OCC, save_plan, add_comment with file, claim/release, and allow-list -32603 error)', async () => {
      const hubDir = path.join(tempRoot, 'mcp-full-hub');
      const wsDir = path.join(tempRoot, 'mcp-full-ws');
      fs.mkdirSync(hubDir, { recursive: true });
      fs.mkdirSync(wsDir, { recursive: true });

      const run = (args: string[], cwd = wsDir) =>
        execFileSync(process.execPath, [cliScript, ...args], {
          cwd,
          encoding: 'utf-8',
          env: { ...process.env, ESEDRE_GLOBAL_DIR: customGlobalDir },
        }).trim();

      run(['init', hubDir, '--hub'], tempRoot);
      run(['init', '--project', 'MCPX', '--name', 'MCP E2E Project', '--hub', hubDir], tempRoot);
      run(['init', '--project', 'FORBID', '--name', 'Forbidden Project', '--hub', hubDir], tempRoot);
      run(['init', wsDir, '--project', 'MCPX'], tempRoot);
      run(['create', '--project', 'FORBID', '--title', 'Secret Forbidden Ticket', '--json'], hubDir);

      // Write a CRLF comment file in a subdirectory of wsDir
      const notesDir = path.join(wsDir, 'notes dir');
      fs.mkdirSync(notesDir, { recursive: true });
      fs.writeFileSync(path.join(notesDir, 'mcp-note.md'), 'MCP file line 1\r\nMCP file line 2\r\n', 'utf-8');

      const mcpCfg = JSON.parse(fs.readFileSync(path.join(wsDir, '.agents', 'mcp.json'), 'utf-8'));
      const serverEntry = mcpCfg.mcpServers.esedre;

      const child = spawn(serverEntry.command, serverEntry.args, {
        cwd: wsDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ESEDRE_GLOBAL_DIR: customGlobalDir },
      });

      const pending = new Map<number, (msg: any) => void>();
      let stdoutBuf = '';
      child.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString('utf-8');
        let idx: number;
        while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
          const line = stdoutBuf.slice(0, idx).trim();
          stdoutBuf = stdoutBuf.slice(idx + 1);
          if (!line) continue;
          try {
            const parsed = JSON.parse(line);
            if (typeof parsed.id === 'number' && pending.has(parsed.id)) {
              const resolver = pending.get(parsed.id)!;
              pending.delete(parsed.id);
              resolver(parsed);
            }
          } catch {}
        }
      });

      const sendRpc = (id: number, method: string, params: any = {}): Promise<any> =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`MCP RPC timeout for id=${id} method=${method}`));
          }, 8000);
          pending.set(id, (res) => {
            clearTimeout(timer);
            resolve(res);
          });
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        });

      try {
        const initRes = await sendRpc(1, 'initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'mcp-e2e', version: '1.0.0' },
        });
        expect(initRes.result?.serverInfo?.name).toBe('esedre');

        const listToolsRes = await sendRpc(2, 'tools/list');
        const toolNames = (listToolsRes.result?.tools || []).map((t: any) => t.name);
        expect(toolNames).toContain('esedre_create_ticket');
        expect(toolNames).toContain('esedre_update_ticket');
        expect(toolNames).toContain('esedre_claim_ticket');

        const createRes = await sendRpc(3, 'tools/call', {
          name: 'esedre_create_ticket',
          arguments: {
            project: 'MCPX',
            title: 'Created over MCP Pipe',
            type: 'Feature',
            priority: 'High',
            summary: 'MCP summary line',
          },
        });
        const createdTicket = JSON.parse(createRes.result.content[0].text);
        expect(createdTicket.meta.id).toBe(1);

        const updateRes = await sendRpc(4, 'tools/call', {
          name: 'esedre_update_ticket',
          arguments: {
            ticketId: 'MCPX-1',
            status: 'In Development',
            summary: 'Updated over MCP with OCC',
            lastHash: createdTicket.sha1,
          },
        });
        const updatedTicket = JSON.parse(updateRes.result.content[0].text);
        expect(updatedTicket.meta.status).toBe('In Development');
        expect(updatedTicket.detail.summary).toBe('Updated over MCP with OCC');

        const planRes = await sendRpc(5, 'tools/call', {
          name: 'esedre_save_plan',
          arguments: {
            ticketId: 'MCPX-1',
            planMarkdown: '# MCP Plan\r\n\r\n- Step 1\r\n- Step 2',
            lastHash: updatedTicket.sha1,
          },
        });
        const planResultObj = JSON.parse(planRes.result.content[0].text);
        expect(planResultObj.success).toBe(true);

        const commentRes = await sendRpc(6, 'tools/call', {
          name: 'esedre_add_comment',
          arguments: {
            ticketId: 'MCPX-1',
            file: 'notes dir\\mcp-note.md',
            author: 'mcp-agent',
          },
        });
        const commentObj = JSON.parse(commentRes.result.content[0].text);
        expect(commentObj.text).toBe('MCP file line 1\nMCP file line 2');

        const claimRes = await sendRpc(7, 'tools/call', {
          name: 'esedre_claim_ticket',
          arguments: {
            ticketId: 'MCPX-1',
            holder: 'mcp-agent',
            ttlMinutes: 15,
          },
        });
        expect(JSON.parse(claimRes.result.content[0].text).success).toBe(true);

        const releaseRes = await sendRpc(8, 'tools/call', {
          name: 'esedre_release_ticket',
          arguments: {
            ticketId: 'MCPX-1',
            holder: 'mcp-agent',
            finalStatus: 'Completed',
          },
        });
        expect(JSON.parse(releaseRes.result.content[0].text).released).toBe(true);

        // Unauthorized cross-project tool call must return JSON-RPC error -32603
        const forbidRes = await sendRpc(9, 'tools/call', {
          name: 'esedre_get_ticket',
          arguments: {
            ticketId: 'FORBID-1',
          },
        });
        expect(forbidRes.error).toBeDefined();
        expect(forbidRes.error.code).toBe(-32603);
      } finally {
        child.kill();
      }
    });

    it('reads fragmented/delayed stdin chunks in agy-pre-tool-hook.mjs without EAGAIN or premature EOF', async () => {
      const wsDir = path.join(tempRoot, 'hook-pipe-ws');
      fs.mkdirSync(wsDir, { recursive: true });
      initWorkspace(wsDir, { projectCode: 'HOOKP', allowedProjects: ['HOOKP'] });
      const hookScriptPath = ensureAntigravityPreToolHookScript();

      const payloadStr = JSON.stringify({
        tool_name: 'mcp_esedre_esedre_list_tickets',
        tool_input: { project: 'HOOKP' },
        workspace_roots: [wsDir],
      });

      const midpoint = Math.floor(payloadStr.length / 2);
      const chunk1 = payloadStr.slice(0, midpoint);
      const chunk2 = payloadStr.slice(midpoint);

      const hookOutput = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
        (resolve, reject) => {
          const child = spawn(process.execPath, [hookScriptPath], {
            cwd: customGlobalDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ESEDRE_GLOBAL_DIR: customGlobalDir },
          });

          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (d) => (stdout += d.toString('utf-8')));
          child.stderr.on('data', (d) => (stderr += d.toString('utf-8')));
          child.on('error', reject);
          child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));

          // Write first half immediately, wait 75ms, then write second half and close stdin
          child.stdin.write(chunk1);
          setTimeout(() => {
            child.stdin.write(chunk2);
            child.stdin.end();
          }, 75);
        }
      );

      expect(hookOutput.code).toBe(0);
      expect(hookOutput.stdout).toBeTruthy();
      const decision = JSON.parse(hookOutput.stdout);
      expect(decision.decision).toBe('allow');
    });
  });

  describe('3. Daemon SIGTERM Graceful Shutdown & PID-Based Stop Recovery Without lsof', () => {
    it('handles SIGTERM gracefully in ese start --foreground and returns pid from /api/ping', async () => {
      const port = await getFreePortBlock();
      const wsDir = path.join(tempRoot, 'daemon-sigterm-ws');
      fs.mkdirSync(wsDir, { recursive: true });
      initWorkspace(wsDir, { projectCode: 'DMN' });

      const child = spawn(process.execPath, [cliScript, 'start', '--foreground', '--port', String(port)], {
        cwd: wsDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ESEDRE_GLOBAL_DIR: customGlobalDir },
      });

      let stdout = '';
      child.stdout.on('data', (d) => (stdout += d.toString('utf-8')));

      try {
        // Poll /api/ping until server is ready
        let pingData: any = null;
        for (let i = 0; i < 40; i++) {
          try {
            const res = await httpGetJson(`http://127.0.0.1:${port}/api/ping`);
            if (res.status === 200 && res.body?.esedre === true) {
              pingData = res.body;
              break;
            }
          } catch {}
          await new Promise((r) => setTimeout(r, 150));
        }

        expect(pingData).toBeDefined();
        expect(pingData.esedre).toBe(true);
        expect(typeof pingData.pid).toBe('number');
        expect(pingData.pid).toBe(child.pid);

        // Send SIGTERM and verify graceful shutdown (exit code 0 and shutdown message)
        const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
          child.on('exit', (code, signal) => resolve({ code, signal }));
        });

        child.kill('SIGTERM');
        const exitResult = await exitPromise;

        if (process.platform !== 'win32') {
          expect(exitResult.code).toBe(0);
          expect(stdout).toMatch(/Shutting down Esedre (server|cluster)/);
        }
      } finally {
        try {
          child.kill('SIGKILL');
        } catch {}
      }
    });

    it('stops an unrecorded daemon when state file is missing even without lsof on PATH', async () => {
      const port = await getFreePortBlock();
      const wsDir = path.join(tempRoot, 'daemon-unrecorded-ws');
      fs.mkdirSync(wsDir, { recursive: true });
      initWorkspace(wsDir, { projectCode: 'UNREC', port });

      const child = spawn(process.execPath, [cliScript, 'start', '--foreground', '--port', String(port)], {
        cwd: wsDir,
        stdio: 'ignore',
        env: { ...process.env, ESEDRE_GLOBAL_DIR: customGlobalDir },
      });

      try {
        let ready = false;
        for (let i = 0; i < 40; i++) {
          const ping = await pingDaemon(port);
          if (ping.responding && ping.isEsedre) {
            ready = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 150));
        }
        expect(ready).toBe(true);

        // Ensure state file does NOT exist so stopDaemon must recover via /api/ping pid
        const stateFile = getDaemonStateFile(port, wsDir);
        if (fs.existsSync(stateFile)) {
          fs.unlinkSync(stateFile);
        }

        const origPath = process.env.PATH;
        try {
          // Strip PATH so external lsof/netstat cannot be used if /api/ping provides pid
          process.env.PATH = '';
          await stopDaemon({ port, workspaceRoot: wsDir });
        } finally {
          process.env.PATH = origPath;
        }

        let stoppedCleanly = false;
        for (let i = 0; i < 20; i++) {
          const ping = await pingDaemon(port);
          if (!ping.responding) {
            stoppedCleanly = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 100));
        }
        expect(stoppedCleanly).toBe(true);
      } finally {
        try {
          child.kill('SIGKILL');
        } catch {}
      }
    });
  });

  describe('4. Linux Case-Sensitivity & Non-Recursive Watcher Fallback Invalidation', () => {
    it('prevents split project directories on case-sensitive filesystems and invalidates cache when recursive fs.watch is unavailable', async () => {
      const hubDir = path.join(tempRoot, 'case-watcher-hub');
      fs.mkdirSync(path.join(hubDir, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hubDir, 'projects.json'), '[]\n', 'utf-8');

      // Force fs.watch({ recursive: true }) to throw ERR_FEATURE_UNAVAILABLE_ON_PLATFORM
      // to simulate Linux mounts/kernels where recursive watch falls back
      const origWatch = fs.watch;
      let recursiveThrew = false;
      (fs as any).watch = function (filename: fs.PathLike, options?: any, listener?: any) {
        if (options && typeof options === 'object' && options.recursive === true) {
          recursiveThrew = true;
          const err: any = new Error('The watch recursive option is unavailable on this platform');
          err.code = 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM';
          throw err;
        }
        return (origWatch as any).call(fs, filename, options, listener);
      };

      const storage = new FilesystemStorageAdapter(hubDir, {
        dataDir: hubDir,
        allowedProjects: ['*'],
      });

      try {
        await storage.registerProject({ code: 'Personal', name: 'Personal Hub' });
        await storage.createTicket({
          project: 'personal',
          title: 'Initial Title',
          type: 'Feature',
        });

        // Verify only a single directory exists under projects/ (even on Linux ext4)
        const projDirs = fs.readdirSync(path.join(hubDir, 'projects'));
        expect(projDirs).toEqual(['Personal']);

        // Prime in-memory cache and initialize ticket watchers via prewarmCache()
        await storage.prewarmCache();
        expect(recursiveThrew).toBe(true);
        const genBefore = storage.getCacheGeneration();

        const initialList = await storage.listTickets({ project: 'PERSONAL' });
        expect(initialList).toHaveLength(1);
        expect(initialList[0].meta.title).toBe('Initial Title');

        // Simulate an external CLI process modifying tickets/1/meta.json on disk
        const metaPath = path.join(hubDir, 'projects', 'Personal', 'tickets', '1', 'meta.json');
        const metaObj = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        metaObj.title = 'Externally Updated Title';
        metaObj.revision = (metaObj.revision || 1) + 1;
        const futureTime = new Date(Date.now() + 500);
        fs.writeFileSync(metaPath, JSON.stringify(metaObj, null, 2) + '\n', 'utf-8');
        fs.utimesSync(metaPath, futureTime, futureTime);

        // Give non-recursive subdirectory watcher a brief tick to fire onFsEvent
        await new Promise((r) => setTimeout(r, 120));
        expect(storage.getCacheGeneration()).toBeGreaterThan(genBefore);

        const refreshedTicket = await storage.getTicket('Personal-1');
        expect(refreshedTicket?.meta.title).toBe('Externally Updated Title');

        const refreshedList = await storage.listTickets({ project: 'Personal' });
        expect(refreshedList[0].meta.title).toBe('Externally Updated Title');
      } finally {
        (fs as any).watch = origWatch;
        storage.closeWatchers();
      }
    });

    it('operates across macOS-style symlinked /private/var/folders roots, Unicode NFD/NFC paths, and stripped GUI PATH on POSIX', () => {
      const realVar = path.join(tempRoot, 'private', 'var');
      const realHub = path.join(realVar, 'folders', 'Ren\u00e9-Hub');
      const realWs = path.join(realVar, 'folders', 'Ren\u00e9-Workspace');
      fs.mkdirSync(realHub, { recursive: true });
      fs.mkdirSync(realWs, { recursive: true });

      const symlinkVar = path.join(tempRoot, 'var');
      fs.symlinkSync(realVar, symlinkVar, process.platform === 'win32' ? 'junction' : 'dir');

      const symlinkHubNfd = path.join(symlinkVar, 'folders', 'Rene\u0301-Hub');
      const symlinkWsNfc = path.join(symlinkVar, 'folders', 'Ren\u00e9-Workspace');

      const run = (args: string[], cwd: string) =>
        execFileSync(process.execPath, [cliScript, ...args], {
          cwd,
          encoding: 'utf-8',
          env: { ...process.env, ESEDRE_GLOBAL_DIR: customGlobalDir },
        }).trim();

      run(['init', realHub, '--hub'], tempRoot);
      run(['init', '--project', 'MACOS', '--name', 'macOS Simulation Project', '--hub', symlinkHubNfd], tempRoot);
      run(['init', symlinkWsNfc, '--project', 'MACOS'], tempRoot);

      // Create ticket from realpath workspace and read from symlinked workspace
      const created = JSON.parse(
        run(['create', '--title', 'macOS Symlink & NFD Ticket', '--type', 'Feature', '--json'], realWs)
      );
      expect(created.meta.id).toBe(1);

      const listed = JSON.parse(run(['list', '--json'], symlinkWsNfc));
      expect(listed).toHaveLength(1);
      expect(listed[0].title || listed[0].meta?.title).toBe('macOS Symlink & NFD Ticket');

      if (process.platform !== 'win32') {
        // Simulate macOS GUI app (launched from Dock/Spotlight) with minimal PATH=/usr/bin:/bin
        // where node lives in /usr/local/bin or /opt/homebrew/bin (or symlinked into /usr/local/bin)
        const posixWrapper = path.join(realWs, '.esedre', 'ese');
        const strippedPath = '/usr/bin:/bin';
        const nodeDir = path.dirname(process.execPath);
        const effectivePath =
          nodeDir === '/usr/local/bin' || nodeDir === '/opt/homebrew/bin' || nodeDir === '/usr/bin' || nodeDir === '/bin'
            ? strippedPath
            : `${strippedPath}:${nodeDir}`;
        const out = execFileSync(posixWrapper, ['--version'], {
          cwd: realWs,
          encoding: 'utf-8',
          env: {
            ...process.env,
            PATH: effectivePath,
            ESEDRE_GLOBAL_DIR: customGlobalDir,
            ESEDRE_BUNDLE_PATH: cliScript,
          },
        }).trim();
        expect(out).toContain('esedre v');
      }
    });
  });
});
