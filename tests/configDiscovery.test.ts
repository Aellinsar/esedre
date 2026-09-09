import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  findEsedreConfig,
  isProjectAuthorized,
  EsedreConfig,
  validateProjectCode,
  DEFAULT_ESEDRE_PORT,
  MAX_PROJECT_CODE_LENGTH,
  checkGitIgnore,
  appendSnapshotToGitIgnore,
} from '../src/config.js';

describe('Esedre Config Discovery & Hierarchy Crawl', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-discovery-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(rootDir)) {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('discovers .esedre/esedre.json in workspace', () => {
    const esedreDir = path.join(rootDir, '.esedre');
    fs.mkdirSync(esedreDir, { recursive: true });
    fs.writeFileSync(
      path.join(esedreDir, 'esedre.json'),
      JSON.stringify({ projectCode: 'Core', version: '0.1.0' })
    );

    const result = findEsedreConfig(rootDir);
    expect(result.config?.projectCode).toBe('Core');
    expect(result.config?.version).toBe('0.1.0');
    expect(result.configPath).toBe(path.join(esedreDir, 'esedre.json'));
    expect(result.workspaceRoot).toBe(rootDir);
  });

  it('falls back to root esedre.json when subfolder configs are absent', () => {
    const configData: EsedreConfig = {
      projectCode: 'Core',
      allowedProjects: ['Core', 'Esedre'],
    };
    fs.writeFileSync(path.join(rootDir, 'esedre.json'), JSON.stringify(configData));

    const result = findEsedreConfig(rootDir);
    expect(result.config).not.toBeNull();
    expect(result.config?.projectCode).toBe('Core');
    expect(result.config?.allowedProjects).toEqual(['Core', 'Esedre']);
    expect(result.configPath).toBe(path.join(rootDir, 'esedre.json'));
    expect(result.workspaceRoot).toBe(rootDir);
  });

  it('crawls up directory hierarchy and stops at the nearest configuration', () => {
    const subprojectDir = path.join(rootDir, 'subproject');
    const nestedDir = path.join(subprojectDir, 'src', 'components');
    fs.mkdirSync(nestedDir, { recursive: true });

    const subEsedreDir = path.join(subprojectDir, '.esedre');
    fs.mkdirSync(subEsedreDir, { recursive: true });

    fs.writeFileSync(
      path.join(rootDir, 'esedre.json'),
      JSON.stringify({ projectCode: 'Root', allowedProjects: ['Root'] })
    );
    fs.writeFileSync(
      path.join(subEsedreDir, 'esedre.json'),
      JSON.stringify({ projectCode: 'Sub', allowedProjects: ['Sub'] })
    );

    const result = findEsedreConfig(nestedDir);
    expect(result.config).not.toBeNull();
    expect(result.config?.projectCode).toBe('Sub');
    expect(result.config?.allowedProjects).toEqual(['Sub']);
    expect(result.configPath).toBe(path.join(subEsedreDir, 'esedre.json'));
    expect(result.workspaceRoot).toBe(subprojectDir);
  });

  it('handles missing configuration cleanly without crashing', () => {
    const deepDir = path.join(rootDir, 'alpha', 'beta');
    fs.mkdirSync(deepDir, { recursive: true });

    const result = findEsedreConfig(deepDir);
    expect(result.config).toEqual({});
    expect(result.configPath).toBeNull();
    expect(result.workspaceRoot).toBeDefined();
  });

  it('throws descriptive error on malformed configuration', () => {
    fs.writeFileSync(path.join(rootDir, 'esedre.json'), '{ broken_json: invalid !!!');

    expect(() => findEsedreConfig(rootDir)).toThrow(/Failed to parse Esedre configuration/);
  });
});

describe('Project Code Validation & Constants', () => {
  it('enforces 5674 as default Esedre port and 6 as max code length', () => {
    expect(DEFAULT_ESEDRE_PORT).toBe(5674);
    expect(MAX_PROJECT_CODE_LENGTH).toBe(6);
  });

  it('accepts valid 1 to 6 alphanumeric project codes', () => {
    expect(validateProjectCode('Core').valid).toBe(true);
    expect(validateProjectCode('Esedre').valid).toBe(true);
    expect(validateProjectCode('Web').valid).toBe(true);
    expect(validateProjectCode('Docs').valid).toBe(true);
    expect(validateProjectCode('A').valid).toBe(true);
    expect(validateProjectCode('123456').valid).toBe(true);
  });

  it('rejects invalid project codes longer than 6 chars or containing special characters', () => {
    expect(validateProjectCode('TOOLONG7').valid).toBe(false);
    expect(validateProjectCode('EIGHT888').valid).toBe(false);
    expect(validateProjectCode('P-1').valid).toBe(false);
    expect(validateProjectCode('').valid).toBe(false);
  });

  it('detects case-insensitive project collisions', () => {
    const existing = ['Core', 'Esedre', 'Web'];
    expect(validateProjectCode('core', existing).valid).toBe(false);
    expect(validateProjectCode('ESEDRE', existing).valid).toBe(false);
    expect(validateProjectCode('web', existing).valid).toBe(false);
    expect(validateProjectCode('Docs', existing).valid).toBe(true);
  });
});

describe('Gitignore Helper Functions', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-gitignore-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('checks if .esedre/snapshot.json is ignored and appends if missing', () => {
    expect(checkGitIgnore(tempDir).hasSnapshotIgnored).toBe(false);

    const appended = appendSnapshotToGitIgnore(tempDir);
    expect(appended).toBe(true);

    const checkAfter = checkGitIgnore(tempDir);
    expect(checkAfter.hasSnapshotIgnored).toBe(true);

    // Second append is a no-op
    expect(appendSnapshotToGitIgnore(tempDir)).toBe(false);
  });
});

describe('isProjectAuthorized Security Utility', () => {
  it('permits all projects when allowedProjects is undefined', () => {
    expect(isProjectAuthorized('Core', undefined)).toBe(true);
    expect(isProjectAuthorized('Web', undefined)).toBe(true);
    expect(isProjectAuthorized('Esedre', undefined)).toBe(true);
  });

  it('permits all projects when wildcard "*" is in allowedProjects', () => {
    expect(isProjectAuthorized('Core', ['*'])).toBe(true);
    expect(isProjectAuthorized('SECRET', ['*'])).toBe(true);
  });

  it('strictly blocks projects outside allowedProjects list', () => {
    const allowed = ['Core', 'Esedre'];
    expect(isProjectAuthorized('Core', allowed)).toBe(true);
    expect(isProjectAuthorized('Esedre', allowed)).toBe(true);
    expect(isProjectAuthorized('Web', allowed)).toBe(false);
  });

  it('performs case-insensitive project code matching', () => {
    const allowed = ['core', 'esedre'];
    expect(isProjectAuthorized('Core', allowed)).toBe(true);
    expect(isProjectAuthorized('Esedre', allowed)).toBe(true);
    expect(isProjectAuthorized('Web', allowed)).toBe(false);
  });
});
