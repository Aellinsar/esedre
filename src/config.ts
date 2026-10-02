import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CURRENT_ESEDRE_VERSION } from './types.js';

export const DEFAULT_ESEDRE_PORT = 5674;
export const MAX_PROJECT_CODE_LENGTH = 8;
export const PROJECT_CODE_REGEX = /^[a-zA-Z0-9]{1,8}$/;
export const MAX_PROJECT_NAME_LENGTH = 48;

export interface EsedrePortsConfig {
  gateway?: number;
  ui?: number;
  api?: number;
}

export interface EsedreConfig {
  version?: string;
  projectCode?: string;
  projectName?: string;
  allowedProjects?: string[];
  dataDir?: string | string[];
  serverUrl?: string;
  port?: number;
  ports?: EsedrePortsConfig;
  projects?: Record<string, string>;
}

export interface ResolvedPorts {
  gateway: number;
  ui: number;
  api: number;
}

export function resolvePorts(
  config?: EsedreConfig | null,
  overrides?: { port?: number; gatewayPort?: number; uiPort?: number; apiPort?: number; ports?: EsedrePortsConfig }
): ResolvedPorts {
  const globalConfig = readGlobalConfig();

  const gateway = overrides?.gatewayPort
    ?? overrides?.port
    ?? overrides?.ports?.gateway
    ?? config?.ports?.gateway
    ?? config?.port
    ?? globalConfig?.ports?.gateway
    ?? globalConfig?.port
    ?? DEFAULT_ESEDRE_PORT;

  const ui = overrides?.uiPort
    ?? overrides?.ports?.ui
    ?? config?.ports?.ui
    ?? globalConfig?.ports?.ui
    ?? (gateway + 1);

  const api = overrides?.apiPort
    ?? overrides?.ports?.api
    ?? config?.ports?.api
    ?? globalConfig?.ports?.api
    ?? (gateway + 2);

  return { gateway, ui, api };
}

export class EsedreAuthorizationError extends Error {
  constructor(public readonly projectCode: string, message?: string) {
    super(message || `Access Denied: Project '${projectCode}' is outside this workspace's authorized scope.`);
    this.name = 'EsedreAuthorizationError';
  }
}

export function validateProjectCode(
  code: string,
  existingCodes?: string[]
): { valid: boolean; error?: string } {
  if (!code || typeof code !== 'string') {
    return { valid: false, error: 'Project code is required.' };
  }
  const trimmed = code.trim();
  if (!PROJECT_CODE_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: `Project code '${trimmed}' is invalid. It must be 1 to ${MAX_PROJECT_CODE_LENGTH} alphanumeric characters (e.g. CORE, ALCE, WEB).`,
    };
  }
  if (existingCodes && existingCodes.length > 0) {
    const lower = trimmed.toLowerCase();
    const collision = existingCodes.find((c) => c.trim().toLowerCase() === lower);
    if (collision && collision !== trimmed) {
      return {
        valid: false,
        error: `Project code '${trimmed}' collides with existing project '${collision}' (case-insensitive).`,
      };
    }
  }
  return { valid: true };
}

export function validateProjectName(name: string): { valid: boolean; error?: string } {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Project name is required.' };
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Project name cannot be empty.' };
  }
  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) {
    return {
      valid: false,
      error: `Project name '${trimmed}' exceeds maximum length of ${MAX_PROJECT_NAME_LENGTH} characters.`,
    };
  }
  return { valid: true };
}

export function isProjectAuthorized(projectCode: string, allowedProjects?: string[]): boolean {
  if (!allowedProjects || allowedProjects.length === 0) {
    return true;
  }
  const normalizedList = allowedProjects.map((p) => p.trim().toUpperCase());
  if (normalizedList.includes('*')) {
    return true;
  }
  const normalized = projectCode.trim().toUpperCase();
  return normalizedList.includes(normalized);
}

