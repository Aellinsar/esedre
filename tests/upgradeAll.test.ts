import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import child_process from 'node:child_process';
import {
  isWrapperOutdated,
  findOutdatedWrappers,
  upgradeAllWorkspaces,
  WRAPPER_CMD,
  configureWorkspace,
} from '../src/upgrade.js';
import { EsedreConfig } from '../src/config.js';

describe('Windows CMD Wrapper Diagnostics and Multi-Workspace Upgrade', () => {
  let tempBaseDir: string;

  beforeEach(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-upgrade-all-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempBaseDir)) {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  });

  describe('isWrapperOutdated', () => {
    it('returns false for current modern WRAPPER_CMD template', () => {
      expect(isWrapperOutdated(WRAPPER_CMD)).toBe(false);
    });

    it('returns true for null, undefined, or empty string', () => {
      expect(isWrapperOutdated(null)).toBe(true);
      expect(isWrapperOutdated(undefined)).toBe(true);
      expect(isWrapperOutdated('')).toBe(true);
      expect(isWrapperOutdated('   ')).toBe(true);
    });

    it('returns true for legacy wrapper with parenthesized goto :done', () => {
      const legacy1 = `@echo off
where ese >nul 2>nul
if %ERRORLEVEL% equ 0 (
  ese %*
  goto :done
)
:done
exit /b %ERRORLEVEL%
`;
      expect(isWrapperOutdated(legacy1)).toBe(true);
    });

    it('returns true for legacy wrapper with goto done and :done label', () => {
      const legacy2 = `@echo off
setlocal
where ese >nul 2>nul
if %ERRORLEVEL% equ 0 goto use_ese
:use_ese
call ese %*
goto done
:done
endlocal & exit /b %ERRORLEVEL%
`;
      expect(isWrapperOutdated(legacy2)).toBe(true);
    });

    it('returns true if missing call :run subroutine dispatch', () => {
      const missingSubroutine = `@echo off
node "%~dp0..\\dist\\esedre.mjs" %*
exit /b %ERRORLEVEL%
`;
      expect(isWrapperOutdated(missingSubroutine)).toBe(true);
    });
  });

  describe('findOutdatedWrappers', () => {
    it('detects workspaces with legacy CMD wrappers and ignores modern ones', () => {
      const wsLegacy = path.join(tempBaseDir, 'legacy-project');
      const wsModern = path.join(tempBaseDir, 'modern-project');

      fs.mkdirSync(path.join(wsLegacy, '.esedre'), { recursive: true });
      fs.mkdirSync(path.join(wsModern, '.esedre'), { recursive: true });

      // Plant legacy wrapper in wsLegacy
      fs.writeFileSync(
        path.join(wsLegacy, '.esedre', 'esedre.cmd'),
        `@echo off\r\ncall ese %*\r\ngoto :done\r\n:done\r\n`,
        'utf-8'
      );

      // Plant modern wrapper in wsModern
      fs.writeFileSync(path.join(wsModern, '.esedre', 'esedre.cmd'), WRAPPER_CMD, 'utf-8');

      const mockGlobalConfig: EsedreConfig = {
        projects: {
          LEGACY: wsLegacy,
          MODERN: wsModern,
        },
      };

      const outdated = findOutdatedWrappers(undefined, mockGlobalConfig);
      expect(outdated.length).toBe(1);
      expect(outdated[0].name).toBe('LEGACY');
      expect(path.resolve(outdated[0].dir)).toBe(path.resolve(wsLegacy));
    });
  });

  describe('upgradeAllWorkspaces', () => {
    it('upgrades wrappers and snapshots across multiple registered workspaces', async () => {
      const ws1 = path.join(tempBaseDir, 'project-alpha');
      const ws2 = path.join(tempBaseDir, 'project-beta');

      // Setup ws1 as initialized workspace with legacy wrapper
      configureWorkspace(ws1, { projectCode: 'ALPHA', projectName: 'Alpha App' });
      fs.writeFileSync(
        path.join(ws1, '.esedre', 'esedre.cmd'),
        `@echo off\r\nif exist "%~dp0..\\dist" ( goto :done )\r\n:done\r\n`,
        'utf-8'
      );

      // Setup ws2 as initialized workspace with legacy wrapper
      configureWorkspace(ws2, { projectCode: 'BETA', projectName: 'Beta App' });
      fs.writeFileSync(
        path.join(ws2, '.esedre', 'esedre.cmd'),
        `@echo off\r\ncall ese %*\r\ngoto done\r\n:done\r\n`,
        'utf-8'
      );

      expect(isWrapperOutdated(fs.readFileSync(path.join(ws1, '.esedre', 'esedre.cmd'), 'utf-8'))).toBe(true);
      expect(isWrapperOutdated(fs.readFileSync(path.join(ws2, '.esedre', 'esedre.cmd'), 'utf-8'))).toBe(true);

      const mockGlobalConfig: EsedreConfig = {
        projects: {
          ALPHA: ws1,
          BETA: ws2,
        },
      };

      const res = await upgradeAllWorkspaces({
        currentWorkspaceRoot: ws1,
        globalConfig: mockGlobalConfig,
        force: false,
      });

      expect(res.workspaces.length).toBe(2);
      expect(res.totalUpgraded).toBe(2);

      // Verify both workspaces now have modern, non-outdated wrappers
      const updatedWs1 = fs.readFileSync(path.join(ws1, '.esedre', 'esedre.cmd'), 'utf-8');
      const updatedWs2 = fs.readFileSync(path.join(ws2, '.esedre', 'esedre.cmd'), 'utf-8');

      expect(isWrapperOutdated(updatedWs1)).toBe(false);
      expect(isWrapperOutdated(updatedWs2)).toBe(false);
      expect(updatedWs1).toContain('call :run %*');
      expect(updatedWs1).toContain('goto :eof');
      expect(updatedWs2).toContain('call :run %*');
      expect(updatedWs2).toContain('goto :eof');

      // Verify snapshots were created / updated
      expect(fs.existsSync(path.join(ws1, '.esedre', 'snapshot.json'))).toBe(true);
      expect(fs.existsSync(path.join(ws2, '.esedre', 'snapshot.json'))).toBe(true);
    });

    it('skips non-existent registered project paths gracefully', async () => {
      const nonExistent = path.join(tempBaseDir, 'does-not-exist');
      const validWs = path.join(tempBaseDir, 'valid-ws');

      configureWorkspace(validWs, { projectCode: 'VALID' });

      const mockGlobalConfig: EsedreConfig = {
        projects: {
          GHOST: nonExistent,
          VALID: validWs,
        },
      };

      const res = await upgradeAllWorkspaces({
        globalConfig: mockGlobalConfig,
      });

      expect(res.workspaces.length).toBe(1);
      expect(res.workspaces[0].name).toBe('VALID');
      expect(res.totalUpgraded).toBe(1);
    });
  });

  describe('CLI ese upgrade --all execution', () => {
    it('executes ese upgrade --all via CLI and outputs structured result', () => {
      const ws = path.join(tempBaseDir, 'cli-test-ws');
      configureWorkspace(ws, { projectCode: 'CLITEST' });

      const cliPath = path.resolve(__dirname, '../dist/esedre.mjs');
      const result = child_process.spawnSync(
        process.execPath,
        [cliPath, 'upgrade', '--all', '--json'],
        {
          cwd: ws,
          encoding: 'utf-8',
          windowsHide: true,
          env: {
            ...process.env,
            ESEDRE_GLOBAL_DIR: path.join(tempBaseDir, 'global-store'),
          },
        }
      );

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.workspaces).toBeDefined();
      expect(Array.isArray(parsed.workspaces)).toBe(true);
      expect(parsed.totalUpgraded).toBeGreaterThanOrEqual(1);
    });

    it('exposes outdatedWrappers in ese status --json and prints notice in human output', () => {
      const ws = path.join(tempBaseDir, 'status-test-ws');
      configureWorkspace(ws, { projectCode: 'STATUSTEST' });

      // Overwrite with legacy wrapper
      fs.writeFileSync(
        path.join(ws, '.esedre', 'esedre.cmd'),
        `@echo off\r\ncall ese %*\r\ngoto :done\r\n:done\r\n`,
        'utf-8'
      );

      const cliPath = path.resolve(__dirname, '../dist/esedre.mjs');

      // Test JSON mode
      const resJson = child_process.spawnSync(
        process.execPath,
        [cliPath, 'status', '--json'],
        {
          cwd: ws,
          encoding: 'utf-8',
          windowsHide: true,
          env: {
            ...process.env,
            ESEDRE_GLOBAL_DIR: path.join(tempBaseDir, 'global-store'),
          },
        }
      );
      expect(resJson.status).toBe(0);
      const statusObj = JSON.parse(resJson.stdout);
      expect(statusObj.outdatedWrappers).toBeDefined();
      expect(statusObj.outdatedWrappers.length).toBeGreaterThanOrEqual(1);
      expect(statusObj.outdatedWrappers.some((w: any) => w.dir === ws)).toBe(true);

      // Test Human mode output
      const resHuman = child_process.spawnSync(
        process.execPath,
        [cliPath, 'status'],
        {
          cwd: ws,
          encoding: 'utf-8',
          windowsHide: true,
          env: {
            ...process.env,
            ESEDRE_GLOBAL_DIR: path.join(tempBaseDir, 'global-store'),
          },
        }
      );
      expect(resHuman.status).toBe(0);
      expect(resHuman.stdout).toContain('legacy CMD wrappers');
      expect(resHuman.stdout).toContain('ese upgrade --all');
    });

    it('executes upgraded ese.cmd cleanly on Windows CMD with zero batch label errors', () => {
      if (process.platform !== 'win32') return;

      const ws = path.join(tempBaseDir, 'cmd-exec-test');
      configureWorkspace(ws, { projectCode: 'CMDEXEC' });

      // Plant legacy wrapper
      fs.writeFileSync(
        path.join(ws, '.esedre', 'esedre.cmd'),
        `@echo off\r\nif exist "%~dp0..\\dist" ( goto :done )\r\n:done\r\n`,
        'utf-8'
      );
      expect(isWrapperOutdated(fs.readFileSync(path.join(ws, '.esedre', 'esedre.cmd'), 'utf-8'))).toBe(true);

      // Run upgrade
      configureWorkspace(ws, { projectCode: 'CMDEXEC' });
      expect(isWrapperOutdated(fs.readFileSync(path.join(ws, '.esedre', 'esedre.cmd'), 'utf-8'))).toBe(false);

      const eseCmdPath = path.join(ws, '.esedre', 'ese.cmd');
      const cmdResult = child_process.spawnSync('cmd.exe', ['/c', eseCmdPath, '--version'], {
        cwd: ws,
        encoding: 'utf-8',
        windowsHide: true,
      });

      expect(cmdResult.status).toBe(0);
      expect(cmdResult.stdout).not.toContain('The system cannot find the batch label specified');
      expect(cmdResult.stderr).not.toContain('The system cannot find the batch label specified');
      expect(cmdResult.stdout).toContain('esedre v');
    });
  });
});

