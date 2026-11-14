import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CURRENT_ESEDRE_VERSION, GitSyncConfig } from './types.js';

export type { GitSyncConfig };

export const DEFAULT_ESEDRE_PORT = 5674;
export const MAX_PROJECT_CODE_LENGTH = 8;
export const PROJECT_CODE_REGEX = /^[a-zA-Z0-9]{1,8}$/;
export const MAX_PROJECT_NAME_LENGTH = 48;

export const DEFAULT_GIT_SYNC_CONFIG: Required<GitSyncConfig> = {
  enabled: false,
  remote: 'origin',
  branch: 'main',
  push: true,
  pullOnStart: true,
  debounceSeconds: 5,
  intervalMinutes: 15,
};

export const GIT_REMOTE_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
export const GIT_BRANCH_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/;

export function validateGitRemoteName(remote: string): string {
  const clean = typeof remote === 'string' ? remote.trim() : '';
  if (!clean || clean.startsWith('-') || clean.includes('..') || !GIT_REMOTE_NAME_REGEX.test(clean)) {
    throw new Error(
      `Invalid Git remote name '${remote}'. Remote must be a named Git remote (1-64 alphanumeric, '.', '_', or '-' characters, not starting with '-').`
    );
  }
  return clean;
}

export function validateGitBranchName(branch: string): string {
  const clean = typeof branch === 'string' ? branch.trim() : '';
  if (
    !clean ||
    clean.startsWith('-') ||
    clean.endsWith('/') ||
    clean.endsWith('.lock') ||
    clean.includes('..') ||
    clean.includes('@{') ||
    clean.includes('//') ||
    !GIT_BRANCH_NAME_REGEX.test(clean)
  ) {
    throw new Error(
      `Invalid Git branch name '${branch}'. Branch must be a valid Git ref name (1-128 alphanumeric, '.', '_', '-', or '/' characters, not starting with '-').`
    );
  }
  return clean;
}

export function resolveGitSyncConfig(config?: EsedreConfig | null): Required<GitSyncConfig> {
  const globalCfg = readGlobalConfig();
  const raw: GitSyncConfig = {
    ...(globalCfg?.sync || {}),
    ...(config?.sync || {}),
  };
  const debounce =
    typeof raw.debounceSeconds === 'number' && !Number.isNaN(raw.debounceSeconds)
      ? Math.min(Math.max(0, Math.round(raw.debounceSeconds)), 300)
      : DEFAULT_GIT_SYNC_CONFIG.debounceSeconds;
  const interval =
    typeof raw.intervalMinutes === 'number' && !Number.isNaN(raw.intervalMinutes)
      ? Math.min(Math.max(0, Math.round(raw.intervalMinutes)), 1440)
      : DEFAULT_GIT_SYNC_CONFIG.intervalMinutes;
  let safeRemote = DEFAULT_GIT_SYNC_CONFIG.remote;
  if (raw.remote && typeof raw.remote === 'string') {
    try {
      safeRemote = validateGitRemoteName(raw.remote);
    } catch {}
  }
  let safeBranch = DEFAULT_GIT_SYNC_CONFIG.branch;
  if (raw.branch && typeof raw.branch === 'string') {
    try {
      safeBranch = validateGitBranchName(raw.branch);
    } catch {}
  }
  return {
    enabled: Boolean(raw.enabled ?? DEFAULT_GIT_SYNC_CONFIG.enabled),
    remote: safeRemote,
    branch: safeBranch,
    push: raw.push !== undefined ? Boolean(raw.push) : DEFAULT_GIT_SYNC_CONFIG.push,
    pullOnStart: raw.pullOnStart !== undefined ? Boolean(raw.pullOnStart) : DEFAULT_GIT_SYNC_CONFIG.pullOnStart,
    debounceSeconds: debounce,
    intervalMinutes: interval,
  };
}

export interface EsedrePortsConfig {
  gateway?: number;
  ui?: number;
  api?: number;
}

