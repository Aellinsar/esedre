import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import child_process from 'node:child_process';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { SecurityFilter } from '../src/securityFilter.js';
import { computeTicketHash, verifyTicketHash, generateProjectSnapshot } from '../src/snapshot.js';
import { EsedreConflictError, CURRENT_ESEDRE_VERSION } from '../src/types.js';
import { EsedreAuthorizationError } from '../src/config.js';
import { configureWorkspace, classifyContent, computeNormalizedHash, ESEDRE_SKILL_TEMPLATE } from '../src/upgrade.js';

describe('Optimistic Concurrency Control (lastHash & sha1)', () => {
  let tempDir: string;
  let adapter: FilesystemStorageAdapter;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-occ-test-'));
    const ticketsDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets');
    fs.mkdirSync(ticketsDir, { recursive: true });

    const projectsFile = path.join(tempDir, 'src', 'data', 'planning', 'projects', 'projects.json');
    fs.mkdirSync(path.dirname(projectsFile), { recursive: true });
    fs.writeFileSync(
      projectsFile,
      JSON.stringify([
        { id: 1, code: 'Core', name: 'Core Application', description: '' },
        { id: 2, code: 'Docs', name: 'Documentation', description: '' },
      ])
    );

    adapter = new FilesystemStorageAdapter(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('attaches sha1 hash to newly created tickets', async () => {
    const ticket = await adapter.createTicket({
      title: 'OCC Initial Ticket',
      category: 'Feature',
      projectCode: 'Core',
    });

    expect(ticket.sha1).toBeDefined();
    expect(ticket.sha1?.length).toBe(40);
    expect(ticket.lastHash).toBe(ticket.sha1);
  });

  it('allows updates when lastHash matches current ticket sha1', async () => {
    const ticket = await adapter.createTicket({
      title: 'Matching Hash Ticket',
      category: 'Feature',
      projectCode: 'Core',
    });

    const currentHash = ticket.sha1!;
    const updated = await adapter.updateTicket(ticket.meta.id, { status: 'In Development' }, currentHash);

    expect(updated.meta.status).toBe('In Development');
    expect(updated.sha1).not.toBe(currentHash); // Hash changed due to status update
  });

  it('rejects updates with EsedreConflictError when lastHash is stale', async () => {
    const ticket = await adapter.createTicket({
      title: 'Stale Hash Ticket',
      category: 'Feature',
      projectCode: 'Core',
    });

    const originalHash = ticket.sha1!;

    // First update modifies the ticket
    await adapter.updateTicket(ticket.meta.id, { status: 'In Development' });

    // Concurrent second update attempts to write using stale originalHash
    await expect(
      adapter.updateTicket(ticket.meta.id, { title: 'Conflicting Title' }, originalHash)
    ).rejects.toThrow(EsedreConflictError);
  });

  it('supports prefix hash matching for lastHash (abbreviated 7+ chars)', () => {
    const fullHash = 'a1b2c3d4e5f6789012345678901234567890abcd';
    expect(verifyTicketHash(fullHash, 'a1b2c3d4e5f6789012345678901234567890abcd')).toBe(true);
    expect(verifyTicketHash(fullHash, 'a1b2c3d')).toBe(true); // 7 chars
    expect(verifyTicketHash(fullHash, 'a1b2c3d4e5')).toBe(true); // 10 chars
    expect(verifyTicketHash(fullHash, 'different')).toBe(false);
  });

  it('enforces optimistic concurrency on plan markdown updates', async () => {
    const ticket = await adapter.createTicket({
      title: 'Plan OCC Ticket',
      category: 'Feature',
      projectCode: 'Core',
    });

    const hash1 = ticket.sha1!;
    await adapter.savePlan(ticket.meta.id, '# Plan Content\nDetailed steps.', hash1);

    const afterPlan = await adapter.getTicket(ticket.meta.id);
    const hash2 = afterPlan!.sha1!;
    expect(hash2).not.toBe(hash1);

    // Trying to save plan with stale hash1 must fail
    await expect(
      adapter.savePlan(ticket.meta.id, '# Newer Plan', hash1)
    ).rejects.toThrow(EsedreConflictError);
  });
});

describe('SecurityFilter Proxy', () => {
  let tempDir: string;
  let rawStorage: FilesystemStorageAdapter;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-sec-filter-test-'));
    const ticketsDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets');
    fs.mkdirSync(ticketsDir, { recursive: true });

    const projectsFile = path.join(tempDir, 'src', 'data', 'planning', 'projects', 'projects.json');
    fs.mkdirSync(path.dirname(projectsFile), { recursive: true });
    fs.writeFileSync(
      projectsFile,
      JSON.stringify([
        { id: 1, code: 'Core', name: 'Core Application', description: '' },
        { id: 2, code: 'Docs', name: 'Documentation', description: '' },
        { id: 3, code: 'Web', name: 'Web Client', description: '' },
      ])
    );

    rawStorage = new FilesystemStorageAdapter(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('filters getProjects() to authorized projects only', async () => {
    const filter = new SecurityFilter(rawStorage, { allowedProjects: ['Core', 'Docs'] });
    const projects = await filter.getProjects();

    expect(projects.map((p) => p.code)).toEqual(['Core', 'Docs']);
    expect(projects.some((p) => p.code === 'Web')).toBe(false);
  });

  it('prevents reading or mutating tickets belonging to unauthorized projects', async () => {
    // Create an Web ticket in raw storage
    const webTicket = await rawStorage.createTicket({
      title: 'Web Client Feature',
      category: 'Feature',
      projectCode: 'Web',
    });

    const filter = new SecurityFilter(rawStorage, { allowedProjects: ['Prof'] });

    // getTicket on unauthorized project ticket throws EsedreAuthorizationError
    await expect(filter.getTicket(webTicket.meta.id)).rejects.toThrow(EsedreAuthorizationError);

    // updateTicket throws EsedreAuthorizationError
    await expect(filter.updateTicket(webTicket.meta.id, { status: 'Completed' })).rejects.toThrow(EsedreAuthorizationError);

    // savePlan throws EsedreAuthorizationError
    await expect(filter.savePlan(webTicket.meta.id, '# Attack')).rejects.toThrow(EsedreAuthorizationError);
  });

  it('prevents creating tickets in unauthorized projects', async () => {
    const filter = new SecurityFilter(rawStorage, { allowedProjects: ['Prof'] });

    await expect(
      filter.createTicket({
        title: 'Unauthorized Creation',
        category: 'Feature',
        projectCode: 'Web',
      })
    ).rejects.toThrow(EsedreAuthorizationError);
  });
});

describe('Local Projection Snapshot Generation', () => {
  let tempDir: string;
  let adapter: FilesystemStorageAdapter;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-snapshot-test-'));
    const ticketsDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets');
    fs.mkdirSync(ticketsDir, { recursive: true });

    const projectsFile = path.join(tempDir, 'src', 'data', 'planning', 'projects', 'projects.json');
    fs.mkdirSync(path.dirname(projectsFile), { recursive: true });
    fs.writeFileSync(
      projectsFile,
      JSON.stringify([
        { id: 1, code: 'Core', name: 'Core Application', description: '' },
      ])
    );

    adapter = new FilesystemStorageAdapter(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('generates .esedre/snapshot.json projection with sha1 for all tickets', async () => {
    await adapter.createTicket({ title: 'Ticket Alpha', category: 'Feature', projectCode: 'Core' });
    await adapter.createTicket({ title: 'Ticket Beta', category: 'Bug', projectCode: 'Core' });

    const snapshot = await generateProjectSnapshot(adapter, 'Core', tempDir);

    expect(snapshot.projectCode).toBe('Core');
    expect(snapshot.version).toBe(CURRENT_ESEDRE_VERSION);
    expect(snapshot.totalTickets).toBe(2);
    expect(snapshot.tickets.length).toBe(2);

    const snapshotFile = path.join(tempDir, '.esedre', 'snapshot.json');
    expect(fs.existsSync(snapshotFile)).toBe(true);

    const onDisk = JSON.parse(fs.readFileSync(snapshotFile, 'utf-8'));
    expect(onDisk.version).toBe(CURRENT_ESEDRE_VERSION);
    expect(onDisk.totalTickets).toBe(2);
    expect(onDisk.tickets[0].sha1).toBeDefined();
    expect(onDisk.tickets[0].sha1.length).toBe(40);
  });

  it('includes compound ticketKey, plan content, and temporal metadata in snapshot', async () => {
    const t1 = await adapter.createTicket({
      title: 'Full Featured Ticket',
      type: 'Feature',
      complexity: 'High',
      estimatedEffort: '4.0 - 6.0 hours',
      summary: 'Comprehensive feature breakdown',
      projectCode: 'Core',
    });

    await adapter.savePlan(t1.meta.id, '# Implementation Plan\n- Step 1: Design\n- Step 2: Test');
    await adapter.updateTicket(t1.meta.id, { status: 'Completed' });

    const snapshot = await generateProjectSnapshot(adapter, 'Core', tempDir);
    const entry = snapshot.tickets.find((t) => t.id === t1.meta.id);

    expect(entry).toBeDefined();
    expect(entry!.ticketKey).toBe(`Core-${t1.meta.id}`);
    expect(entry!.type).toBe('Feature');
    expect(entry!.status).toBe('Completed');
    expect(entry!.complexity).toBe('High');
    expect(entry!.estimatedEffort).toBe('4.0 - 6.0 hours');
    expect(entry!.hasPlan).toBe(true);
    expect(entry!.planMarkdown).toContain('# Implementation Plan');
    expect(entry!.completedAt).toBeDefined();
    expect(entry!.daysSinceUpdate).toBeGreaterThanOrEqual(0);
    expect(entry!.revision).toBeGreaterThanOrEqual(1);

    // Verify snapshot file on disk can be loaded directly for zero-latency LLM agent context
    const snapshotFile = path.join(tempDir, '.esedre', 'snapshot.json');
    const directRead = JSON.parse(fs.readFileSync(snapshotFile, 'utf-8'));
    expect(directRead.tickets[0].ticketKey).toBe(`Core-${t1.meta.id}`);
    expect(directRead.tickets[0].hasPlan).toBe(true);
  });

  it('generates snapshot via CLI ese snapshot command', async () => {
    await adapter.createTicket({ title: 'CLI Snapshot Ticket', category: 'Feature', projectCode: 'Core' });
    const cliPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

    // Create minimal .esedre/esedre.json in tempDir so CLI recognizes projectCode
    fs.mkdirSync(path.join(tempDir, '.esedre'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, '.esedre', 'esedre.json'),
      JSON.stringify({ version: CURRENT_ESEDRE_VERSION, projectCode: 'Core' }),
      'utf-8'
    );

    const { execFileSync } = await import('node:child_process');
    const out = execFileSync(
      process.execPath,
      [cliPath, 'snapshot', '--project', 'Core', '--json'],
      {
        cwd: tempDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          ESEDRE_GLOBAL_DIR: path.join(tempDir, 'global-store'),
        },
      }
    );

    const parsed = JSON.parse(out);
    expect(parsed.projectCode).toBe('Core');
    expect(parsed.totalTickets).toBeGreaterThanOrEqual(1);

    const snapshotFile = path.join(tempDir, '.esedre', 'snapshot.json');
    expect(fs.existsSync(snapshotFile)).toBe(true);
  });
});

describe('Upgrade & 3-Way Hash Detection', () => {
  it('classifies missing content as MISSING', () => {
    expect(classifyContent('', ESEDRE_SKILL_TEMPLATE, [])).toBe('MISSING');
    expect(classifyContent(null, ESEDRE_SKILL_TEMPLATE, [])).toBe('MISSING');
  });

  it('classifies exact match as LATEST', () => {
    expect(classifyContent(ESEDRE_SKILL_TEMPLATE, ESEDRE_SKILL_TEMPLATE, [])).toBe('LATEST');
  });

  it('classifies historic default as HISTORIC_DEFAULT', () => {
    const text = 'historic default text';
    const historicHash = computeNormalizedHash(text);
    expect(classifyContent(text, ESEDRE_SKILL_TEMPLATE, [historicHash])).toBe('HISTORIC_DEFAULT');
  });

  it('classifies user-customized instructions as CUSTOMIZED', () => {
    const userContent = '# Custom User Notes\nDo not overwrite my custom instructions!';
    expect(classifyContent(userContent, ESEDRE_SKILL_TEMPLATE, [])).toBe('CUSTOMIZED');
  });

  it('configures workspace with .esedre directory, wrappers, and mcp config', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-configure-test-'));
    try {
      const res = configureWorkspace(tempDir, { projectCode: 'Core', allowedProjects: ['Prof', 'Esedre'] });

      expect(res.esedreJsonCreatedOrUpdated).toBe(true);
      expect(res.esedreJsonCreatedOrUpdated).toBe(true);
      expect(res.wrappersPlanted).toBe(true);
      expect(res.mcpConfigured).toBe(true);
      expect(res.skillConfigured).toBe(true);

      expect(fs.existsSync(path.join(tempDir, '.esedre', 'esedre.json'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.esedre', 'esedre.cmd'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.esedre', 'esedre.ps1'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.esedre', 'esedre'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.esedre', 'ese.cmd'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.esedre', 'ese.ps1'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.esedre', 'ese'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.agents', 'mcp_config.json'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.agents', 'skills', 'esedre', 'SKILL.md'))).toBe(true);

      const esedrePs1Content = fs.readFileSync(path.join(tempDir, '.esedre', 'esedre.ps1'), 'utf-8');
      expect(esedrePs1Content).toContain('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8');
      expect(esedrePs1Content).toContain('$OutputEncoding = [System.Text.Encoding]::UTF8');

      const esePs1Content = fs.readFileSync(path.join(tempDir, '.esedre', 'ese.ps1'), 'utf-8');
      expect(esePs1Content).toContain('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8');
      expect(esePs1Content).toContain('$OutputEncoding = [System.Text.Encoding]::UTF8');

      const esedreCmdContent = fs.readFileSync(path.join(tempDir, '.esedre', 'esedre.cmd'), 'utf-8');
      expect(esedreCmdContent).toContain('goto use_ese');
      expect(esedreCmdContent).toContain(':use_ese');
      expect(esedreCmdContent).toContain('call ese %*');
      expect(esedreCmdContent).toContain('call esedre %*');
      expect(esedreCmdContent).toContain('goto done');
      expect(esedreCmdContent).toContain('endlocal & exit /b %ERRORLEVEL%');
      expect(esedreCmdContent).not.toMatch(/\(\s*[^)]*goto\s+:?done/i);

      const eseCmdContent = fs.readFileSync(path.join(tempDir, '.esedre', 'ese.cmd'), 'utf-8');
      expect(eseCmdContent).toContain('call "%~dp0esedre.cmd" %*');
      expect(eseCmdContent).toContain('exit /b %ERRORLEVEL%');

      if (process.platform === 'win32') {
        const eseCmdPath = path.join(tempDir, '.esedre', 'ese.cmd');
        const output = child_process.execSync(`cmd.exe /c "${eseCmdPath}" --version`, {
          encoding: 'utf-8',
          windowsHide: true,
        });
        expect(output).not.toContain('The system cannot find the batch label specified');
        expect(output).toContain('esedre v');
      }
    } finally {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  it('upgrades legacy Windows CMD batch wrappers that had parenthesized goto blocks', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-legacy-wrapper-'));
    try {
      const esedreDir = path.join(tempDir, '.esedre');
      fs.mkdirSync(esedreDir, { recursive: true });

      // Plant legacy wrapper with compound parenthesized block containing goto :done
      const legacyCmd = `@echo off\r\nsetlocal\r\nif exist "%~dp0..\\esedre.json" (\r\n  echo legacy\r\n  goto :done\r\n)\r\n:done\r\nendlocal\r\n`;
      fs.writeFileSync(path.join(esedreDir, 'esedre.cmd'), legacyCmd, 'utf-8');
      fs.writeFileSync(path.join(esedreDir, 'ese.cmd'), `@echo off\r\ncall "%~dp0esedre.cmd" %*\r\n`, 'utf-8');

      // Configure / upgrade workspace
      configureWorkspace(tempDir, {
        projectCode: 'LEGACY',
        projectName: 'Legacy Project',
      });

      const updatedCmd = fs.readFileSync(path.join(esedreDir, 'esedre.cmd'), 'utf-8');
      expect(updatedCmd).not.toMatch(/\(\s*[^)]*goto\s+:?done/i);
      expect(updatedCmd).toContain('goto done');
      expect(updatedCmd).toContain(':done');
      expect(updatedCmd).toContain('endlocal & exit /b %ERRORLEVEL%');

      if (process.platform === 'win32') {
        const eseCmdPath = path.join(esedreDir, 'ese.cmd');
        const output = child_process.execSync(`cmd.exe /c "${eseCmdPath}" --version`, {
          encoding: 'utf-8',
          windowsHide: true,
        });
        expect(output).not.toContain('The system cannot find the batch label specified');
        expect(output).toContain('esedre v');
      }
    } finally {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });
});