export function getGlobalConfigDir(): string {
  if (process.env.ESEDRE_GLOBAL_DIR) {
    return process.env.ESEDRE_GLOBAL_DIR;
  }
  if (process.env.VITEST) {
    const testGlobalDir = path.join(os.tmpdir(), 'esedre-vitest-global');
    if (!fs.existsSync(testGlobalDir)) {
      try {
        fs.mkdirSync(testGlobalDir, { recursive: true });
      } catch {}
    }
    return testGlobalDir;
  }
  return path.join(os.homedir(), '.esedre');
}

export function getGlobalConfigPath(): string {
  return path.join(getGlobalConfigDir(), 'config.json');
}

export function expandHome(filePath: string): string {
  if (!filePath) return filePath;
  if (filePath === '~' || filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

export function readGlobalConfig(): EsedreConfig | null {
  const configPath = getGlobalConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as EsedreConfig;
  } catch {
    return null;
  }
}

export function writeGlobalConfig(config: EsedreConfig): void {
  const dir = getGlobalConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const configPath = getGlobalConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  try {
    writeGlobalVersion(config.version || CURRENT_ESEDRE_VERSION);
  } catch {}
}

export function getGlobalVersionPath(): string {
  return path.join(getGlobalConfigDir(), 'version');
}

export function readGlobalVersion(): string | null {
  const versionFile = getGlobalVersionPath();
  if (fs.existsSync(versionFile)) {
    try {
      return fs.readFileSync(versionFile, 'utf-8').trim();
    } catch {
      return null;
    }
  }
  return null;
}

export function writeGlobalVersion(version: string = CURRENT_ESEDRE_VERSION): void {
  const dir = getGlobalConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getGlobalVersionPath(), version.trim() + '\n', 'utf-8');
}

export type AddLocationResult =
  | { type: 'hub'; path: string; projectCount?: number }
  | { type: 'project'; code: string; name?: string; path: string }
  | { type: 'uninitialized'; path: string };

export function hubContainsProject(hubPath: string, projectCodes: string[]): boolean {
  if (!hubPath || !projectCodes || projectCodes.length === 0) return false;
  const resolved = path.resolve(expandHome(hubPath));

  // 1. Check projects/ directory entries
  const projectsDir = path.join(resolved, 'projects');
  if (fs.existsSync(projectsDir)) {
    try {
      const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
      const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name.toLowerCase());
      if (projectCodes.some((code) => dirNames.includes(code.trim().toLowerCase()))) {
        return true;
      }
    } catch {}
  }

  // 2. Check projects.json manifest
  const projectsJson = path.join(resolved, 'projects.json');
  if (fs.existsSync(projectsJson)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(projectsJson, 'utf-8'));
      if (Array.isArray(parsed)) {
        const pCodes = parsed.map((p: any) => (p.code || '').trim().toLowerCase());
        if (projectCodes.some((code) => pCodes.includes(code.trim().toLowerCase()))) {
          return true;
        }
      }
    } catch {}
  }

  return false;
}

