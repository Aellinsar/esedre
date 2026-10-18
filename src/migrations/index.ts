import fs from 'node:fs';
import path from 'node:path';
import { ProjectDescriptor, CURRENT_ESEDRE_VERSION } from '../types.js';
import type { FilesystemStorageAdapter, ResolvedProjectLocation } from '../storage/filesystem.js';
import {
  CURRENT_DATA_VERSION,
  MIN_SUPPORTED_DATA_VERSION,
  FEATURE_MIN_SCHEMA_VERSION,
  type FeatureSchemaRequirement,
  compareVersions,
  isValidVersion,
  normalizeVersion,
} from './versions.js';
import {
  EsedreVersionError,
  type EsedreVersionErrorInit,
  type VersionIncompatibilityReason,
  type CompatibilityCheckOptions,
  type ProjectCompatibilityStatus,
  getProjectSchemaVersion,
  checkProjectCompatibility,
  assertProjectCompatible,
} from './compatibility.js';
import { createProjectMigrationBackup, type ProjectBackupInput } from './backup.js';

export {
  CURRENT_DATA_VERSION,
  MIN_SUPPORTED_DATA_VERSION,
  FEATURE_MIN_SCHEMA_VERSION,
  compareVersions,
  isValidVersion,
  normalizeVersion,
  EsedreVersionError,
  getProjectSchemaVersion,
  checkProjectCompatibility,
  assertProjectCompatible,
  createProjectMigrationBackup,
};

export type {
  FeatureSchemaRequirement,
  EsedreVersionErrorInit,
  VersionIncompatibilityReason,
  CompatibilityCheckOptions,
  ProjectCompatibilityStatus,
  ProjectBackupInput,
};

export interface StorageMigrationContext {
  projectCode: string;
  projectDir: string;
  ticketsDir: string;
  sourceType: 'hub' | 'in-repo' | 'federated';
  hubDir?: string;
  project: ProjectDescriptor;
  storage: FilesystemStorageAdapter;
}

export interface StorageMigration {
  version: string;
  description: string;
  migrate: (ctx: StorageMigrationContext) => Promise<void> | void;
}

/**
 * Sequential registry of Esedre storage schema migrations.
 * Sorted in ascending SemVer order by version.
 */
export const MIGRATIONS: StorageMigration[] = [];

export interface ResolvedProjectMetadataPaths {
  projectDir: string;
  projectJsonPath: string;
  projectsListPaths: string[];
}

export function resolveProjectMetadataPaths(
  loc: ResolvedProjectLocation,
  workspaceRoot: string
): ResolvedProjectMetadataPaths {
  if (loc.sourceType === 'hub') {
    const projectDir = loc.isSharedDir && loc.hubDir ? loc.hubDir : path.dirname(loc.ticketsDir);
    const projectJsonPath = path.join(projectDir, 'project.json');
    const projectsListPaths: string[] = [];
    if (loc.hubDir) {
      projectsListPaths.push(
        path.join(loc.hubDir, 'projects.json'),
        path.join(loc.hubDir, 'projects', 'projects.json')
      );
    }
    return { projectDir, projectJsonPath, projectsListPaths };
  }

  const ticketsParent = path.dirname(loc.ticketsDir);
  const isDotEsedre = path.basename(ticketsParent) === '.esedre';
  const repoRoot = isDotEsedre ? path.dirname(ticketsParent) : (loc.sourceType === 'in-repo' ? workspaceRoot : ticketsParent);
  const dotEsedreDir = path.join(repoRoot, '.esedre');
  const projectDir = fs.existsSync(dotEsedreDir) || isDotEsedre ? dotEsedreDir : ticketsParent;

  const pJsonCandidates = [
    path.join(projectDir, 'project.json'),
    path.join(dotEsedreDir, 'project.json'),
    path.join(repoRoot, 'project.json'),
  ];
  const existingPJson = pJsonCandidates.find((p) => fs.existsSync(p));
  const projectJsonPath = existingPJson || path.join(projectDir, 'project.json');

  const projectsListPaths = [
    path.join(projectDir, 'projects.json'),
    path.join(dotEsedreDir, 'projects.json'),
    path.join(repoRoot, 'projects.json'),
  ];

  return { projectDir, projectJsonPath, projectsListPaths };
}