export interface RemoteServerConfig {
  host?: string;
  timeoutMs?: number;
  corsOrigins?: string[];
}

export interface EsedreConfig {
  version?: string;
  projectCode?: string;
  projectName?: string;
  allowedProjects?: string[];
  dataDir?: string | string[];
  serverUrl?: string;
  server?: RemoteServerConfig;
  remotes?: Record<string, string>;
  sync?: GitSyncConfig;
  port?: number;
  ports?: EsedrePortsConfig;
  projects?: Record<string, string>;
  defaultAuthor?: string;
}

export function normalizeRemoteHostUrl(raw?: string | null): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower === 'none' || lower === 'null' || lower === 'false' || lower === 'clear') {
    return undefined;
  }
  if (lower === 'local') {
    return 'local';
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const withoutSuffix = withProtocol
    .replace(/\/+$/, '')
    .replace(/\/(?:api(?:\/planning)?|app)$/i, '');
  try {
    const parsed = new URL(withoutSuffix);
    if (
      parsed.protocol === 'http:' &&
      !parsed.port &&
      (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed.hostname) || parsed.hostname === 'localhost')
    ) {
      parsed.port = String(DEFAULT_ESEDRE_PORT);
    }
    return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, ''));
  } catch {
    return withoutSuffix;
  }
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

if (process.env.VITEST && !process.env.ESEDRE_VITEST_GLOBAL_DIR) {
  process.env.ESEDRE_VITEST_GLOBAL_DIR = path.join(os.tmpdir(), `esedre-vitest-global-${process.pid}`);
}

export function getGlobalConfigDir(): string {
  if (process.env.ESEDRE_GLOBAL_DIR) {
    return process.env.ESEDRE_GLOBAL_DIR;
  }
  if (process.env.VITEST) {
    const testGlobalDir =
      process.env.ESEDRE_VITEST_GLOBAL_DIR || path.join(os.tmpdir(), `esedre-vitest-global-${process.pid}`);
    process.env.ESEDRE_VITEST_GLOBAL_DIR = testGlobalDir;
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

export function resolveConfiguredCorsOrigins(config?: EsedreConfig | null): string[] {
  const origins = new Set<string>();

  const addAll = (list?: string[] | null) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed) origins.add(trimmed);
      }
    }
  };

  if (process.env.ESEDRE_CORS_ORIGINS) {
    addAll(process.env.ESEDRE_CORS_ORIGINS.split(','));
  }

  addAll(config?.server?.corsOrigins);
  addAll(readGlobalConfig()?.server?.corsOrigins);

  return Array.from(origins);
}