export function addLocationToGlobalConfig(targetPath: string): AddLocationResult {
  const resolved = path.resolve(expandHome(targetPath));
  if (!fs.existsSync(resolved)) {
    throw new Error(`Target path does not exist: "${targetPath}" (resolved: ${resolved})`);
  }

  const current = readGlobalConfig() || { version: CURRENT_ESEDRE_VERSION, port: DEFAULT_ESEDRE_PORT };

  // 1. Check if it is a data hub: has projects/ subfolder or projects.json
  const hasProjectsDir = fs.existsSync(path.join(resolved, 'projects'));
  const hasProjectsJson = fs.existsSync(path.join(resolved, 'projects.json'));
  if (hasProjectsDir || hasProjectsJson) {
    let projectCount = 0;
    if (hasProjectsJson) {
      try {
        const pjs = JSON.parse(fs.readFileSync(path.join(resolved, 'projects.json'), 'utf-8'));
        if (Array.isArray(pjs)) projectCount = pjs.length;
      } catch {}
    } else if (hasProjectsDir) {
      try {
        projectCount = fs.readdirSync(path.join(resolved, 'projects')).filter((e) => {
          return fs.statSync(path.join(resolved, 'projects', e)).isDirectory();
        }).length;
      } catch {}
    }

    const currentDataDirs = Array.isArray(current.dataDir)
      ? current.dataDir
      : current.dataDir
      ? [current.dataDir]
      : [];

    const normalizedResolved = resolved.replace(/\\/g, '/');
    const existingIdx = currentDataDirs.findIndex(
      (d) => path.resolve(expandHome(d)).replace(/\\/g, '/') === normalizedResolved
    );

    if (existingIdx === -1) {
      currentDataDirs.push(normalizedResolved);
    }
    current.dataDir = currentDataDirs.length === 1 ? currentDataDirs[0] : currentDataDirs;
    writeGlobalConfig(current);
    return { type: 'hub', path: normalizedResolved, projectCount };
  }

  // 2. Check if it is an initialized project repo: has .esedre/esedre.json or project.json
  const inRepoConfig = path.join(resolved, '.esedre', 'esedre.json');
  const inRepoRootConfig = path.join(resolved, 'esedre.json');
  const inRepoProjectJson = path.join(resolved, '.esedre', 'project.json');
  const inRepoRootProjectJson = path.join(resolved, 'project.json');

  let code: string | undefined;
  let name: string | undefined;

  for (const cand of [inRepoConfig, inRepoRootConfig, inRepoProjectJson, inRepoRootProjectJson]) {
    if (fs.existsSync(cand)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(cand, 'utf-8'));
        if (parsed.projectCode) code = parsed.projectCode;
        if (parsed.code && !code) code = parsed.code;
        if (parsed.projectName) name = parsed.projectName;
        if (parsed.name && !name) name = parsed.name;
        if (code) break;
      } catch {}
    }
  }

  if (code) {
    const normalizedCode = code.toUpperCase();
    const normalizedResolved = resolved.replace(/\\/g, '/');
    if (!current.projects) {
      current.projects = {};
    }
    current.projects[normalizedCode] = normalizedResolved;
    writeGlobalConfig(current);
    return { type: 'project', code: normalizedCode, name, path: normalizedResolved };
  }

  // 3. Uninitialized directory
  return { type: 'uninitialized', path: resolved.replace(/\\/g, '/') };
}

export function removeLocationFromGlobalConfig(identifier: string): { removed: boolean; type?: string; target?: string } {
  const current = readGlobalConfig();
  if (!current) return { removed: false };

  const trimmed = identifier.trim();
  const normalizedId = trimmed.toUpperCase();

  // Check projects map by code
  if (current.projects && current.projects[normalizedId]) {
    const target = current.projects[normalizedId];
    delete current.projects[normalizedId];
    if (Object.keys(current.projects).length === 0) {
      delete current.projects;
    }
    writeGlobalConfig(current);
    return { removed: true, type: 'project', target };
  }

  // Check projects map by path
  if (current.projects) {
    for (const [code, p] of Object.entries(current.projects)) {
      if (path.resolve(expandHome(p)).toLowerCase() === path.resolve(expandHome(trimmed)).toLowerCase()) {
        delete current.projects[code];
        if (Object.keys(current.projects).length === 0) {
          delete current.projects;
        }
        writeGlobalConfig(current);
        return { removed: true, type: 'project', target: p };
      }
    }
  }

  // Check dataDir
  if (current.dataDir) {
    const currentDataDirs = Array.isArray(current.dataDir) ? current.dataDir : [current.dataDir];
    const initialLen = currentDataDirs.length;
    const remaining = currentDataDirs.filter((d) => {
      const matchPath = path.resolve(expandHome(d)).toLowerCase() === path.resolve(expandHome(trimmed)).toLowerCase();
      const matchBasename = path.basename(d).toLowerCase() === trimmed.toLowerCase();
      return !matchPath && !matchBasename;
    });
    if (remaining.length !== initialLen) {
      current.dataDir = remaining.length === 0 ? undefined : (remaining.length === 1 ? remaining[0] : remaining);
      writeGlobalConfig(current);
      return { removed: true, type: 'hub', target: trimmed };
    }
  }

  return { removed: false };
}