export interface RunProjectMigrationsOptions {
  migrations?: StorageMigration[];
  targetDataVersion?: string;
  backupRootDir?: string;
  dryRun?: boolean;
  forceStamp?: boolean;
}

export interface ProjectMigrationResult {
  projectCode: string;
  projectDir: string;
  sourceType: 'hub' | 'in-repo' | 'federated';
  previousSchemaVersion: string;
  currentSchemaVersion: string;
  esedreVersion: string;
  appliedMigrations: Array<{ version: string; description: string }>;
  stampedFilesCount: number;
  backupPath?: string;
  alreadyUpToDate: boolean;
}

/**
 * Execute pending storage schema migrations and stamp schemaVersion + esedreVersion
 * for a single resolved project location.
 */
export async function runProjectMigrations(
  loc: ResolvedProjectLocation,
  storage: FilesystemStorageAdapter,
  options: RunProjectMigrationsOptions = {}
): Promise<ProjectMigrationResult> {
  const targetDataVersion = normalizeVersion(options.targetDataVersion, CURRENT_DATA_VERSION);
  const allMigrations = [...(options.migrations ?? MIGRATIONS)].sort((a, b) =>
    compareVersions(a.version, b.version)
  );
  const paths = resolveProjectMetadataPaths(loc, storage.getWorkspaceRoot());

  let diskProjectJson: Partial<ProjectDescriptor> | null = null;
  if (fs.existsSync(paths.projectJsonPath)) {
    try {
      diskProjectJson = JSON.parse(fs.readFileSync(paths.projectJsonPath, 'utf-8'));
    } catch {}
  }

  const wasStampedOnDisk = Boolean(diskProjectJson?.schemaVersion || loc.project.schemaVersion);
  const previousSchemaVersion = getProjectSchemaVersion(diskProjectJson || loc.project);

  // Forward version guard: never allow an older CLI to downgrade a newer project schema
  if (compareVersions(previousSchemaVersion, targetDataVersion) > 0) {
    throw new EsedreVersionError({
      projectCode: loc.project.code,
      currentSchemaVersion: previousSchemaVersion,
      requiredSchemaVersion: targetDataVersion,
      reason: 'ABOVE_CURRENT_ENGINE',
    });
  }

  const pendingMigrations = allMigrations.filter(
    (m) =>
      compareVersions(m.version, previousSchemaVersion) > 0 &&
      compareVersions(m.version, targetDataVersion) <= 0
  );

  // Check if any tickets in ticketsDir are missing schemaVersion or on an older schemaVersion
  let unstampedTicketDirs: string[] = [];
  if (fs.existsSync(loc.ticketsDir)) {
    try {
      const entries = fs.readdirSync(loc.ticketsDir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const metaPath = path.join(loc.ticketsDir, ent.name, 'meta.json');
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            if (
              !meta.schemaVersion ||
              compareVersions(normalizeVersion(meta.schemaVersion, '1.0.0'), targetDataVersion) < 0
            ) {
              unstampedTicketDirs.push(metaPath);
            }
          } catch {}
        }
      }
    } catch {}
  }

  const needsProjectStamp =
    !wasStampedOnDisk ||
    compareVersions(previousSchemaVersion, targetDataVersion) < 0 ||
    Boolean(options.forceStamp);

  if (pendingMigrations.length === 0 && !needsProjectStamp && unstampedTicketDirs.length === 0) {
    return {
      projectCode: loc.project.code,
      projectDir: paths.projectDir,
      sourceType: loc.sourceType,
      previousSchemaVersion,
      currentSchemaVersion: previousSchemaVersion,
      esedreVersion: diskProjectJson?.esedreVersion || loc.project.esedreVersion || CURRENT_ESEDRE_VERSION,
      appliedMigrations: [],
      stampedFilesCount: 0,
      alreadyUpToDate: true,
    };
  }

  let backupPath: string | undefined;
  const appliedMigrations: Array<{ version: string; description: string }> = [];
  let stampedFilesCount = 0;

  if (!options.dryRun) {
    if (pendingMigrations.length > 0) {
      backupPath = createProjectMigrationBackup({
        projectCode: loc.project.code,
        projectDir: paths.projectDir,
        ticketsDir: loc.ticketsDir,
        fromVersion: previousSchemaVersion,
        toVersion: targetDataVersion,
        hubDir: loc.hubDir,
        backupRootDir: options.backupRootDir,
      });
    }

    const ctx: StorageMigrationContext = {
      projectCode: loc.project.code,
      projectDir: paths.projectDir,
      ticketsDir: loc.ticketsDir,
      sourceType: loc.sourceType,
      hubDir: loc.hubDir,
      project: loc.project,
      storage,
    };

    for (const migration of pendingMigrations) {
      await migration.migrate(ctx);
      appliedMigrations.push({
        version: migration.version,
        description: migration.description,
      });
    }

    // Re-read project.json in case a migration step modified it, then stamp schemaVersion + esedreVersion
    let latestPJson: Record<string, any> = {};
    if (fs.existsSync(paths.projectJsonPath)) {
      try {
        latestPJson = JSON.parse(fs.readFileSync(paths.projectJsonPath, 'utf-8'));
      } catch {}
    }

    const updatedProjectDesc: ProjectDescriptor = {
      ...loc.project,
      ...latestPJson,
      id: latestPJson.id ?? loc.project.id,
      code: latestPJson.code ?? loc.project.code,
      name: latestPJson.name ?? loc.project.name,
      description: latestPJson.description ?? loc.project.description,
      schemaVersion: targetDataVersion,
      esedreVersion: CURRENT_ESEDRE_VERSION,
    };

    if (!fs.existsSync(path.dirname(paths.projectJsonPath))) {
      fs.mkdirSync(path.dirname(paths.projectJsonPath), { recursive: true });
    }
    fs.writeFileSync(paths.projectJsonPath, JSON.stringify(updatedProjectDesc, null, 2) + '\n', 'utf-8');
    stampedFilesCount++;
    loc.project.schemaVersion = targetDataVersion;
    loc.project.esedreVersion = CURRENT_ESEDRE_VERSION;

    // Also synchronize hub projects.json if present
    for (const listPath of paths.projectsListPaths) {
      if (fs.existsSync(listPath)) {
        try {
          const arr: ProjectDescriptor[] = JSON.parse(fs.readFileSync(listPath, 'utf-8'));
          if (Array.isArray(arr)) {
            const idx = arr.findIndex((p) => p.code.toLowerCase() === loc.project.code.toLowerCase());
            if (idx >= 0) {
              arr[idx] = {
                ...arr[idx],
                schemaVersion: targetDataVersion,
                esedreVersion: CURRENT_ESEDRE_VERSION,
              };
              fs.writeFileSync(listPath, JSON.stringify(arr, null, 2) + '\n', 'utf-8');
            }
          }
        } catch {}
      }
    }

    // Stamp ticket meta.json files in ticketsDir
    if (fs.existsSync(loc.ticketsDir)) {
      try {
        const entries = fs.readdirSync(loc.ticketsDir, { withFileTypes: true });
        for (const ent of entries) {
          if (!ent.isDirectory()) continue;
          const metaPath = path.join(loc.ticketsDir, ent.name, 'meta.json');
          if (fs.existsSync(metaPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
              if (
                !meta.schemaVersion ||
                compareVersions(normalizeVersion(meta.schemaVersion, '1.0.0'), targetDataVersion) < 0 ||
                options.forceStamp
              ) {
                meta.schemaVersion = targetDataVersion;
                meta.esedreVersion = CURRENT_ESEDRE_VERSION;
                fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
                stampedFilesCount++;
              }
            } catch {}
          }
        }
      } catch {}
    }

    storage.invalidateTicketCache();
    storage.invalidateMilestoneCache(loc);
  } else {
    for (const migration of pendingMigrations) {
      appliedMigrations.push({
        version: migration.version,
        description: migration.description,
      });
    }
    stampedFilesCount = (needsProjectStamp ? 1 : 0) + unstampedTicketDirs.length;
  }

  return {
    projectCode: loc.project.code,
    projectDir: paths.projectDir,
    sourceType: loc.sourceType,
    previousSchemaVersion,
    currentSchemaVersion: targetDataVersion,
    esedreVersion: CURRENT_ESEDRE_VERSION,
    appliedMigrations,
    stampedFilesCount,
    backupPath,
    alreadyUpToDate: false,
  };
}