export function readGlobalConfig(): EsedreConfig | null {
  const configPath = getGlobalConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, '');
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
  const rawResolved = path.resolve(expandHome(targetPath));
  const resolved = fs.existsSync(rawResolved) ? rawResolved : fs.existsSync(rawResolved.normalize('NFC')) ? rawResolved.normalize('NFC') : fs.existsSync(rawResolved.normalize('NFD')) ? rawResolved.normalize('NFD') : rawResolved;
  if (!fs.existsSync(resolved)) {
    throw new Error(`Target path does not exist: "${targetPath}" (resolved: ${resolved})`);
  }

  const current = readGlobalConfig() || { version: CURRENT_ESEDRE_VERSION, port: DEFAULT_ESEDRE_PORT };

  // 1. Inspect workspace/project descriptors first so a project repo with a 'projects/' folder is not misclassified as a data hub
  const inRepoConfig = path.join(resolved, '.esedre', 'esedre.json');
  const inRepoRootConfig = path.join(resolved, 'esedre.json');
  const inRepoProjectJson = path.join(resolved, '.esedre', 'project.json');
  const inRepoRootProjectJson = path.join(resolved, 'project.json');

  let code: string | undefined;
  let name: string | undefined;
  let hasWorkspaceProjectCode = false;

  for (const cand of [inRepoConfig, inRepoRootConfig, inRepoProjectJson, inRepoRootProjectJson]) {
    if (fs.existsSync(cand)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(cand, 'utf-8'));
        if (parsed.projectCode) {
          code = String(parsed.projectCode).trim();
          hasWorkspaceProjectCode = true;
        }
        if (parsed.code && !code) code = String(parsed.code).trim();
        if (parsed.projectName) name = parsed.projectName;
        if (parsed.name && !name) name = parsed.name;
        if (code) break;
      } catch {}
    }
  }

  // 2. Check if it is a data hub: has projects.json, or has projects/ subfolder without a workspace projectCode
  const hasProjectsDir = fs.existsSync(path.join(resolved, 'projects'));
  const hasProjectsJson = fs.existsSync(path.join(resolved, 'projects.json'));
  if (hasProjectsJson || (hasProjectsDir && !hasWorkspaceProjectCode)) {
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

    const normalizedResolved = resolved.normalize('NFC').replace(/\\/g, '/');
    const existingIdx = currentDataDirs.findIndex(
      (d) => (process.platform === 'win32' || process.platform === 'darwin' ? path.resolve(expandHome(d)).normalize('NFC').replace(/\\/g, '/').toLowerCase() === normalizedResolved.toLowerCase() : path.resolve(expandHome(d)).normalize('NFC').replace(/\\/g, '/') === normalizedResolved)
    );

    if (existingIdx === -1) {
      currentDataDirs.push(normalizedResolved);
    }
    current.dataDir = currentDataDirs.length === 1 ? currentDataDirs[0] : currentDataDirs;
    writeGlobalConfig(current);
    return { type: 'hub', path: normalizedResolved, projectCount };
  }

  // 3. Register as an initialized project repo if code was discovered
  if (code) {
    const canonicalCode = code.trim();
    const normalizedResolved = resolved.normalize('NFC').replace(/\\/g, '/');
    if (!current.projects) {
      current.projects = {};
    }
    for (const existingKey of Object.keys(current.projects)) {
      if (existingKey.toLowerCase() === canonicalCode.toLowerCase() && existingKey !== canonicalCode) {
        delete current.projects[existingKey];
      }
    }
    current.projects[canonicalCode] = normalizedResolved;
    writeGlobalConfig(current);
    return { type: 'project', code: canonicalCode, name, path: normalizedResolved };
  }

  // 4. Uninitialized directory
  return { type: 'uninitialized', path: resolved.replace(/\\/g, '/') };
}

