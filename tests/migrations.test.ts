import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
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
  runProjectMigrations,
  StorageMigration,
} from '../src/migrations/index.js';
import { CURRENT_ESEDRE_VERSION } from '../src/types.js';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { SecurityFilter } from '../src/securityFilter.js';
import { EsedreMcpServer } from '../src/mcp/server.js';
import { upgradeProjectData, upgradeAllWorkspaces } from '../src/upgrade.js';

describe('Storage Migration and Compatibility Engine (Ticket #85)', () => {
  let tmpDir: string;
  let hubDir: string;
  let backupDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-migrations-test-'));
    hubDir = path.join(tmpDir, 'hub');
    backupDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(path.join(hubDir, 'projects'), { recursive: true });
    fs.writeFileSync(path.join(hubDir, 'projects.json'), '[]\n', 'utf-8');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('SemVer utilities (versions.ts)', () => {
    it('compares 3-part SemVer versions accurately', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
      expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
      expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
      expect(compareVersions('1.1.0', '1.0.0')).toBe(1);
      expect(compareVersions('1.2.2', '1.2.10')).toBe(-1);
      expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    });

    it('validates and normalizes version strings with fallback', () => {
      expect(isValidVersion('1.0.0')).toBe(true);
      expect(isValidVersion('v2.3.4')).toBe(true);
      expect(isValidVersion('invalid')).toBe(false);
      expect(isValidVersion(undefined)).toBe(false);

      expect(normalizeVersion('v1.2.3')).toBe('1.2.3');
      expect(normalizeVersion(undefined, '1.0.0')).toBe('1.0.0');
      expect(normalizeVersion('not-a-version', '1.0.0')).toBe('1.0.0');
    });
  });

  describe('Multi-Version Compatibility & Feature Gates (compatibility.ts)', () => {
    it('defaults legacy projects without schemaVersion to 1.0.0', () => {
      expect(getProjectSchemaVersion({ code: 'Legacy' })).toBe('1.0.0');
      const status = checkProjectCompatibility({ code: 'Legacy' });
      expect(status.compatible).toBe(true);
      expect(status.schemaVersion).toBe('1.0.0');
    });

    it('enforces Hard Floor (BELOW_MIN_SUPPORTED) on write while allowing non-destructive reads', () => {
      const legacyProj = { code: 'OldRepo', schemaVersion: '0.9.0' };

      const readStatus = checkProjectCompatibility(legacyProj, {
        operation: 'read',
        minSupportedVersion: '1.0.0',
        currentEngineDataVersion: '1.1.0',
      });
      expect(readStatus.compatible).toBe(true);
      expect(readStatus.isBelowHardFloor).toBe(true);
      expect(readStatus.needsUpgrade).toBe(true);

      expect(() =>
        assertProjectCompatible(legacyProj, {
          operation: 'write',
          minSupportedVersion: '1.0.0',
          currentEngineDataVersion: '1.1.0',
        })
      ).toThrowError(EsedreVersionError);

      try {
        assertProjectCompatible(legacyProj, {
          operation: 'write',
          minSupportedVersion: '1.0.0',
          currentEngineDataVersion: '1.1.0',
        });
      } catch (err: any) {
        expect(err).toBeInstanceOf(EsedreVersionError);
        expect(err.reason).toBe('BELOW_MIN_SUPPORTED');
        expect(err.projectCode).toBe('OldRepo');
        expect(err.currentSchemaVersion).toBe('0.9.0');
        expect(err.requiredSchemaVersion).toBe('1.0.0');
        expect(err.message).toContain("Run 'ese upgrade --project OldRepo'");
      }
    });

    it('enforces Forward Guard (ABOVE_CURRENT_ENGINE) when project is newer than local CLI', () => {
      const futureProj = { code: 'FutureRepo', schemaVersion: '2.0.0' };

      const readStatus = checkProjectCompatibility(futureProj, {
        operation: 'read',
        currentEngineDataVersion: '1.0.0',
      });
      expect(readStatus.compatible).toBe(true);
      expect(readStatus.isNewerThanEngine).toBe(true);

      try {
        assertProjectCompatible(futureProj, {
          operation: 'write',
          currentEngineDataVersion: '1.0.0',
        });
        expect.unreachable('Should have thrown EsedreVersionError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(EsedreVersionError);
        expect(err.reason).toBe('ABOVE_CURRENT_ENGINE');
        expect(err.projectCode).toBe('FutureRepo');
        expect(err.currentSchemaVersion).toBe('2.0.0');
        expect(err.requiredSchemaVersion).toBe('1.0.0');
        expect(err.message).toContain('newer than the locally installed Esedre engine');
      }
    });

    it('enforces Feature Capability Gate (FEATURE_REQUIRES_UPGRADE) with multi-owner guidance', () => {
      const partnerProj = { code: 'PartnerRepo', schemaVersion: '1.0.0' };
      FEATURE_MIN_SCHEMA_VERSION['opaque-milestone-ids'] = {
        minSchemaVersion: '1.1.0',
        displayName: 'opaque milestone IDs',
      };

      try {
        assertProjectCompatible(partnerProj, {
          operation: 'write',
          feature: 'opaque-milestone-ids',
          currentEngineDataVersion: '1.1.0',
        });
        expect.unreachable('Should have thrown EsedreVersionError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(EsedreVersionError);
        expect(err.reason).toBe('FEATURE_REQUIRES_UPGRADE');
        expect(err.projectCode).toBe('PartnerRepo');
        expect(err.currentSchemaVersion).toBe('1.0.0');
        expect(err.requiredSchemaVersion).toBe('1.1.0');
        expect(err.featureName).toBe('opaque milestone IDs');
        expect(err.message).toContain(
          "Project 'PartnerRepo' does not yet support opaque milestone IDs because its Esedre data is on schema v1.0.0 (schema v1.1.0+ required)."
        );
        expect(err.message).toContain(
          "Run 'ese upgrade --project PartnerRepo' or speak to the project owner about upgrading Esedre in the 'PartnerRepo' repository."
        );
      } finally {
        delete FEATURE_MIN_SCHEMA_VERSION['opaque-milestone-ids'];
      }
    });
  });

  describe('Storage Stamping & Forward Guard in FilesystemStorageAdapter and MCP', () => {
    it('stamps schemaVersion and esedreVersion when registering projects and creating/updating tickets', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir, projectCode: 'Core' });
      const proj = await storage.registerProject({ code: 'Core', name: 'Core Engine' });
      expect(proj.schemaVersion).toBe(CURRENT_DATA_VERSION);
      expect(proj.esedreVersion).toBe(CURRENT_ESEDRE_VERSION);

      const ticket = await storage.createTicket({
        title: 'Test Stamped Ticket',
        type: 'Feature',
        projectCode: 'Core',
      });
      expect(ticket.meta.schemaVersion).toBe(CURRENT_DATA_VERSION);
      expect(ticket.meta.esedreVersion).toBe(CURRENT_ESEDRE_VERSION);

      const updated = await storage.updateTicket('Core-1', { status: 'In Development' });
      expect(updated.meta.schemaVersion).toBe(CURRENT_DATA_VERSION);
      expect(updated.meta.esedreVersion).toBe(CURRENT_ESEDRE_VERSION);
    });

    it('blocks mutating a project whose schemaVersion is newer than CURRENT_DATA_VERSION via Storage and MCP', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir, projectCode: 'Future' });
      await storage.registerProject({ code: 'Future', name: 'Future Project' });

      // Simulate another team member upgrading Future project to schema v9.0.0
      const pJsonPath = path.join(hubDir, 'projects', 'Future', 'project.json');
      const pJson = JSON.parse(fs.readFileSync(pJsonPath, 'utf-8'));
      pJson.schemaVersion = '9.0.0';
      fs.writeFileSync(pJsonPath, JSON.stringify(pJson, null, 2) + '\n', 'utf-8');

      // Non-destructive read still succeeds
      const projects = await storage.getProjects();
      expect(projects.find((p) => p.code === 'Future')?.schemaVersion).toBe('9.0.0');

      // Direct storage write throws EsedreVersionError
      await expect(
        storage.createTicket({ title: 'Should Fail', type: 'Bug', projectCode: 'Future' })
      ).rejects.toThrowError(EsedreVersionError);

      // MCP server returns structured -32002 error with version metadata
      const secured = new SecurityFilter(storage, { allowedProjects: ['Future'] });
      const mcp = new EsedreMcpServer(secured);
      const res = await (mcp as any).handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'esedre_create_ticket',
          arguments: {
            title: 'Blocked by Forward Guard',
            project: 'Future',
          },
        },
      });

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32002);
      expect(res.error.data.projectCode).toBe('Future');
      expect(res.error.data.currentSchemaVersion).toBe('9.0.0');
      expect(res.error.data.reason).toBe('ABOVE_CURRENT_ENGINE');
    });
  });

  describe('Sequential Migration Runner & Pre-Migration Atomic Backups', () => {
    it('runs pending migrations in ascending SemVer order, creates atomic backup, and stamps files', async () => {
      const storage = new FilesystemStorageAdapter(tmpDir, { dataDir: hubDir, projectCode: 'Alpha' });
      await storage.registerProject({ code: 'Alpha', name: 'Alpha Project' });
      await storage.createTicket({ title: 'Legacy Ticket 1', type: 'Feature', projectCode: 'Alpha' });

      // Simulate legacy un-stamped project.json and meta.json
      const pJsonPath = path.join(hubDir, 'projects', 'Alpha', 'project.json');
      const rawPJson = JSON.parse(fs.readFileSync(pJsonPath, 'utf-8'));
      delete rawPJson.schemaVersion;
      delete rawPJson.esedreVersion;
      fs.writeFileSync(pJsonPath, JSON.stringify(rawPJson, null, 2) + '\n', 'utf-8');

      const metaPath = path.join(hubDir, 'projects', 'Alpha', 'tickets', '1', 'meta.json');
      const rawMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      delete rawMeta.schemaVersion;
      delete rawMeta.esedreVersion;
      fs.writeFileSync(metaPath, JSON.stringify(rawMeta, null, 2) + '\n', 'utf-8');

      const executionOrder: string[] = [];
      const mockMigrations: StorageMigration[] = [
        {
          version: '1.2.0',
          description: 'Second migration step',
          migrate: async (ctx) => {
            executionOrder.push('1.2.0');
            const m = JSON.parse(fs.readFileSync(path.join(ctx.ticketsDir, '1', 'meta.json'), 'utf-8'));
            m.migratedV120 = true;
            fs.writeFileSync(path.join(ctx.ticketsDir, '1', 'meta.json'), JSON.stringify(m, null, 2) + '\n', 'utf-8');
          },
        },
        {
          version: '1.1.0',
          description: 'First migration step',
          migrate: async (ctx) => {
            executionOrder.push('1.1.0');
            const m = JSON.parse(fs.readFileSync(path.join(ctx.ticketsDir, '1', 'meta.json'), 'utf-8'));
            m.migratedV110 = true;
            fs.writeFileSync(path.join(ctx.ticketsDir, '1', 'meta.json'), JSON.stringify(m, null, 2) + '\n', 'utf-8');
          },
        },
      ];

      const result = await upgradeProjectData(storage, 'Alpha', {
        migrations: mockMigrations,
        targetDataVersion: '1.2.0',
        backupRootDir: backupDir,
      });

      // 1. Executed in ascending SemVer order
      expect(executionOrder).toEqual(['1.1.0', '1.2.0']);
      expect(result.previousSchemaVersion).toBe('1.0.0');
      expect(result.currentSchemaVersion).toBe('1.2.0');
      expect(result.appliedMigrations).toHaveLength(2);
      expect(result.alreadyUpToDate).toBe(false);

      // 2. Atomic backup was created before mutation
      expect(result.backupPath).toBeDefined();
      expect(fs.existsSync(result.backupPath!)).toBe(true);
      expect(fs.existsSync(path.join(result.backupPath!, 'backup-manifest.json'))).toBe(true);
      const backedUpMeta = JSON.parse(
        fs.readFileSync(path.join(result.backupPath!, 'tickets', '1', 'meta.json'), 'utf-8')
      );
      expect(backedUpMeta.migratedV110).toBeUndefined();

      // 3. On-disk project.json and meta.json are mutated and stamped with 1.2.0
      const updatedPJson = JSON.parse(fs.readFileSync(pJsonPath, 'utf-8'));
      expect(updatedPJson.schemaVersion).toBe('1.2.0');
      expect(updatedPJson.esedreVersion).toBe(CURRENT_ESEDRE_VERSION);

      const updatedMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      expect(updatedMeta.migratedV110).toBe(true);
      expect(updatedMeta.migratedV120).toBe(true);
      expect(updatedMeta.schemaVersion).toBe('1.2.0');
      expect(updatedMeta.esedreVersion).toBe(CURRENT_ESEDRE_VERSION);

      // 4. Re-running migrations is a no-op (idempotent)
      const secondRun = await upgradeProjectData(storage, 'Alpha', {
        migrations: mockMigrations,
        targetDataVersion: '1.2.0',
        backupRootDir: backupDir,
      });
      expect(secondRun.alreadyUpToDate).toBe(true);
      expect(secondRun.appliedMigrations).toHaveLength(0);
    });

    it('upgrades all workspaces and hub projects via upgradeAllWorkspaces', async () => {
      const wsDir = path.join(tmpDir, 'ws-beta');
      fs.mkdirSync(path.join(wsDir, '.esedre'), { recursive: true });
      fs.writeFileSync(
        path.join(wsDir, '.esedre', 'esedre.json'),
        JSON.stringify({ projectCode: 'Beta', dataDir: hubDir, allowedProjects: ['Beta'] }, null, 2) + '\n',
        'utf-8'
      );

      const storage = new FilesystemStorageAdapter(wsDir, { dataDir: hubDir, projectCode: 'Beta' });
      await storage.registerProject({ code: 'Beta', name: 'Beta Repo' });
      await storage.registerProject({ code: 'Gamma', name: 'Gamma Hub Project' });

      // Remove schemaVersion from Gamma to verify upgradeAllWorkspaces stamps hub projects too
      const gammaPJsonPath = path.join(hubDir, 'projects', 'Gamma', 'project.json');
      const gammaRaw = JSON.parse(fs.readFileSync(gammaPJsonPath, 'utf-8'));
      delete gammaRaw.schemaVersion;
      fs.writeFileSync(gammaPJsonPath, JSON.stringify(gammaRaw, null, 2) + '\n', 'utf-8');

      const allRes = await upgradeAllWorkspaces({
        currentWorkspaceRoot: wsDir,
        globalConfig: { dataDir: hubDir, projects: { Beta: wsDir } },
      });

      expect(allRes.totalUpgraded).toBe(1);
      expect(allRes.projectMigrations.map((m) => m.projectCode).sort()).toEqual(['Beta', 'Gamma']);

      const gammaAfter = JSON.parse(fs.readFileSync(gammaPJsonPath, 'utf-8'));
      expect(gammaAfter.schemaVersion).toBe(CURRENT_DATA_VERSION);
      expect(gammaAfter.esedreVersion).toBe(CURRENT_ESEDRE_VERSION);
    });

    it('executes ese upgrade --project via CLI and reports Version Compatibility Error on forward-versioned project', async () => {
      const cliPath = path.resolve(process.cwd(), 'dist', 'esedre.mjs');
      const wsDir = path.join(tmpDir, 'ws-cli');
      fs.mkdirSync(path.join(wsDir, '.esedre'), { recursive: true });
      fs.writeFileSync(
        path.join(wsDir, '.esedre', 'esedre.json'),
        JSON.stringify({ projectCode: 'Delta', dataDir: hubDir, allowedProjects: ['Delta', 'Omega'] }, null, 2) + '\n',
        'utf-8'
      );

      const storage = new FilesystemStorageAdapter(wsDir, { dataDir: hubDir, projectCode: 'Delta' });
      await storage.registerProject({ code: 'Delta', name: 'Delta Project' });
      await storage.registerProject({ code: 'Omega', name: 'Omega Project' });

      // Remove schemaVersion from Delta to verify CLI upgrade --project stamps it
      const deltaPJsonPath = path.join(hubDir, 'projects', 'Delta', 'project.json');
      const deltaRaw = JSON.parse(fs.readFileSync(deltaPJsonPath, 'utf-8'));
      delete deltaRaw.schemaVersion;
      fs.writeFileSync(deltaPJsonPath, JSON.stringify(deltaRaw, null, 2) + '\n', 'utf-8');

      const out = execFileSync(process.execPath, [cliPath, 'upgrade', '--project', 'Delta', '--json'], {
        cwd: wsDir,
        encoding: 'utf-8',
      });
      const parsed = JSON.parse(out);
      expect(parsed.project).toBe('Delta');
      expect(parsed.migration.currentSchemaVersion).toBe(CURRENT_DATA_VERSION);

      // Set Omega to schemaVersion 9.9.0 and verify CLI create exits with Version Compatibility Error
      const omegaPJsonPath = path.join(hubDir, 'projects', 'Omega', 'project.json');
      const omegaRaw = JSON.parse(fs.readFileSync(omegaPJsonPath, 'utf-8'));
      omegaRaw.schemaVersion = '9.9.0';
      fs.writeFileSync(omegaPJsonPath, JSON.stringify(omegaRaw, null, 2) + '\n', 'utf-8');

      let failedAsExpected = false;
      try {
        execFileSync(
          process.execPath,
          [cliPath, 'create', '--title', 'Blocked CLI Ticket', '--project', 'Omega'],
          { cwd: wsDir, encoding: 'utf-8', stdio: 'pipe' }
        );
      } catch (err: any) {
        failedAsExpected = true;
        expect(err.stderr || err.message).toContain('Version Compatibility Error:');
        expect(err.stderr || err.message).toContain("Project 'Omega' is on Esedre schema v9.9.0");
      }
      expect(failedAsExpected).toBe(true);
    });
  });
});