export function getGlobalConfigKey(key: string): any {
  const current = readGlobalConfig();
  if (!current) return undefined;
  if (key.includes('.')) {
    const parts = key.split('.');
    let val: any = current;
    for (const part of parts) {
      if (val === undefined || val === null) return undefined;
      val = val[part];
    }
    return val;
  }
  return (current as any)[key];
}

export function setGlobalConfigKey(key: string, value: any): { key: string; value: any } {
  const current = readGlobalConfig() || { version: CURRENT_ESEDRE_VERSION, port: DEFAULT_ESEDRE_PORT };
  let parsedValue = value;
  if ((key === 'port' || key.endsWith('.port') || key.startsWith('ports.')) && typeof value === 'string') {
    const num = parseInt(value, 10);
    if (!isNaN(num)) parsedValue = num;
  }
  if (key.includes('.')) {
    const parts = key.split('.');
    let obj: any = current;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]] || typeof obj[parts[i]] !== 'object') {
        obj[parts[i]] = {};
      }
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = parsedValue;
  } else {
    (current as any)[key] = parsedValue;
  }
  writeGlobalConfig(current);
  return { key, value: parsedValue };
}

export interface DiscoveredConfig {
  config: EsedreConfig;
  configPath?: string | null;
  workspaceRoot: string;
}

export interface FindConfigOptions {
  fallbackToGlobal?: boolean;
}