export function removeLocationFromGlobalConfig(identifier: string): { removed: boolean; type?: string; target?: string } {
  const current = readGlobalConfig();
  if (!current) return { removed: false };

  const trimmed = identifier.trim();

  if (trimmed.toLowerCase() === 'sync' || trimmed.toLowerCase().startsWith('sync.')) {
    if (!current.sync) return { removed: false };
    setGlobalConfigKey(trimmed, null);
    return { removed: true, type: 'sync', target: trimmed };
  }

  // Check projects map by code (case-insensitive)
  if (current.projects) {
    const matchedKey = Object.keys(current.projects).find(
      (k) => k.toLowerCase() === trimmed.toLowerCase()
    );
    if (matchedKey) {
      const target = current.projects[matchedKey];
      delete current.projects[matchedKey];
      if (Object.keys(current.projects).length === 0) {
        delete current.projects;
      }
      writeGlobalConfig(current);
      return { removed: true, type: 'project', target };
    }
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

const CANONICAL_DOT_KEYS: Record<string, string> = {
  'sync.enabled': 'sync.enabled',
  'sync.remote': 'sync.remote',
  'sync.branch': 'sync.branch',
  'sync.push': 'sync.push',
  'sync.pullonstart': 'sync.pullOnStart',
  'sync.debounceseconds': 'sync.debounceSeconds',
  'sync.intervalminutes': 'sync.intervalMinutes',
  'server.host': 'server.host',
  'server.port': 'server.port',
  'server.timeoutms': 'server.timeoutMs',
};

function normalizeGlobalConfigKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  const lower = trimmed.toLowerCase();
  if (CANONICAL_DOT_KEYS[lower]) {
    return CANONICAL_DOT_KEYS[lower];
  }
  return trimmed;
}

export function getGlobalConfigKey(rawKey: string): any {
  const key = normalizeGlobalConfigKey(rawKey);
  const current = readGlobalConfig();
  if (!current) return undefined;
  if (key.startsWith('remotes.') && current.remotes) {
    const code = key.slice('remotes.'.length).trim();
    const matched = Object.keys(current.remotes).find((k) => k.toLowerCase() === code.toLowerCase());
    return matched ? current.remotes[matched] : undefined;
  }
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

export function setGlobalConfigKey(rawKey: string, value: any): { key: string; value: any } {
  const key = normalizeGlobalConfigKey(rawKey);
  const current = readGlobalConfig() || { version: CURRENT_ESEDRE_VERSION, port: DEFAULT_ESEDRE_PORT };
  const isClear =
    value === null ||
    value === undefined ||
    (typeof value === 'string' && ['none', 'null', ''].includes(value.trim().toLowerCase()));

  if (isClear) {
    if (key.startsWith('remotes.')) {
      const code = key.slice('remotes.'.length).trim();
      if (current.remotes) {
        for (const existingKey of Object.keys(current.remotes)) {
          if (existingKey.toLowerCase() === code.toLowerCase()) {
            delete current.remotes[existingKey];
          }
        }
        if (Object.keys(current.remotes).length === 0) {
          delete current.remotes;
        }
      }
    } else if (key.includes('.')) {
      const parts = key.split('.');
      let obj: any = current;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!obj || typeof obj !== 'object') break;
        obj = obj[parts[i]];
      }
      if (obj && typeof obj === 'object') {
        delete obj[parts[parts.length - 1]];
      }
      if (parts[0] === 'server' && current.server && Object.keys(current.server).length === 0) {
        delete current.server;
      }
      if (parts[0] === 'sync' && current.sync && Object.keys(current.sync).length === 0) {
        delete current.sync;
      }
    } else {
      delete (current as any)[key];
    }
    writeGlobalConfig(current);
    return { key, value: null };
  }

  let parsedValue = value;
  const lowerKey = key.toLowerCase();
  if (lowerKey === 'sync.enabled' || lowerKey === 'sync.push' || lowerKey === 'sync.pullonstart') {
    if (typeof value === 'boolean') {
      parsedValue = value;
    } else if (typeof value === 'number') {
      parsedValue = value !== 0;
    } else if (typeof value === 'string') {
      const norm = value.trim().toLowerCase();
      if (norm === 'true' || norm === '1' || norm === 'yes' || norm === 'on') {
        parsedValue = true;
      } else if (norm === 'false' || norm === '0' || norm === 'no' || norm === 'off') {
        parsedValue = false;
      } else {
        throw new Error(`Invalid boolean value '${value}' for '${key}'. Expected true or false.`);
      }
    }
  } else if (lowerKey === 'sync.remote') {
    parsedValue = validateGitRemoteName(String(value));
  } else if (lowerKey === 'sync.branch') {
    parsedValue = validateGitBranchName(String(value));
  } else if (lowerKey === 'sync.debounceseconds' || lowerKey === 'sync.intervalminutes') {
    const num = typeof value === 'number' ? value : parseInt(String(value).trim(), 10);
    if (Number.isNaN(num) || num < 0) {
      throw new Error(`Invalid numeric value '${value}' for '${key}'. Expected a non-negative integer.`);
    }
    parsedValue =
      lowerKey === 'sync.debounceseconds'
        ? Math.min(Math.max(0, Math.round(num)), 300)
        : Math.min(Math.max(0, Math.round(num)), 1440);
  } else if (
    (key === 'port' || key.endsWith('.port') || key.startsWith('ports.') || key === 'server.timeoutMs') &&
    typeof value === 'string'
  ) {
    const num = parseInt(value, 10);
    if (!isNaN(num)) parsedValue = num;
  } else if (
    (key === 'server.host' || key === 'serverUrl' || key.startsWith('remotes.')) &&
    typeof value === 'string'
  ) {
    parsedValue = normalizeRemoteHostUrl(value) ?? value;
  }

  if (key.startsWith('remotes.')) {
    const code = key.slice('remotes.'.length).trim();
    if (!current.remotes || typeof current.remotes !== 'object') {
      current.remotes = {};
    }
    for (const existingKey of Object.keys(current.remotes)) {
      if (existingKey.toLowerCase() === code.toLowerCase() && existingKey !== code) {
        delete current.remotes[existingKey];
      }
    }
    current.remotes[code] = parsedValue;
  } else if (key.includes('.')) {
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

export function updateGlobalGitSyncConfig(updates: Record<string, any>): Required<GitSyncConfig> {
  if (!updates || typeof updates !== 'object') {
    throw new Error('Invalid Git sync configuration payload.');
  }

  const allowedKeys: Array<keyof GitSyncConfig> = [
    'enabled',
    'remote',
    'branch',
    'push',
    'pullOnStart',
    'debounceSeconds',
    'intervalMinutes',
  ];

  for (const field of allowedKeys) {
    if (updates[field] === undefined) continue;
    const rawVal = updates[field];
    if (field === 'remote' || field === 'branch') {
      if (typeof rawVal !== 'string' || !rawVal.trim()) {
        throw new Error(`Invalid value for 'sync.${field}'. Expected a non-empty string.`);
      }
      setGlobalConfigKey(`sync.${field}`, rawVal.trim());
    } else {
      setGlobalConfigKey(`sync.${field}`, rawVal);
    }
  }

  return resolveGitSyncConfig(readGlobalConfig());
}


export interface DiscoveredConfig {
  config: EsedreConfig;
  localConfig?: EsedreConfig | null;
  configPath?: string | null;
  workspaceRoot: string;
  isGlobalFallback?: boolean;
}

export interface FindConfigOptions {
  fallbackToGlobal?: boolean;
}

export function isSelfContainedLocalWorkspace(
  workspaceRoot: string,
  localConfig?: EsedreConfig | null
): boolean {
  const absRoot = path.resolve(workspaceRoot);
  if (localConfig?.dataDir) {
    const dirs = Array.isArray(localConfig.dataDir) ? localConfig.dataDir : [localConfig.dataDir];
    for (const d of dirs) {
      if (typeof d !== 'string' || !d.trim()) continue;
      const resolved = path.resolve(absRoot, expandHome(d.trim()));
      const rel = path.relative(absRoot, resolved);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        return true;
      }
    }
  }
  const inRepoTicketDirs = [
    path.join(absRoot, '.esedre', 'tickets'),
    path.join(absRoot, 'tickets'),
    path.join(absRoot, 'src', 'data', 'planning', 'tickets'),
  ];
  return inRepoTicketDirs.some((dir) => {
    if (!fs.existsSync(dir)) return false;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      return entries.some((e) => e.isDirectory() && /^\d+$/.test(e.name));
    } catch {
      return false;
    }
  });
}

