import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { SecurityFilter } from '../src/securityFilter.js';
import {
  findEsedreConfig,
  readGlobalConfig,
  writeGlobalConfig,
  addLocationToGlobalConfig,
} from '../src/config.js';
import { initWorkspace, initHub } from '../src/upgrade.js';

describe('Project Binding & End-to-End Workflow', () => {
  let tempRoot: string;
  let fakeGlobalDir: string;
  let originalGlobalEnv: string | undefined;
  const cliPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-workflow-test-'));
    fakeGlobalDir = path.join(tempRoot, 'global-store');
    fs.mkdirSync(fakeGlobalDir, { recursive: true });

    originalGlobalEnv = process.env.ESEDRE_GLOBAL_DIR;
    process.env.ESEDRE_GLOBAL_DIR = fakeGlobalDir;
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

  function runCli(args: string[], cwd: string): { stdout: string; json: () => any } {
    const stdout = execFileSync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: 'utf-8',
      env: {
        ...process.env,
        ESEDRE_GLOBAL_DIR: fakeGlobalDir,
      },
    });
    return {
      stdout,
      json: () => JSON.parse(stdout),
    };
  }

  it('initializes a sample new project and binds it to central Esedre configuration', () => {
    const sampleDir = path.join(tempRoot, 'sample-app');
    fs.mkdirSync(sampleDir, { recursive: true });

    // Simulate existing project package.json
    fs.writeFileSync(
      path.join(sampleDir, 'package.json'),
      JSON.stringify({
        name: 'sample-app',
        version: '1.0.0',
        description: 'A sample new application to bind to Esedre',
      }, null, 2) + '\n',
      'utf-8'
    );

    // 1. Bring sample project online with ese init
    const initRes = runCli(
      ['init', '--project', 'SAMPL', '--name', 'Sample App', '--no-mcp', '--no-proxy', '-y'],
      sampleDir
    );
    expect(initRes.stdout).toContain('Esedre workspace initialized successfully');
    expect(initRes.stdout).toContain('Registered new project \'SAMPL\' (Sample App) in Esedre');

    // Verify local footprint
    const localCfgPath = path.join(sampleDir, '.esedre', 'esedre.json');
    expect(fs.existsSync(localCfgPath)).toBe(true);
    const localCfg = JSON.parse(fs.readFileSync(localCfgPath, 'utf-8'));
    expect(localCfg.projectCode).toBe('SAMPL');
    expect(localCfg.projectName).toBe('Sample App');

    // 2. Bind the sample project to central configuration
    const addRes = runCli(['configure', 'add', sampleDir], tempRoot);
    expect(addRes.stdout).toContain('Linked in ~/.esedre/config.json -> projects.SAMPL');

    const centralCfg = readGlobalConfig();
    expect(centralCfg?.projects?.['SAMPL']).toBe(path.resolve(sampleDir).replace(/\\/g, '/'));
  });

  it('supports sequential ticket creation, updates, plans, and comments on a newly bound project', () => {
    const sampleDir = path.join(tempRoot, 'sample-service');
    fs.mkdirSync(sampleDir, { recursive: true });

    initWorkspace(sampleDir, {
      projectCode: 'SERV',
      projectName: 'Sample Service',
    });

    addLocationToGlobalConfig(sampleDir);

    // 1. Create first ticket in sample project (should get ID 1)
    const create1 = runCli(
      ['create', '--title', 'Setup project dependencies', '--type', 'Platform', '--json'],
      sampleDir
    ).json();

    expect(create1.meta.id).toBe(1);
    expect(create1.meta.title).toBe('Setup project dependencies');
    expect(create1.meta.status).toBe('Planned');
    expect(create1.projectDescriptor.code).toBe('SERV');

    // 2. Create second ticket (should get ID 2)
    const create2 = runCli(
      ['create', '--title', 'Implement health check endpoint', '--type', 'Feature', '--json'],
      sampleDir
    ).json();

    expect(create2.meta.id).toBe(2);
    expect(create2.meta.title).toBe('Implement health check endpoint');

    // 2b. Create third ticket with inline --detail markdown (Ticket #27)
    const create3 = runCli(
      ['create', '--title', 'User authentication with OAuth', '--type', 'Feature', '--detail', '1. Setup Passport\n2. Add GitHub OAuth', '--json'],
      sampleDir
    ).json();

    expect(create3.meta.id).toBe(3);
    expect(create3.detail.breakdown).toContain('Setup Passport');
    expect(create3.detail.breakdown).toContain('Add GitHub OAuth');

    // 2c. Create fourth ticket with external specification --file (Ticket #27)
    const specFile = path.join(sampleDir, 'rate-limit-spec.md');
    fs.writeFileSync(specFile, '### Summary\nRate limiting middleware\n\n### Feature Breakdown\n1. Token bucket algorithm\n2. Redis store\n', 'utf-8');
    const create4 = runCli(
      ['create', '--title', 'Rate limiting middleware', '--type', 'Platform', '--file', specFile, '--json'],
      sampleDir
    ).json();

    expect(create4.meta.id).toBe(4);
    expect(create4.detail.summary).toBe('Rate limiting middleware');
    expect(create4.detail.breakdown).toContain('Token bucket algorithm');
    expect(create4.detail.breakdown).toContain('Redis store');

    // Verify nonexistent --file throws error
    expect(() => {
      runCli(
        ['create', '--title', 'Failing ticket', '--file', 'nonexistent-spec-file.md', '--json'],
        sampleDir
      );
    }).toThrow();

    // 3. List tickets scoped to the project
    const list = runCli(['list', '--json'], sampleDir).json();
    expect(list).toHaveLength(4);
    expect(list[0].id).toBe(1);
    expect(list[1].id).toBe(2);
    expect(list[2].id).toBe(3);
    expect(list[3].id).toBe(4);

    // 4. Update ticket status using both numeric and compound keys
    const update1 = runCli(
      ['update', '1', '--status', 'In Development', '--json'],
      sampleDir
    ).json();
    expect(update1.meta.status).toBe('In Development');

    const update2 = runCli(
      ['update', 'SERV-2', '--status', 'Completed', '--json'],
      sampleDir
    ).json();
    expect(update2.meta.status).toBe('Completed');

    // 5. Update and inspect implementation plan
    const planSaveRes = runCli(
      ['plan', 'SERV-1', '--set', '## Technical Approach\n1. Add Express router\n2. Add test suite', '--json'],
      sampleDir
    ).json();
    expect(planSaveRes.success).toBe(true);
    expect(planSaveRes.ticketId).toBe('SERV-1');
    expect(planSaveRes.project).toBe('SERV');
    expect(planSaveRes.planMarkdown).toContain('Add Express router');
    expect(planSaveRes.sha1).toBeDefined();

    const plan1 = runCli(['plan', '1', '--json'], sampleDir).json();
    expect(plan1.planMarkdown).toContain('Add Express router');

    // 6. Append comments using compound and numeric lookup
    const comment1 = runCli(
      ['comment', 'SERV-1', '--text', 'Verified endpoint with unit tests.', '--author', 'LLMAgent', '--json'],
      sampleDir
    ).json();
    expect(comment1.author).toBe('LLMAgent');
    expect(comment1.text).toBe('Verified endpoint with unit tests.');

    const comment2 = runCli(
      ['comment', '1', '-p', 'SERV', '--text', 'Ready for code review.', '--author', 'LeadDev', '--json'],
      sampleDir
    ).json();
    expect(comment2.author).toBe('LeadDev');

    // Positional comment syntax without --text flag (paving the desire path)
    const comment3 = runCli(
      ['comment', '1', 'Positional comment without flag', '--json'],
      sampleDir
    ).json();
    expect(comment3.text).toBe('Positional comment without flag');

    // 7. Get ticket detail and verify comments
    const get1 = runCli(['get', 'SERV-1', '--json'], sampleDir).json();
    expect(get1.comments).toHaveLength(3);
    expect(get1.comments[0].text).toContain('Verified endpoint');
    expect(get1.comments[1].text).toContain('Ready for code review');
    expect(get1.comments[2].text).toBe('Positional comment without flag');
  }, 15000);

  it('operates across multiple bound projects from central configuration with --project overrides', () => {
    // Create Project A
    const projADir = path.join(tempRoot, 'project-alpha');
    initWorkspace(projADir, { projectCode: 'ALPH', projectName: 'Alpha Service' });

    // Create Project B
    const projBDir = path.join(tempRoot, 'project-beta');
    initWorkspace(projBDir, { projectCode: 'BETA', projectName: 'Beta Web' });

    // Bind both projects to central config
    addLocationToGlobalConfig(projADir);
    addLocationToGlobalConfig(projBDir);

    // From outside any specific repo (central runner), mint tickets into each bound project
    const alphaTicket1 = runCli(
      ['create', '--project', 'ALPH', '--title', 'Alpha Foundation', '--type', 'Platform', '--json'],
      tempRoot
    ).json();
    expect(alphaTicket1.meta.id).toBe(1);
    expect(alphaTicket1.meta.project).toBe('ALPH');

    const betaTicket1 = runCli(
      ['create', '--project', 'BETA', '--title', 'Beta Frontend UI', '--type', 'Feature', '--json'],
      tempRoot
    ).json();
    expect(betaTicket1.meta.id).toBe(1); // Starts at #1 independently
    expect(betaTicket1.meta.project).toBe('BETA');

    // Cross-project query from central runner
    const alphaTickets = runCli(['list', '--project', 'ALPH', '--json'], tempRoot).json();
    expect(alphaTickets).toHaveLength(1);
    expect(alphaTickets[0].title).toBe('Alpha Foundation');

    const betaTickets = runCli(['list', '--project', 'BETA', '--json'], tempRoot).json();
    expect(betaTickets).toHaveLength(1);
    expect(betaTickets[0].title).toBe('Beta Frontend UI');

    // All-projects query
    const allTickets = runCli(['list', '--project', 'all', '--json'], tempRoot).json();
    expect(allTickets).toHaveLength(2);

    // Cross-project update using compound key
    const updatedAlpha = runCli(
      ['update', 'ALPH-1', '--status', 'Completed', '--json'],
      tempRoot
    ).json();
    expect(updatedAlpha.meta.status).toBe('Completed');

    // Cross-project plan using -p flag
    const betaPlanSet = runCli(
      ['plan', '1', '-p', 'BETA', '--set', '## Beta UI Plan', '--json'],
      tempRoot
    ).json();
    expect(betaPlanSet.success).toBe(true);
    expect(betaPlanSet.project).toBe('BETA');

    const betaPlan = runCli(['plan', 'BETA-1', '--json'], tempRoot).json();
    expect(betaPlan.planMarkdown).toBe('## Beta UI Plan');
  }, 15000);

  it('manages newly added sample projects in an in-workspace monorepo (Topology 6)', async () => {
    const monorepoDir = path.join(tempRoot, 'my-monorepo');
    const projectsDir = path.join(monorepoDir, 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });

    // Seed existing Core app
    const coreDir = path.join(projectsDir, 'Core');
    fs.mkdirSync(path.join(coreDir, 'tickets', '1'), { recursive: true });
    fs.writeFileSync(
      path.join(coreDir, 'project.json'),
      JSON.stringify({ id: 1, code: 'Core', name: 'Core Engine' }, null, 2) + '\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(coreDir, 'tickets', '1', 'meta.json'),
      JSON.stringify({ id: 1, title: 'Core Boot', type: 'Platform', status: 'Completed' }, null, 2) + '\n',
      'utf-8'
    );

    // Auto-detect monorepo topology with zero config
    const adapter = new FilesystemStorageAdapter(monorepoDir, {});

    // Dynamically register a new sample project in the monorepo
    const registered = await adapter.registerProject({
      code: 'SAMPLE',
      name: 'Sample Microservice',
      description: 'Newly bound sample project in monorepo',
    });
    expect(registered.code).toBe('SAMPLE');
    expect(registered.name).toBe('Sample Microservice');

    // Verify projects list now includes both Core and SAMPLE
    const projs = await adapter.getProjects();
    expect(projs.map((p) => p.code).sort()).toEqual(['Core', 'SAMPLE']);

    // Create ticket in the new sample project
    const newTicket = await adapter.createTicket({
      title: 'Sample Initial Task',
      type: 'Feature',
      projectCode: 'SAMPLE',
    });
    expect(newTicket.meta.id).toBe(1); // Starts at #1
    expect(newTicket.meta.project).toBe('SAMPLE');

    // Verify isolation: Core still has 1 ticket, SAMPLE has 1 ticket
    const coreTickets = await adapter.listTickets({ project: 'Core' });
    expect(coreTickets).toHaveLength(1);
    expect(coreTickets[0].meta.title).toBe('Core Boot');

    const sampleTickets = await adapter.listTickets({ project: 'SAMPLE' });
    expect(sampleTickets).toHaveLength(1);
    expect(sampleTickets[0].meta.title).toBe('Sample Initial Task');

    // Update and comment on the new sample project ticket
    const updated = await adapter.updateTicket('SAMPLE-1', { status: 'In Development' });
    expect(updated.meta.status).toBe('In Development');

    const comment = await adapter.addComment('SAMPLE-1', {
      author: 'LLMCodingPartner',
      text: 'Verified ticket operations in monorepo.',
    });
    expect(comment.author).toBe('LLMCodingPartner');
  });
});
