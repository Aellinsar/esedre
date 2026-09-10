import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  findEsedreConfig,
  readGlobalConfig,
  writeGlobalConfig,
  addLocationToGlobalConfig,
  removeLocationFromGlobalConfig,
  setGlobalConfigKey,
  getGlobalConfigKey,
  resolvePorts,
  getGlobalConfigPath,
  readGlobalVersion,
  writeGlobalVersion,
} from '../src/config.js';
import { CURRENT_ESEDRE_VERSION } from '../src/types.js';
import { initHub, initWorkspace } from '../src/upgrade.js';

describe('Central Configuration & Init Engine', () => {
  let tempRoot: string;
  let fakeGlobalDir: string;
  let originalGlobalEnv: string | undefined;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-central-test-'));
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

  it('initializes a new ticket data hub with projects.json and projects/ directory', () => {
    const hubDir = path.join(tempRoot, 'my-hub');
    const res = initHub(hubDir);

    expect(res.projectsJsonCreated).toBe(true);
    expect(res.projectsDirCreated).toBe(true);
    expect(fs.existsSync(path.join(hubDir, 'projects.json'))).toBe(true);
    expect(fs.existsSync(path.join(hubDir, 'projects'))).toBe(true);
  });

  it('smart-detects and adds a data hub to global configuration', () => {
    const hubDir = path.join(tempRoot, 'team-hub');
    initHub(hubDir);

    const addRes = addLocationToGlobalConfig(hubDir);
    expect(addRes.type).toBe('hub');

    const globalCfg = readGlobalConfig();
    expect(globalCfg).not.toBeNull();
    const resolvedNormalized = path.resolve(hubDir).replace(/\\/g, '/');
    expect(globalCfg?.dataDir).toBe(resolvedNormalized);
  });

  it('smart-detects and links an initialized project to global configuration', () => {
    const projDir = path.join(tempRoot, 'app-repo');
    fs.mkdirSync(projDir, { recursive: true });

    initWorkspace(projDir, {
      projectCode: 'ALCE',
      projectName: 'Alce Reader',
    });

    const addRes = addLocationToGlobalConfig(projDir);
    expect(addRes.type).toBe('project');
    if (addRes.type === 'project') {
      expect(addRes.code).toBe('ALCE');
    }

    const globalCfg = readGlobalConfig();
    expect(globalCfg?.projects?.['ALCE']).toBe(path.resolve(projDir).replace(/\\/g, '/'));
  });

  it('identifies uninitialized directories and returns uninitialized status', () => {
    const emptyDir = path.join(tempRoot, 'blank-repo');
    fs.mkdirSync(emptyDir, { recursive: true });

    const addRes = addLocationToGlobalConfig(emptyDir);
    expect(addRes.type).toBe('uninitialized');
    expect(addRes.path).toBe(path.resolve(emptyDir).replace(/\\/g, '/'));
  });

  it('removes projects and hubs from global configuration', () => {
    writeGlobalConfig({
      version: CURRENT_ESEDRE_VERSION,
      port: 5674,
      dataDir: ['C:/fake/hub1', 'C:/fake/hub2'],
      projects: {
        ALCE: 'C:/fake/alce',
        DOCS: 'C:/fake/docs',
      },
    });

    const rmProj = removeLocationFromGlobalConfig('ALCE');
    expect(rmProj.removed).toBe(true);
    expect(rmProj.type).toBe('project');

    const cfgAfterProj = readGlobalConfig();
    expect(cfgAfterProj?.projects?.['ALCE']).toBeUndefined();
    expect(cfgAfterProj?.projects?.['DOCS']).toBe('C:/fake/docs');

    const rmHub = removeLocationFromGlobalConfig('C:/fake/hub1');
    expect(rmHub.removed).toBe(true);
    expect(rmHub.type).toBe('hub');

    const cfgAfterHub = readGlobalConfig();
    expect(cfgAfterHub?.dataDir).toBe('C:/fake/hub2');
  });

  it('sets and updates individual global configuration keys with nested path support', () => {
    setGlobalConfigKey('port', '9999');
    expect(getGlobalConfigKey('port')).toBe(9999);

    setGlobalConfigKey('ports.gateway', '8000');
    setGlobalConfigKey('ports.ui', '8001');
    setGlobalConfigKey('ports.api', '8002');

    expect(getGlobalConfigKey('ports.gateway')).toBe(8000);
    expect(getGlobalConfigKey('ports.ui')).toBe(8001);
    expect(getGlobalConfigKey('ports.api')).toBe(8002);
    expect(getGlobalConfigKey('nonexistent')).toBeUndefined();
  });

  it('resolves ports with CLI override > local config > global config > default precedence', () => {
    // 1. Default fallback
    writeGlobalConfig({ version: CURRENT_ESEDRE_VERSION });
    const def = resolvePorts(null);
    expect(def.gateway).toBe(5674);
    expect(def.ui).toBe(5675);
    expect(def.api).toBe(5676);

    // 2. Global port setting
    writeGlobalConfig({ version: CURRENT_ESEDRE_VERSION, port: 5700 });
    const fromGlobal = resolvePorts(null);
    expect(fromGlobal.gateway).toBe(5700);
    expect(fromGlobal.ui).toBe(5701);
    expect(fromGlobal.api).toBe(5702);

    // 3. Local workspace config overrides global config
    const fromLocal = resolvePorts({ port: 5800 });
    expect(fromLocal.gateway).toBe(5800);
    expect(fromLocal.ui).toBe(5801);
    expect(fromLocal.api).toBe(5802);

    // 4. CLI flags override both local and global
    const fromCli = resolvePorts({ port: 5800 }, { port: 5900 });
    expect(fromCli.gateway).toBe(5900);
    expect(fromCli.ui).toBe(5901);
    expect(fromCli.api).toBe(5902);
  });

  it('inherits global machine settings (port) without polluting project workspace data topology', () => {
    writeGlobalConfig({
      version: CURRENT_ESEDRE_VERSION,
      dataDir: 'C:/central/esedre-data',
      port: 5699,
    });

    const workspace = path.join(tempRoot, 'local-project');
    const esedreDir = path.join(workspace, '.esedre');
    fs.mkdirSync(esedreDir, { recursive: true });
    fs.writeFileSync(
      path.join(esedreDir, 'esedre.json'),
      JSON.stringify({ projectCode: 'MYAPP' }),
      'utf-8'
    );

    const discovered = findEsedreConfig(workspace);
    expect(discovered.config.projectCode).toBe('MYAPP');
    expect(discovered.config.dataDir).toBeUndefined(); // preserves local topology isolation
    expect(discovered.config.port).toBe(5699);
  });

  it('falls back to global configuration when run outside any workspace', () => {
    writeGlobalConfig({
      version: CURRENT_ESEDRE_VERSION,
      dataDir: 'C:/central/esedre-data',
      projects: { CORE: 'C:/central/core' },
      port: 5674,
    });

    const emptyDir = path.join(tempRoot, 'random-folder');
    fs.mkdirSync(emptyDir, { recursive: true });

    const discovered = findEsedreConfig(emptyDir, { fallbackToGlobal: true });
    expect(discovered.configPath).toBe(getGlobalConfigPath());
    expect(discovered.config.dataDir).toBe('C:/central/esedre-data');
    expect(discovered.config.projects?.['CORE']).toBe('C:/central/core');
  });

  it('records and reads global version file (~/.esedre/version)', () => {
    writeGlobalVersion('0.1.6');
    expect(readGlobalVersion()).toBe('0.1.6');
  });
});