export function findEsedreConfig(startDir?: string, options?: FindConfigOptions): DiscoveredConfig {
  let current = path.resolve(startDir || process.cwd());

  const candidates = [
    ['.esedre', 'esedre.json'],
    ['esedre.json'],
  ];

  let localConfig: EsedreConfig | null = null;
  let localConfigPath: string | null = null;
  let localWorkspaceRoot = current;

  while (true) {
    for (const segs of candidates) {
      const candidatePath = path.join(current, ...segs);
      if (fs.existsSync(candidatePath)) {
        try {
          const raw = fs.readFileSync(candidatePath, 'utf-8');
          localConfig = JSON.parse(raw) as EsedreConfig;
          localConfigPath = candidatePath;
          localWorkspaceRoot = current;
          break;
        } catch (err: any) {
          throw new Error(`Failed to parse Esedre configuration at ${candidatePath}: ${err.message}`);
        }
      }
    }
    if (localConfig) break;

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  const globalConfig = readGlobalConfig();

  if (localConfig) {
    // If local config omitted dataDir, check if centrally registered dataDir hubs contain this project
    let inheritedDataDir = localConfig.dataDir;
    if (inheritedDataDir === undefined && globalConfig?.dataDir) {
      const targetCodes = [
        ...(localConfig.projectCode ? [localConfig.projectCode] : []),
        ...(Array.isArray(localConfig.allowedProjects) ? localConfig.allowedProjects : []),
      ].filter((c) => c && c !== '*');

      const globalDirs = Array.isArray(globalConfig.dataDir)
        ? globalConfig.dataDir
        : [globalConfig.dataDir];

      const matchesGlobalHub = globalDirs.some((d) => hubContainsProject(d, targetCodes));
      if (matchesGlobalHub) {
        inheritedDataDir = globalConfig.dataDir;
      }
    }

    // Local workspace configuration takes precedence; only inherit machine defaults (port/ports) or matching central dataDir
    const merged: EsedreConfig = {
      ...localConfig,
      dataDir: inheritedDataDir,
      port: localConfig.port !== undefined ? localConfig.port : (globalConfig?.port || DEFAULT_ESEDRE_PORT),
      ports: localConfig.ports || globalConfig?.ports,
    };
    return {
      config: merged,
      configPath: localConfigPath,
      workspaceRoot: localWorkspaceRoot,
    };
  }

  // If fallbackToGlobal is requested, check if current directory or any ancestor contains standalone in-repo ticket or project markers
  if (options?.fallbackToGlobal) {
    let checkDir = path.resolve(startDir || process.cwd());
    let hasInRepoMarkers = false;
    let inRepoRoot = checkDir;

    while (true) {
      const candidateMarkers = [
        path.join(checkDir, '.esedre', 'tickets'),
        path.join(checkDir, 'tickets'),
        path.join(checkDir, 'src', 'data', 'planning', 'tickets'),
        path.join(checkDir, '.esedre', 'projects.json'),
        path.join(checkDir, '.esedre', 'project.json'),
        path.join(checkDir, 'projects.json'),
        path.join(checkDir, 'project.json'),
        path.join(checkDir, 'src', 'data', 'planning', 'projects.json'),
        path.join(checkDir, 'src', 'data', 'planning', 'projects', 'projects.json'),
      ];
      if (candidateMarkers.some((m) => fs.existsSync(m))) {
        hasInRepoMarkers = true;
        inRepoRoot = checkDir;
        break;
      }
      const parent = path.dirname(checkDir);
      if (parent === checkDir) break;
      checkDir = parent;
    }

    if (!hasInRepoMarkers && globalConfig && (globalConfig.dataDir || globalConfig.projects || globalConfig.port || globalConfig.projectCode)) {
      return {
        config: globalConfig,
        configPath: getGlobalConfigPath(),
        workspaceRoot: process.cwd(),
      };
    }
  }

  return {
    config: {},
    configPath: null,
    workspaceRoot: process.cwd(),
  };
}

export interface GitIgnoreCheckResult {
  exists: boolean;
  hasSnapshotIgnored: boolean;
  gitignorePath: string;
}

export function checkGitIgnore(workspaceRoot: string): GitIgnoreCheckResult {
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    return {
      exists: false,
      hasSnapshotIgnored: false,
      gitignorePath,
    };
  }
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    const lines = content.split(/\r?\n/).map((l) => l.trim());
    const hasSnapshotIgnored = lines.some(
      (l) =>
        l === '.esedre/snapshot.json' ||
        l === '/.esedre/snapshot.json' ||
        l === 'snapshot.json' ||
        l === '.esedre/*.json'
    );
    return {
      exists: true,
      hasSnapshotIgnored,
      gitignorePath,
    };
  } catch {
    return {
      exists: true,
      hasSnapshotIgnored: false,
      gitignorePath,
    };
  }
}

export function appendSnapshotToGitIgnore(workspaceRoot: string): boolean {
  const check = checkGitIgnore(workspaceRoot);
  if (check.hasSnapshotIgnored) return false;

  const entry = '\n# Esedre ticket local snapshot (read-only projection)\n.esedre/snapshot.json\n';
  try {
    if (check.exists) {
      fs.appendFileSync(check.gitignorePath, entry, 'utf-8');
    } else {
      fs.writeFileSync(check.gitignorePath, entry.trimStart(), 'utf-8');
    }
    return true;
  } catch {
    return false;
  }
}

export function migrateEsedreConfig(raw: any, targetVersion = CURRENT_ESEDRE_VERSION): EsedreConfig {
  const migrated: EsedreConfig = {
    version: targetVersion,
    projectCode: raw?.projectCode || undefined,
    projectName: raw?.projectName || undefined,
    allowedProjects: Array.isArray(raw?.allowedProjects) ? raw.allowedProjects : undefined,
    dataDir: Array.isArray(raw?.dataDir) ? raw.dataDir : (typeof raw?.dataDir === 'string' ? raw.dataDir : undefined),
    serverUrl: raw?.serverUrl,
    port: typeof raw?.port === 'number' && raw.port !== DEFAULT_ESEDRE_PORT ? raw.port : undefined,
    ports: typeof raw?.ports === 'object' && raw?.ports ? raw.ports : undefined,
    projects: typeof raw?.projects === 'object' && raw?.projects ? raw.projects : undefined,
  };
  return migrated;
}
