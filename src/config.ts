import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_ESEDRE_PORT = 5674;
export const MAX_PROJECT_CODE_LENGTH = 6;
export const PROJECT_CODE_REGEX = /^[a-zA-Z0-9]{1,6}$/;

export interface EsedreConfig {
  version?: string;
  projectCode?: string;
  allowedProjects?: string[];
  dataDir?: string | string[];
  serverUrl?: string;
  port?: number;
  projects?: Record<string, string>;
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
      error: `Project code '${trimmed}' is invalid. It must be 1 to ${MAX_PROJECT_CODE_LENGTH} alphanumeric characters (e.g. CORE, WEB, DOCS).`,
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

export interface DiscoveredConfig {
  config: EsedreConfig;
  configPath?: string | null;
  workspaceRoot: string;
}

export function findEsedreConfig(startDir?: string): DiscoveredConfig {
  let current = path.resolve(startDir || process.cwd());

  const candidates = [
    ['.esedre', 'esedre.json'],
    ['esedre.json'],
  ];

  while (true) {
    for (const segs of candidates) {
      const candidatePath = path.join(current, ...segs);
      if (fs.existsSync(candidatePath)) {
        try {
          const raw = fs.readFileSync(candidatePath, 'utf-8');
          const parsed = JSON.parse(raw) as EsedreConfig;
          return {
            config: parsed,
            configPath: candidatePath,
            workspaceRoot: current,
          };
        } catch (err: any) {
          throw new Error(`Failed to parse Esedre configuration at ${candidatePath}: ${err.message}`);
        }
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
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

export function migrateEsedreConfig(raw: any, targetVersion = '0.1.0'): EsedreConfig {
  const migrated: EsedreConfig = {
    version: targetVersion,
    projectCode: raw?.projectCode || undefined,
    allowedProjects: Array.isArray(raw?.allowedProjects) ? raw.allowedProjects : undefined,
    dataDir: Array.isArray(raw?.dataDir) ? raw.dataDir : (typeof raw?.dataDir === 'string' ? raw.dataDir : undefined),
    serverUrl: raw?.serverUrl,
    port: typeof raw?.port === 'number' ? raw.port : DEFAULT_ESEDRE_PORT,
    projects: typeof raw?.projects === 'object' && raw?.projects ? raw.projects : undefined,
  };
  return migrated;
}
