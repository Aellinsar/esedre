import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  initWorkspace,
  plantWrappers,
  setupMcpConfig,
  WRAPPER_BASH,
  ESE_WRAPPER_BASH,
  WRAPPER_PS1,
  ESE_WRAPPER_PS1,
} from '../src/upgrade.js';
import {
  getGlobalConfigDir,
  addLocationToGlobalConfig,
  removeLocationFromGlobalConfig,
  readGlobalConfig,
  checkGitIgnore,
} from '../src/config.js';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { generateProjectSnapshot } from '../src/snapshot.js';
import { isPathInside } from '../src/utils/identity.js';
import { getDefaultLogFilePath } from '../src/utils/logger.js';
import { createProjectMigrationBackup } from '../src/migrations/backup.js';
import { getGlobalEsedreDir } from '../src/server/daemon.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

describe('Tier 1: Cross-Platform Compatibility Contracts (Esedre-100)', () => {
  let tempRoot: string;
  let customGlobalDir: string;
  let originalGlobalEnv: string | undefined;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-xplat-contracts-'));
    customGlobalDir = path.join(tempRoot, 'custom-global-esedre');
    fs.mkdirSync(customGlobalDir, { recursive: true });
    originalGlobalEnv = process.env.ESEDRE_GLOBAL_DIR;
    process.env.ESEDRE_GLOBAL_DIR = customGlobalDir;
  });

  afterEach(() => {
    if (originalGlobalEnv !== undefined) {
      process.env.ESEDRE_GLOBAL_DIR = originalGlobalEnv;
    } else {
      delete process.env.ESEDRE_GLOBAL_DIR;
    }
    if (fs.existsSync(tempRoot)) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {}
    }
  });

  describe('1. OS-Agnostic Workspace MCP Configuration (.agents/mcp.json)', () => {
    it('generates OS-agnostic node launcher in .agents/mcp.json and .agents/mcp_config.json without cmd.exe or backslashes', () => {
      const wsDir = path.join(tempRoot, 'xplat-workspace');
      fs.mkdirSync(wsDir, { recursive: true });
      initWorkspace(wsDir, { projectCode: 'XPLAT' });

      const mcpJsonPath = path.join(wsDir, '.agents', 'mcp.json');
      const mcpConfigJsonPath = path.join(wsDir, '.agents', 'mcp_config.json');
      expect(fs.existsSync(mcpJsonPath)).toBe(true);
      expect(fs.existsSync(mcpConfigJsonPath)).toBe(true);

      const mcpJson = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));
      const mcpConfigJson = JSON.parse(fs.readFileSync(mcpConfigJsonPath, 'utf-8'));

      for (const cfg of [mcpJson, mcpConfigJson]) {
        const serverEntry = cfg?.mcpServers?.esedre;
        expect(serverEntry).toBeDefined();
        // Must not hardcode Windows-only cmd.exe or POSIX-only shell wrapper
        expect(serverEntry.command).toBe('node');
        expect(Array.isArray(serverEntry.args)).toBe(true);
        expect(serverEntry.args).toEqual(['.esedre/ese.mjs', 'mcp']);
        for (const arg of serverEntry.args) {
          expect(arg).not.toContain('\\');
        }
      }

      // The cross-platform Node launcher .esedre/ese.mjs must exist on disk
      const mjsLauncherPath = path.join(wsDir, '.esedre', 'ese.mjs');
      expect(fs.existsSync(mjsLauncherPath)).toBe(true);
    });

    it('ensures the repository own tracked .agents/mcp.json is OS-agnostic', () => {
      const repoMcpPath = path.join(repoRoot, '.agents', 'mcp.json');
      const repoMcp = JSON.parse(fs.readFileSync(repoMcpPath, 'utf-8'));
      expect(repoMcp.mcpServers?.esedre?.command).toBe('node');
      expect(repoMcp.mcpServers?.esedre?.args).toEqual(['.esedre/ese.mjs', 'mcp']);
    });
  });

  describe('2. POSIX Wrapper Line Endings (LF), .gitattributes & Git Executable Modes (100755)', () => {
    it('keeps POSIX wrapper templates strictly LF with zero carriage returns', () => {
      expect(WRAPPER_BASH).not.toContain('\r');
      expect(ESE_WRAPPER_BASH).not.toContain('\r');
      expect(WRAPPER_BASH.startsWith('#!/usr/bin/env bash\n')).toBe(true);
      expect(ESE_WRAPPER_BASH.startsWith('#!/usr/bin/env bash\n')).toBe(true);
      expect(WRAPPER_PS1).toContain('[System.Text.Encoding]::UTF8');
      expect(ESE_WRAPPER_PS1).toContain('[System.Text.Encoding]::UTF8');
    });

    it('plants .esedre/.gitattributes enforcing eol=lf for POSIX scripts when planting wrappers', () => {
      const wsDir = path.join(tempRoot, 'wrapper-ws');
      fs.mkdirSync(wsDir, { recursive: true });
      plantWrappers(wsDir);

      const eseBash = fs.readFileSync(path.join(wsDir, '.esedre', 'ese'), 'utf-8');
      const esedreBash = fs.readFileSync(path.join(wsDir, '.esedre', 'esedre'), 'utf-8');
      expect(eseBash).not.toContain('\r');
      expect(esedreBash).not.toContain('\r');

      const gitAttributesPath = path.join(wsDir, '.esedre', '.gitattributes');
      expect(fs.existsSync(gitAttributesPath)).toBe(true);
      const gitAttrContent = fs.readFileSync(gitAttributesPath, 'utf-8');
      expect(gitAttrContent).toContain('eol=lf');
    });

    it('ensures repository .esedre wrappers, .esedre/ese.mjs, and .gitattributes enforce LF and POSIX executable bits', () => {
      const rootGitAttributes = path.join(repoRoot, '.gitattributes');
      expect(fs.existsSync(rootGitAttributes)).toBe(true);
      const attrText = fs.readFileSync(rootGitAttributes, 'utf-8');
      expect(attrText).toContain('eol=lf');
      expect(attrText).toContain('.esedre/ese text eol=lf');

      const esedreGitAttributes = path.join(repoRoot, '.esedre', '.gitattributes');
      expect(fs.existsSync(esedreGitAttributes)).toBe(true);

      const repoEse = fs.readFileSync(path.join(repoRoot, '.esedre', 'ese'), 'utf-8');
      const repoEsedre = fs.readFileSync(path.join(repoRoot, '.esedre', 'esedre'), 'utf-8');
      const repoEseMjs = fs.readFileSync(path.join(repoRoot, '.esedre', 'ese.mjs'), 'utf-8');
      expect(repoEse).not.toContain('\r');
      expect(repoEsedre).not.toContain('\r');
      expect(repoEseMjs).not.toContain('\r');

      if (process.platform !== 'win32') {
        const wsDir = path.join(tempRoot, 'chmod-ws');
        fs.mkdirSync(wsDir, { recursive: true });
        plantWrappers(wsDir);
        for (const name of ['ese', 'esedre', 'ese.mjs']) {
          const mode = fs.statSync(path.join(wsDir, '.esedre', name)).mode;
          expect(mode & 0o111).toBeGreaterThan(0);

          const repoMode = fs.statSync(path.join(repoRoot, '.esedre', name)).mode;
          expect(repoMode & 0o111).toBeGreaterThan(0);
        }
      }

      if (fs.existsSync(path.join(repoRoot, '.git'))) {
        const lsFilesOut = execFileSync(
          'git',
          ['--no-pager', 'ls-files', '-s', '.esedre/ese', '.esedre/esedre', '.esedre/ese.mjs'],
          {
            cwd: repoRoot,
            encoding: 'utf-8',
          }
        ).trim();
        const lines = lsFilesOut.split(/\r?\n/).filter(Boolean);
        expect(lines).toHaveLength(3);
        for (const line of lines) {
          expect(line.startsWith('100755 ')).toBe(true);
        }
      }
    });
  });

  describe('3. Hermetic ESEDRE_GLOBAL_DIR Isolation (Zero os.homedir() Leaks)', () => {
    it('routes getDefaultLogFilePath through getGlobalConfigDir()', () => {
      const logPath = getDefaultLogFilePath();
      expect(isPathInside(logPath, customGlobalDir)).toBe(true);
      expect(logPath).toBe(path.join(customGlobalDir, 'logs', 'esedre-debug.log'));
    });

    it('routes createProjectMigrationBackup default backup directory through getGlobalConfigDir()', () => {
      const dummyProjectDir = path.join(tempRoot, 'dummy-proj');
      const dummyTicketsDir = path.join(dummyProjectDir, 'tickets');
      fs.mkdirSync(dummyTicketsDir, { recursive: true });
      fs.writeFileSync(
        path.join(dummyProjectDir, 'project.json'),
        JSON.stringify({ id: 1, code: 'DUMMY', name: 'Dummy' }, null, 2),
        'utf-8'
      );

      const backupDir = createProjectMigrationBackup({
        projectDir: dummyProjectDir,
        ticketsDir: dummyTicketsDir,
        projectCode: 'DUMMY',
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
      });
      expect(isPathInside(backupDir, customGlobalDir)).toBe(true);
    });

    it('routes getGlobalEsedreDir in daemon.ts through getGlobalConfigDir() including VITEST fallback', () => {
      expect(getGlobalEsedreDir()).toBe(customGlobalDir);

      delete process.env.ESEDRE_GLOBAL_DIR;
      const vitestFallbackDir = getGlobalEsedreDir();
      expect(vitestFallbackDir).toBe(getGlobalConfigDir());
      expect(isPathInside(vitestFallbackDir, os.tmpdir())).toBe(true);
    });

    it('updates ESEDRE_GLOBAL_DIR/config.json (not os.homedir()) during renameProjectCode', async () => {
      const hubDir = path.join(tempRoot, 'rename-hub');
      const repoDir = path.join(tempRoot, 'rename-repo');
      fs.mkdirSync(path.join(hubDir, 'projects'), { recursive: true });
      fs.mkdirSync(repoDir, { recursive: true });
      fs.writeFileSync(path.join(hubDir, 'projects.json'), '[]\n', 'utf-8');

      const storage = new FilesystemStorageAdapter(repoDir, {
        projectCode: 'OldName',
        dataDir: hubDir,
        allowedProjects: ['*'],
      });
      await storage.registerProject({ code: 'OldName', name: 'Old Project' });

      initWorkspace(repoDir, {
        projectCode: 'OldName',
        dataDir: hubDir,
        allowedProjects: ['OldName'],
      });

      const beforeGlobal = readGlobalConfig();
      expect(beforeGlobal?.projects?.['OldName']).toBeDefined();

      await storage.renameProjectCode({ oldCode: 'OldName', newCode: 'NewName' });

      const afterGlobal = readGlobalConfig();
      expect(afterGlobal?.projects?.['NewName']).toBeDefined();
      expect(afterGlobal?.projects?.['OldName']).toBeUndefined();
    });
  });

  describe('4. Platform-Aware Path Containment (isPathInside) & Global Config Normalization', () => {
    it('rejects sibling directories that share a string prefix', () => {
      const parent = path.resolve(tempRoot, 'web');
      const sibling = path.resolve(tempRoot, 'web-other', 'index.html');
      const child = path.resolve(tempRoot, 'web', 'assets', 'app.js');

      expect(isPathInside(child, parent)).toBe(true);
      expect(isPathInside(parent, parent)).toBe(true);
      expect(isPathInside(sibling, parent)).toBe(false);
    });

    it('respects OS filesystem case-sensitivity (case-sensitive on Linux, case-insensitive on Windows/macOS)', () => {
      const upperParent = path.resolve(tempRoot, 'MixedCaseRepo');
      const lowerChild = path.resolve(tempRoot, 'mixedcaserepo', 'src', 'index.ts');

      if (process.platform === 'linux') {
        expect(isPathInside(lowerChild, upperParent)).toBe(false);
      } else {
        expect(isPathInside(lowerChild, upperParent)).toBe(true);
      }
    });

    it('deduplicates and removes dataDir locations consistently in global config', () => {
      const hubPath = path.join(tempRoot, 'SharedHub');
      fs.mkdirSync(path.join(hubPath, 'projects'), { recursive: true });
      fs.writeFileSync(path.join(hubPath, 'projects.json'), '[]\n', 'utf-8');

      addLocationToGlobalConfig(hubPath);
      if (process.platform === 'win32' || process.platform === 'darwin') {
        addLocationToGlobalConfig(hubPath.toLowerCase());
        const cfg = readGlobalConfig();
        const dirs = Array.isArray(cfg?.dataDir) ? cfg.dataDir : cfg?.dataDir ? [cfg.dataDir] : [];
        expect(dirs.length).toBe(1);
      }

      removeLocationFromGlobalConfig(hubPath);
      const afterRemove = readGlobalConfig();
      expect(afterRemove?.dataDir).toBeUndefined();
    });
  });

  describe('5. CRLF vs LF Line-Ending Equivalence in Storage, Parsers & Snapshots', () => {
    it('parses detail.md, plan.md, AGENTS.md, and .gitignore identically with CRLF and LF line endings', async () => {
      const lfDir = path.join(tempRoot, 'lf-workspace');
      const crlfDir = path.join(tempRoot, 'crlf-workspace');
      fs.mkdirSync(lfDir, { recursive: true });
      fs.mkdirSync(crlfDir, { recursive: true });

      const agentsLines = [
        '# Agent Guidelines',
        '- **Primary Mission**: Deliver consistent cross-platform ticketing.',
        '- **Core Stack**: Node.js, TypeScript, React 19, Vite.',
        '- Always run `npm test` and `npm run build` before completion.',
      ];
      fs.writeFileSync(path.join(lfDir, 'AGENTS.md'), agentsLines.join('\n') + '\n', 'utf-8');
      fs.writeFileSync(path.join(crlfDir, 'AGENTS.md'), agentsLines.join('\r\n') + '\r\n', 'utf-8');

      const gitignoreLines = ['node_modules/', 'dist/', '.esedre/snapshot.json'];
      fs.writeFileSync(path.join(lfDir, '.gitignore'), gitignoreLines.join('\n') + '\n', 'utf-8');
      fs.writeFileSync(path.join(crlfDir, '.gitignore'), gitignoreLines.join('\r\n') + '\r\n', 'utf-8');

      expect(checkGitIgnore(lfDir).hasSnapshotIgnored).toBe(true);
      expect(checkGitIgnore(crlfDir).hasSnapshotIgnored).toBe(true);

      const lfStorage = new FilesystemStorageAdapter(lfDir, {
        projectCode: 'LFPROJ',
        allowedProjects: ['LFPROJ'],
      });
      const crlfStorage = new FilesystemStorageAdapter(crlfDir, {
        projectCode: 'LFPROJ',
        allowedProjects: ['LFPROJ'],
      });

      await lfStorage.registerProject({ code: 'LFPROJ', name: 'Line Ending Project' });
      await crlfStorage.registerProject({ code: 'LFPROJ', name: 'Line Ending Project' });

      const detailLines = [
        '# Ticket #1: Cross-OS Line Ending Ticket',
        '**Type**: Feature  ',
        '**Priority**: High  ',
        '**Complexity**: Medium  ',
        '**Estimated Effort**: 2.0 - 4.0 hours  ',
        '',
        '### Summary',
        'Ensure CRLF and LF markdown files parse to identical structured fields.',
        '',
        '### Feature Breakdown',
        '- Parse summary without trailing CR characters',
        '- Parse breakdown items cleanly',
        '',
        '### Technical Details',
        '- Normalize line endings before regex section splits',
        '',
        '### Open Questions',
        '- Should snapshots normalize CRLF to LF?',
      ];

      const planLines = ['# Implementation Plan', '', '1. Normalize CRLF', '2. Verify hashes'];

      await lfStorage.createTicket({
        project: 'LFPROJ',
        title: 'Cross-OS Line Ending Ticket',
        type: 'Feature',
        priority: 'High',
        complexity: 'Medium',
        estimatedEffort: '2.0 - 4.0 hours',
        detailMarkdown: detailLines.join('\n'),
        planMarkdown: planLines.join('\n'),
      });

      await crlfStorage.createTicket({
        project: 'LFPROJ',
        title: 'Cross-OS Line Ending Ticket',
        type: 'Feature',
        priority: 'High',
        complexity: 'Medium',
        estimatedEffort: '2.0 - 4.0 hours',
        detailMarkdown: detailLines.join('\r\n'),
        planMarkdown: planLines.join('\r\n'),
      });

      // Simulate git core.autocrlf=true checkout by writing raw CRLF directly to disk
      const crlfTicketDir = path.join(crlfDir, 'projects', 'LFPROJ', 'tickets', '1');
      if (fs.existsSync(crlfTicketDir)) {
        fs.writeFileSync(path.join(crlfTicketDir, 'detail.md'), detailLines.join('\r\n') + '\r\n', 'utf-8');
        fs.writeFileSync(
          path.join(crlfTicketDir, 'implementation_plan.md'),
          planLines.join('\r\n') + '\r\n',
          'utf-8'
        );
      }
      crlfStorage.invalidateTicketCache();

      const tLf = await lfStorage.getTicket('LFPROJ-1');
      const tCrlf = await crlfStorage.getTicket('LFPROJ-1');

      expect(tCrlf?.detail?.summary).toBe(tLf?.detail?.summary);
      expect(tCrlf?.detail?.breakdown).toEqual(tLf?.detail?.breakdown);
      expect(tCrlf?.detail?.technicalDetails).toEqual(tLf?.detail?.technicalDetails);
      expect(tCrlf?.detail?.openQuestions).toEqual(tLf?.detail?.openQuestions);
      expect(tCrlf?.detail?.raw).not.toContain('\r');
      expect(tCrlf?.sha1).toBe(tLf?.sha1);

      const planCrlf = await crlfStorage.getPlan('LFPROJ-1');
      expect(planCrlf).not.toContain('\r');

      const cmt = await crlfStorage.addComment('LFPROJ-1', {
        author: 'Dev',
        text: 'First line\r\nSecond line\rThird line',
      });
      expect(cmt.text).toBe('First line\nSecond line\nThird line');

      const snapLf = await generateProjectSnapshot(lfStorage, 'LFPROJ', lfDir, { includePlans: true });
      const snapCrlf = await generateProjectSnapshot(crlfStorage, 'LFPROJ', crlfDir, { includePlans: true });
      expect(snapCrlf.tickets[0].summary).toBe(snapLf.tickets[0].summary);
      expect(snapCrlf.tickets[0].planMarkdown).toBe(snapLf.tickets[0].planMarkdown);
      expect(snapCrlf.tickets[0].planMarkdown).not.toContain('\r');
    });
  });

  describe('6. Package Engine Floor, Lockfile Sync & Tunnel Script Encoding Contract', () => {
    it('declares a Node.js engine floor compatible with Node 20 LTS and Node 22 LTS and keeps package-lock.json in sync', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
      const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf-8'));
      const nodeEngine = String(pkg.engines?.node || '');
      expect(nodeEngine).toMatch(/^>=\s*(20|22)\./);

      const lockRoot = lock.packages?.[''] || {};
      expect(lockRoot.dependencies).toEqual(pkg.dependencies);
      expect(lockRoot.devDependencies).toEqual(pkg.devDependencies);
      expect(lockRoot.engines).toEqual(pkg.engines);
    });

    it('contains zero UTF-8-as-Windows-1252 mojibake sequences in tools/tunnel/run-net.js', () => {
      const runNetText = fs.readFileSync(path.join(repoRoot, 'tools', 'tunnel', 'run-net.js'), 'utf-8');
      expect(runNetText).not.toMatch(/ðŸ|âš|Ã¢/);
    });
  });

  describe('7. macOS APFS Unicode NFD/NFC, /private/var Symlinks & GUI PATH Contract', () => {
    it('normalizes macOS APFS NFD vs NFC Unicode paths in isPathInside and addLocationToGlobalConfig', () => {
      const nfcName = 'Ren\u00e9-Caf\u00e9-Hub';
      const nfdName = 'Rene\u0301-Cafe\u0301-Hub';
      expect(nfcName).not.toBe(nfdName);

      const nfcDir = path.join(tempRoot, nfcName);
      fs.mkdirSync(path.join(nfcDir, 'projects', 'MAC'), { recursive: true });

      const nfdDir = path.join(tempRoot, nfdName);
      expect(isPathInside(path.join(nfdDir, 'projects', 'MAC'), nfcDir)).toBe(true);
      expect(isPathInside(path.join(nfcDir, 'projects', 'MAC'), nfdDir)).toBe(true);

      addLocationToGlobalConfig(nfcDir);
      addLocationToGlobalConfig(nfdDir);
      const cfg = readGlobalConfig();
      const hubs = Array.isArray(cfg?.dataDir) ? cfg!.dataDir : cfg?.dataDir ? [cfg.dataDir] : [];
      expect(hubs).toHaveLength(1);
    });

    it('resolves macOS /var/folders -> /private/var/folders symlinked roots in isPathInside', () => {
      const realRepoDir = path.join(tempRoot, 'private', 'var', 'folders', 'xx', 'repo');
      fs.mkdirSync(path.join(realRepoDir, 'src'), { recursive: true });
      const varParent = path.join(tempRoot, 'var');
      fs.symlinkSync(
        path.join(tempRoot, 'private', 'var'),
        varParent,
        process.platform === 'win32' ? 'junction' : 'dir'
      );

      const symlinkRepoDir = path.join(varParent, 'folders', 'xx', 'repo');
      expect(isPathInside(path.join(realRepoDir, 'src', 'newfile.ts'), symlinkRepoDir)).toBe(true);
      expect(isPathInside(path.join(symlinkRepoDir, 'src', 'newfile.ts'), realRepoDir)).toBe(true);
    });

    it('enriches macOS GUI PATH (/opt/homebrew/bin, /usr/local/bin) and avoids Bash 4+ syntax in POSIX wrappers', () => {
      expect(WRAPPER_BASH).toContain('/opt/homebrew/bin:/usr/local/bin');
      // macOS ships Bash 3.2 at /bin/bash; ensure no Bash 4+ builtins or parameter expansions are used
      expect(WRAPPER_BASH).not.toMatch(/\breadarray\b|\bmapfile\b|\bdeclare\s+-A\b|\$\{[A-Za-z0-9_]+,,|\$\{[A-Za-z0-9_]+\^\^|\|&/);

      const wsDir = path.join(tempRoot, 'mac-wrapper-ws');
      fs.mkdirSync(wsDir, { recursive: true });
      plantWrappers(wsDir);
      const mjsContent = fs.readFileSync(path.join(wsDir, '.esedre', 'ese.mjs'), 'utf-8');
      expect(mjsContent).toContain('/opt/homebrew/lib/node_modules/esedre/dist/esedre.mjs');
      expect(mjsContent).toContain('/usr/local/lib/node_modules/esedre/dist/esedre.mjs');
    });
  });
});
