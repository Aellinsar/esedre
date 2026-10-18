import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ProjectBackupInput {
  projectCode: string;
  projectDir: string;
  ticketsDir: string;
  fromVersion: string;
  toVersion: string;
  hubDir?: string;
  backupRootDir?: string;
}

function copyDirectoryRecursive(srcDir: string, destDir: string): void {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Create an atomic timestamped backup of a project's on-disk data (project.json, milestones.json,
 * and tickets/) inside ~/.esedre/backups/ (or custom backupRootDir) before executing schema migrations.
 */
export function createProjectMigrationBackup(input: ProjectBackupInput): string {
  const rootDir = input.backupRootDir || path.join(os.homedir(), '.esedre', 'backups');
  const safeFrom = input.fromVersion.replace(/[^0-9A-Za-z._-]/g, '_');
  const safeTo = input.toVersion.replace(/[^0-9A-Za-z._-]/g, '_');
  const safeCode = input.projectCode.replace(/[^0-9A-Za-z._-]/g, '_');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folderName = `${safeCode}_v${safeFrom}_to_v${safeTo}_${stamp}`;
  const backupDir = path.join(rootDir, folderName);

  fs.mkdirSync(backupDir, { recursive: true });

  const filesToCopy = ['project.json', 'milestones.json', 'projects.json'];
  for (const fileName of filesToCopy) {
    const candidate = path.join(input.projectDir, fileName);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      fs.copyFileSync(candidate, path.join(backupDir, fileName));
    }
  }

  if (input.hubDir) {
    const hubProjectsJson = path.join(input.hubDir, 'projects.json');
    if (fs.existsSync(hubProjectsJson) && fs.statSync(hubProjectsJson).isFile()) {
      fs.copyFileSync(hubProjectsJson, path.join(backupDir, 'hub-projects.json'));
    }
  }

  if (fs.existsSync(input.ticketsDir)) {
    copyDirectoryRecursive(input.ticketsDir, path.join(backupDir, 'tickets'));
  }

  const manifest = {
    projectCode: input.projectCode,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    createdAt: new Date().toISOString(),
    sourceProjectDir: input.projectDir,
    sourceTicketsDir: input.ticketsDir,
    hubDir: input.hubDir,
  };
  fs.writeFileSync(path.join(backupDir, 'backup-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  return backupDir;
}