export function resolveRemoteHost(
  discovered: DiscoveredConfig,
  options?: { hostFlag?: string; projectCode?: string }
): string | undefined {
  // Tier 1: Runtime CLI flag (--host) or ESEDRE_HOST environment variable
  const rawOverride = options?.hostFlag ?? process.env.ESEDRE_HOST;
  if (rawOverride !== undefined && String(rawOverride).trim() !== '') {
    const norm = normalizeRemoteHostUrl(String(rawOverride));
    if (!norm || norm === 'local') {
      return undefined;
    }
    return norm;
  }

  const globalConfig = readGlobalConfig();
  const localConfig = discovered.localConfig ?? (discovered.isGlobalFallback ? null : discovered.config);
  const targetCode = (
    options?.projectCode ||
    localConfig?.projectCode ||
    discovered.config?.projectCode ||
    ''
  ).trim();

  // Tier 2: Per-project remote mapping in workspace or ~/.esedre/config.json
  if (targetCode && targetCode.toLowerCase() !== 'all') {
    const lowerTarget = targetCode.toLowerCase();
    const remoteSources = [localConfig?.remotes, globalConfig?.remotes];
    for (const source of remoteSources) {
      if (source && typeof source === 'object') {
        const matchedKey = Object.keys(source).find((k) => k.toLowerCase() === lowerTarget);
        if (matchedKey && source[matchedKey]) {
          const norm = normalizeRemoteHostUrl(source[matchedKey]);
          if (!norm || norm === 'local') {
            return undefined;
          }
          return norm;
        }
      }
    }

    if (globalConfig?.projects && typeof globalConfig.projects === 'object') {
      const matchedProjKey = Object.keys(globalConfig.projects).find(
        (k) => k.toLowerCase() === lowerTarget
      );
      if (matchedProjKey) {
        const val = globalConfig.projects[matchedProjKey];
        if (typeof val === 'string' && /^https?:\/\//i.test(val.trim())) {
          return normalizeRemoteHostUrl(val);
        }
      }
    }
  }

  // Tier 3: Self-contained local project precedence (.esedre/tickets/ or explicit local dataDir)
  if (!discovered.isGlobalFallback && isSelfContainedLocalWorkspace(discovered.workspaceRoot, localConfig)) {
    return undefined;
  }

  // Tier 4: Workspace .esedre/esedre.json server.host / serverUrl (for shared intranet repos)
  const localHostRaw = localConfig?.server?.host || localConfig?.serverUrl;
  if (localHostRaw) {
    const normLocal = normalizeRemoteHostUrl(localHostRaw);
    if (!normLocal || normLocal === 'local') {
      return undefined;
    }
    const hasGlobalRemote = Boolean(globalConfig?.server?.host || globalConfig?.serverUrl);
    if (!hasGlobalRemote && globalConfig?.dataDir && targetCode) {
      const globalDirs = Array.isArray(globalConfig.dataDir)
        ? globalConfig.dataDir
        : [globalConfig.dataDir];
      if (globalDirs.some((d) => hubContainsProject(d, [targetCode]))) {
        return undefined;
      }
    }
    return normLocal;
  }

  // Tier 5: Global default server.host / serverUrl in ~/.esedre/config.json
  const globalHostRaw = globalConfig?.server?.host || globalConfig?.serverUrl;
  if (globalHostRaw) {
    const normGlobal = normalizeRemoteHostUrl(globalHostRaw);
    if (normGlobal && normGlobal !== 'local') {
      return normGlobal;
    }
  }

  return undefined;
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
          const raw = fs.readFileSync(candidatePath, 'utf-8').replace(/^\uFEFF/, '');
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

    const effectiveAllowed =
      Array.isArray(localConfig.allowedProjects) && localConfig.allowedProjects.length > 0
        ? localConfig.allowedProjects
        : localConfig.projectCode
          ? [localConfig.projectCode]
          : undefined;

    const hasExternalAllowedProjects = Boolean(
      effectiveAllowed &&
        effectiveAllowed.some(
          (code) =>
            code === '*' ||
            !localConfig?.projectCode ||
            code.trim().toLowerCase() !== localConfig.projectCode.trim().toLowerCase()
        )
    );

    const hasRemoteHostConfigured = Boolean(
      localConfig.server?.host ||
        localConfig.serverUrl ||
        globalConfig?.server?.host ||
        globalConfig?.serverUrl ||
        localConfig.remotes ||
        globalConfig?.remotes
    );

    let inheritedProjects = localConfig.projects;
    if (
      (inheritedDataDir !== undefined || hasExternalAllowedProjects || hasRemoteHostConfigured) &&
      globalConfig?.projects &&
      typeof globalConfig.projects === 'object'
    ) {
      const filteredGlobal: Record<string, string> = {};
      for (const [code, rawPath] of Object.entries(globalConfig.projects)) {
        if (!code || typeof rawPath !== 'string' || !rawPath.trim()) continue;
        if (!isProjectAuthorized(code, effectiveAllowed)) continue;
        if (/^https?:\/\//i.test(rawPath.trim())) {
          filteredGlobal[code] = rawPath.trim();
          continue;
        }
        const resolvedRepoPath = path.resolve(expandHome(rawPath));
        if (!fs.existsSync(resolvedRepoPath)) continue;
        filteredGlobal[code] = rawPath;
      }
      if (localConfig.projects && typeof localConfig.projects === 'object') {
        for (const [localCode, localPath] of Object.entries(localConfig.projects)) {
          for (const existingKey of Object.keys(filteredGlobal)) {
            if (existingKey.toLowerCase() === localCode.toLowerCase() && existingKey !== localCode) {
              delete filteredGlobal[existingKey];
            }
          }
          filteredGlobal[localCode] = localPath;
        }
      }
      if (Object.keys(filteredGlobal).length > 0) {
        inheritedProjects = filteredGlobal;
      }
    }

    const mergedRemotes =
      globalConfig?.remotes || localConfig.remotes
        ? { ...(globalConfig?.remotes || {}), ...(localConfig.remotes || {}) }
        : undefined;

    const mergedSync =
      globalConfig?.sync || localConfig.sync
        ? { ...(globalConfig?.sync || {}), ...(localConfig.sync || {}) }
        : undefined;

    // Local workspace configuration takes precedence; only inherit machine defaults (port/ports/server/remotes), matching central dataDir, or authorized global projects
    const merged: EsedreConfig = {
      ...localConfig,
      dataDir: inheritedDataDir,
      projects: inheritedProjects,
      server: localConfig.server || globalConfig?.server,
      serverUrl: localConfig.serverUrl || globalConfig?.serverUrl,
      remotes: mergedRemotes,
      sync: mergedSync,
      port: localConfig.port !== undefined ? localConfig.port : (globalConfig?.port || DEFAULT_ESEDRE_PORT),
      ports: localConfig.ports || globalConfig?.ports,
    };
    return {
      config: merged,
      localConfig,
      configPath: localConfigPath,
      workspaceRoot: localWorkspaceRoot,
      isGlobalFallback: false,
    };
  }

  // If fallbackToGlobal is requested, check if current directory or any ancestor contains standalone in-repo ticket or project markers
  if (options?.fallbackToGlobal) {
    let checkDir = path.resolve(startDir || process.cwd());
    let hasInRepoMarkers = false;

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
        break;
      }
      const parent = path.dirname(checkDir);
      if (parent === checkDir) break;
      checkDir = parent;
    }

    if (
      !hasInRepoMarkers &&
      globalConfig &&
      (globalConfig.dataDir ||
        globalConfig.projects ||
        globalConfig.port ||
        globalConfig.projectCode ||
        globalConfig.server?.host ||
        globalConfig.serverUrl ||
        globalConfig.remotes)
    ) {
      return {
        config: globalConfig,
        localConfig: null,
        configPath: getGlobalConfigPath(),
        workspaceRoot: process.cwd(),
        isGlobalFallback: true,
      };
    }
  }

  return {
    config: {},
    localConfig: null,
    configPath: null,
    workspaceRoot: process.cwd(),
    isGlobalFallback: true,
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
    server: typeof raw?.server === 'object' && raw?.server ? raw.server : undefined,
    remotes: typeof raw?.remotes === 'object' && raw?.remotes ? raw.remotes : undefined,
    sync: typeof raw?.sync === 'object' && raw?.sync ? raw.sync : undefined,
    port: typeof raw?.port === 'number' && raw.port !== DEFAULT_ESEDRE_PORT ? raw.port : undefined,
    ports: typeof raw?.ports === 'object' && raw?.ports ? raw.ports : undefined,
    projects: typeof raw?.projects === 'object' && raw?.projects ? raw.projects : undefined,
    defaultAuthor: typeof raw?.defaultAuthor === 'string' && raw.defaultAuthor.trim() ? raw.defaultAuthor.trim() : undefined,
  };
  return migrated;
}

