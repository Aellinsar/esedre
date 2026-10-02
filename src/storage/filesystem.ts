function isProjectMatch(code?: string, filter?: string): boolean {
  if (!code || !filter) return false;
  const f = filter.trim().toLowerCase();
  const c = code.trim().toLowerCase();
  if (c === f) return true;
  if ((f === 'profe' || f === 'prof' || f === 'core' || f === 'pasrc') && (c === 'profe' || c === 'prof' || c === 'core')) return true;
  if ((f === 'esedre' || f === 'ese' || f === 'docs') && (c === 'esedre' || c === 'docs')) return true;
  if ((f === 'alce' || f === 'web') && (c === 'alce' || c === 'web')) return true;
  return false;
}

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  EsedreTicket,
  TicketMeta,
  ProjectDescriptor,
  TicketComment,
  TicketDetail,
  TicketType,
  TicketCategory,
  EsedreConflictError,
  UpdateProjectInput,
  RenameProjectCodeInput,
  RenameProjectCodeResult,
  Milestone,
  CreateMilestoneInput,
  UpdateMilestoneInput,
  TicketLinkRelation,
  TicketLink,
  EnrichedTicketLink,
  INVERSE_RELATIONS,
} from '../types.js';
import { StorageAdapter, CreateTicketInput, ListTicketsFilter, RegisterProjectInput, DuplicateProjectWarning } from './adapter.js';
import { EsedreConfig, findEsedreConfig, expandHome, validateProjectCode, validateProjectName } from '../config.js';
import { computeTicketHash, verifyTicketHash } from '../snapshot.js';
import { normalizeDashesAndMojibake, normalizeTicketFields, normalizePriority } from '../utils/formatter.js';

function writeSafeFile(filePath: string, content: string | Buffer): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    if (Buffer.isBuffer(content)) {
      fs.writeFileSync(tempPath, content);
      fs.renameSync(tempPath, filePath);
    } else {
      const normalized = content.replace(/\r\n/g, '\n');
      fs.writeFileSync(tempPath, normalized, 'utf-8');
      fs.renameSync(tempPath, filePath);
    }
  } catch {
    if (Buffer.isBuffer(content)) {
      fs.writeFileSync(filePath, content);
    } else {
      const normalized = content.replace(/\r\n/g, '\n');
      fs.writeFileSync(filePath, normalized, 'utf-8');
    }
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
  }
}

export interface ResolvedProjectLocation {
  project: ProjectDescriptor;
  ticketsDir: string;
  sourceType: 'hub' | 'in-repo' | 'federated';
  hubDir?: string;
  isSharedDir?: boolean;
}

export interface CachedMilestoneRecord {
  milestones: Milestone[];
  mtimeMs: number;
  size: number;
}

export interface CachedTicketRecord {
  ticket: EsedreTicket;
  stats: Record<string, { mtimeMs: number; size: number }>;
}

export class FilesystemStorageAdapter implements StorageAdapter {
  private workspaceRoot: string;
  private config: EsedreConfig;
  private isConfigExplicit = false;
  private lastConfigCheck = 0;
  private configTtlMs = 3000;
  private duplicateProjectWarnings: DuplicateProjectWarning[] = [];
  private milestoneMemoryCache = new Map<string, CachedMilestoneRecord>();
  private ticketMemoryCache = new Map<string, CachedTicketRecord>();

  public invalidateTicketCache(ticketDir?: string): void {
    if (ticketDir) {
      this.ticketMemoryCache.delete(path.resolve(ticketDir));
    } else {
      this.ticketMemoryCache.clear();
    }
  }

  public invalidateMilestoneCache(loc?: ResolvedProjectLocation): void {
    if (loc) {
      const mPath = path.resolve(this.getMilestonesPath(loc));
      this.milestoneMemoryCache.delete(mPath);
    } else {
      this.milestoneMemoryCache.clear();
    }
  }

  public getDuplicateProjectWarnings(): DuplicateProjectWarning[] {
    this.resolveProjectLocations();
    return [...this.duplicateProjectWarnings];
  }

  constructor(workspaceRoot?: string, config?: EsedreConfig) {
    this.workspaceRoot = workspaceRoot || this.resolveWorkspaceRoot();
    if (config) {
      this.config = config;
      this.isConfigExplicit = true;
      this.lastConfigCheck = Date.now();
    } else {
      this.config = {};
      this.refreshConfig();
    }
  }

  public refreshConfig(): void {
    if (this.isConfigExplicit) {
      try {
        const discovered = findEsedreConfig(this.workspaceRoot);
        if (discovered.config && Object.keys(discovered.config).length > 0) {
          this.config = {
            ...this.config,
            ...discovered.config,
          };
        }
      } catch {}
      this.lastConfigCheck = Date.now();
      return;
    }
    try {
      const discovered = findEsedreConfig(this.workspaceRoot);
      this.config = discovered.config || {};
    } catch {
      this.config = {};
    }
    this.lastConfigCheck = Date.now();
  }

  public ensureFreshConfig(): void {
    if (this.isConfigExplicit && this.config.allowedProjects?.includes('*')) {
      if (Date.now() - this.lastConfigCheck > this.configTtlMs) {
        try {
          const discovered = findEsedreConfig(this.workspaceRoot, { fallbackToGlobal: true });
          this.config = {
            ...discovered.config,
            allowedProjects: ['*'],
          };
        } catch {}
        this.lastConfigCheck = Date.now();
      }
      return;
    }

    if (!this.isConfigExplicit && Date.now() - this.lastConfigCheck > this.configTtlMs) {
      this.refreshConfig();
    }
  }

  private resolveWorkspaceRoot(): string {
    let current = process.cwd();
    while (current !== path.dirname(current)) {
      const candidateConfig = path.join(current, '.esedre', 'esedre.json');
      const candidateRootConfig = path.join(current, 'esedre.json');
      const candidateTickets = path.join(current, 'src', 'data', 'planning', 'tickets');
      const candidateProjectsDir = path.join(current, 'src', 'data', 'planning', 'projects', 'projects.json');
      const candidateProjects = path.join(current, 'src', 'data', 'planning', 'projects.json');
      if (
        fs.existsSync(candidateConfig) ||
        fs.existsSync(candidateRootConfig) ||
        fs.existsSync(candidateTickets) ||
        fs.existsSync(candidateProjectsDir) ||
        fs.existsSync(candidateProjects)
      ) {
        return current;
      }
      current = path.dirname(current);
    }
    return process.cwd();
  }

  public resolveProjectLocations(): ResolvedProjectLocation[] {
    this.ensureFreshConfig();
    const locations: ResolvedProjectLocation[] = [];
    const seenCodes = new Set<string>();
    const codeToSource = new Map<string, string>();
    this.duplicateProjectWarnings = [];

    // 1. Hub Directories from config.dataDir or auto-detected in-workspace hub
    const rawDataDirs = Array.isArray(this.config.dataDir)
      ? [...this.config.dataDir]
      : (this.config.dataDir ? [this.config.dataDir] : []);

    // Auto-detect if workspaceRoot or subfolder is itself a multi-project hub
    if (rawDataDirs.length === 0) {
      const candidateHubDirs = [
        this.workspaceRoot,
        path.join(this.workspaceRoot, 'data'),
        path.join(this.workspaceRoot, '.esedre'),
      ];
      for (const cand of candidateHubDirs) {
        const pSub = path.join(cand, 'projects');
        if (fs.existsSync(pSub)) {
          try {
            if (fs.statSync(pSub).isDirectory()) {
              rawDataDirs.push(cand);
              break;
            }
          } catch {}
        }
      }
    }

    for (const dDir of rawDataDirs) {
      const resolvedHub = path.resolve(this.workspaceRoot, expandHome(dDir));
      if (!fs.existsSync(resolvedHub)) continue;

      const projectsSubDir = path.join(resolvedHub, 'projects');
      if (fs.existsSync(projectsSubDir)) {
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(projectsSubDir, { withFileTypes: true });
        } catch {}

        for (const ent of entries) {
          if (!ent.isDirectory()) continue;
          const projectDir = path.join(projectsSubDir, ent.name);
          const projectTicketsDir = path.join(projectDir, 'tickets');

          let desc: ProjectDescriptor | undefined;
          const pJsonPath = path.join(projectDir, 'project.json');
          if (fs.existsSync(pJsonPath)) {
            try {
              desc = JSON.parse(fs.readFileSync(pJsonPath, 'utf-8'));
            } catch {}
          }

          if (!desc) {
            const hubProjectsFile = path.join(resolvedHub, 'projects.json');
            const subHubProjectsFile = path.join(projectsSubDir, 'projects.json');
            for (const f of [hubProjectsFile, subHubProjectsFile]) {
              if (fs.existsSync(f)) {
                try {
                  const hubProjs: ProjectDescriptor[] = JSON.parse(fs.readFileSync(f, 'utf-8'));
                  desc = hubProjs.find(
                    (p) => p.code.toLowerCase() === ent.name.toLowerCase()
                  );
                  if (desc) break;
                } catch {}
              }
            }
          }

          if (!desc) {
            desc = {
              id: locations.length + 1,
              code: ent.name,
              name: ent.name,
              description: `${ent.name} project`,
            };
          }

          const codeKey = desc.code.toLowerCase();
          const sourceName = resolvedHub;
          if (!seenCodes.has(codeKey)) {
            seenCodes.add(codeKey);
            codeToSource.set(codeKey, sourceName);
            locations.push({
              project: desc,
              ticketsDir: projectTicketsDir,
              sourceType: 'hub',
              hubDir: resolvedHub,
            });
          } else {
            const firstSource = codeToSource.get(codeKey) || 'configured location';
            if (firstSource.toLowerCase() !== sourceName.toLowerCase()) {
              if (!this.duplicateProjectWarnings.some((w) => w.code.toLowerCase() === codeKey && w.duplicateHub.toLowerCase() === sourceName.toLowerCase())) {
                this.duplicateProjectWarnings.push({
                  code: desc.code,
                  firstHub: firstSource,
                  duplicateHub: sourceName,
                });
              }
            }
          }
        }
      } else {
        // Direct flat tickets in hub
        const flatTicketsDir = path.join(resolvedHub, 'tickets');
        const actualTicketsDir = fs.existsSync(flatTicketsDir) ? flatTicketsDir : resolvedHub;

        let descs: ProjectDescriptor[] = [];
        const pJsonCandidates = [
          path.join(resolvedHub, 'projects.json'),
          path.join(resolvedHub, 'project.json'),
        ];
        for (const cand of pJsonCandidates) {
          if (fs.existsSync(cand)) {
            try {
              const parsed = JSON.parse(fs.readFileSync(cand, 'utf-8'));
              descs = Array.isArray(parsed) ? parsed : [parsed];
              break;
            } catch {}
          }
        }
        if (descs.length === 0) {
          const pCode = this.config.projectCode || 'CORE';
          descs = [{
            id: 1,
            code: pCode,
            name: pCode,
            description: `${pCode} project`,
          }];
        }

        const isShared = descs.length > 1;
        for (const desc of descs) {
          const codeKey = desc.code.toLowerCase();
          const sourceName = resolvedHub;
          if (!seenCodes.has(codeKey)) {
            seenCodes.add(codeKey);
            codeToSource.set(codeKey, sourceName);
            locations.push({
              project: desc,
              ticketsDir: actualTicketsDir,
              sourceType: 'hub',
              hubDir: resolvedHub,
              isSharedDir: isShared,
            });
          } else {
            const firstSource = codeToSource.get(codeKey) || 'configured location';
            if (firstSource.toLowerCase() !== sourceName.toLowerCase()) {
              if (!this.duplicateProjectWarnings.some((w) => w.code.toLowerCase() === codeKey && w.duplicateHub.toLowerCase() === sourceName.toLowerCase())) {
                this.duplicateProjectWarnings.push({
                  code: desc.code,
                  firstHub: firstSource,
                  duplicateHub: sourceName,
                });
              }
            }
          }
        }
      }
    }

    // 2. Federated Projects from config.projects
    if (this.config.projects && typeof this.config.projects === 'object') {
      for (const [code, rawPath] of Object.entries(this.config.projects)) {
        const projectDir = path.resolve(this.workspaceRoot, expandHome(rawPath));
        if (!fs.existsSync(projectDir)) continue;

        let actualTicketsDir = path.join(projectDir, 'tickets');
        if (fs.existsSync(path.join(projectDir, '.esedre', 'tickets'))) {
          actualTicketsDir = path.join(projectDir, '.esedre', 'tickets');
        } else if (fs.existsSync(path.join(projectDir, 'tickets'))) {
          actualTicketsDir = path.join(projectDir, 'tickets');
        } else if (fs.existsSync(path.join(projectDir, 'src', 'data', 'planning', 'tickets'))) {
          actualTicketsDir = path.join(projectDir, 'src', 'data', 'planning', 'tickets');
        }

        let desc: ProjectDescriptor | undefined;
        const pJsonCandidates = [
          path.join(projectDir, '.esedre', 'project.json'),
          path.join(projectDir, 'project.json'),
        ];
        for (const cand of pJsonCandidates) {
          if (fs.existsSync(cand)) {
            try {
              desc = JSON.parse(fs.readFileSync(cand, 'utf-8'));
              break;
            } catch {}
          }
        }

        if (!desc) {
          desc = {
            id: locations.length + 1,
            code,
            name: code,
            description: `${code} project`,
          };
        }

        const codeKey = desc.code.toLowerCase();
        const sourceName = projectDir;
        if (!seenCodes.has(codeKey)) {
          seenCodes.add(codeKey);
          codeToSource.set(codeKey, sourceName);
          locations.push({
            project: desc,
            ticketsDir: actualTicketsDir,
            sourceType: 'federated',
          });
        } else {
          const firstSource = codeToSource.get(codeKey) || 'configured location';
          if (firstSource.toLowerCase() !== sourceName.toLowerCase()) {
            if (!this.duplicateProjectWarnings.some((w) => w.code.toLowerCase() === codeKey && w.duplicateHub.toLowerCase() === sourceName.toLowerCase())) {
              this.duplicateProjectWarnings.push({
                code: desc.code,
                firstHub: firstSource,
                duplicateHub: sourceName,
              });
            }
          }
        }
      }
    }

    // 3. Standalone In-Repo fallback if no hubs and no federated projects were found
    if (locations.length === 0) {
      const candidateDirs = [
        path.join(this.workspaceRoot, '.esedre', 'tickets'),
        path.join(this.workspaceRoot, 'tickets'),
        path.join(this.workspaceRoot, 'src', 'data', 'planning', 'tickets'),
      ];

      const existingDirs = candidateDirs.filter((d) => fs.existsSync(d));
      const foundTicketsDir =
        existingDirs.find((d) => {
          try {
            return fs.readdirSync(d).length > 0;
          } catch {
            return false;
          }
        }) || existingDirs[0] || path.join(this.workspaceRoot, '.esedre', 'tickets');

      let descs: ProjectDescriptor[] = [];
      const pJsonCandidates = [
        path.join(this.workspaceRoot, '.esedre', 'projects.json'),
        path.join(this.workspaceRoot, '.esedre', 'project.json'),
        path.join(this.workspaceRoot, 'projects.json'),
        path.join(this.workspaceRoot, 'project.json'),
        path.join(this.workspaceRoot, 'src', 'data', 'planning', 'projects', 'projects.json'),
        path.join(this.workspaceRoot, 'src', 'data', 'planning', 'projects.json'),
      ];
      for (const cand of pJsonCandidates) {
        if (fs.existsSync(cand)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(cand, 'utf-8'));
            descs = Array.isArray(parsed) ? parsed : [parsed];
            break;
          } catch {}
        }
      }

      if (descs.length === 0) {
        if (this.config.projectCode) {
          const pName = this.config.projectName || this.config.projectCode;
          descs = [{
            id: 1,
            code: this.config.projectCode,
            name: pName,
            description: `${pName} project`,
          }];
        } else {
          return locations;
        }
      }

      const isShared = descs.length > 1;
      for (const desc of descs) {
        const codeKey = desc.code.toLowerCase();
        if (!seenCodes.has(codeKey)) {
          seenCodes.add(codeKey);
          locations.push({
            project: desc,
            ticketsDir: foundTicketsDir,
            sourceType: 'in-repo',
            isSharedDir: isShared,
          });
        }
      }
    }

    return locations;
  }

  public async getProjects(): Promise<ProjectDescriptor[]> {
    return this.resolveProjectLocations().map((l) => l.project);
  }

  public async registerProject(input: RegisterProjectInput): Promise<ProjectDescriptor> {
    const rawCode = input.code.trim();
    const cleanCode = rawCode;
    const cleanName = input.name?.trim() || cleanCode;
    const cleanDesc = input.description?.trim() || `${cleanName} project`;
    const cleanLower = cleanCode.toLowerCase();

    const colors = input.colors || {
      badge: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
      dot: 'bg-cyan-400',
      border: 'border-cyan-500/40',
    };

    // 1. Check if dataDir hub is configured or in-workspace hub auto-detected
    const rawDataDirs = Array.isArray(this.config.dataDir)
      ? [...this.config.dataDir]
      : (this.config.dataDir ? [this.config.dataDir] : []);

    if (rawDataDirs.length === 0) {
      const candidateHubDirs = [
        this.workspaceRoot,
        path.join(this.workspaceRoot, 'data'),
        path.join(this.workspaceRoot, '.esedre'),
      ];
      for (const cand of candidateHubDirs) {
        const pSub = path.join(cand, 'projects');
        if (fs.existsSync(pSub)) {
          try {
            if (fs.statSync(pSub).isDirectory()) {
              rawDataDirs.push(cand);
              break;
            }
          } catch {}
        }
      }
    }

    const existingHubs: string[] = [];
    for (const dDir of rawDataDirs) {
      const resolved = path.resolve(this.workspaceRoot, expandHome(dDir));
      if (fs.existsSync(resolved) && !existingHubs.includes(resolved)) {
        existingHubs.push(resolved);
      }
    }

    let targetHub: string | null = null;
    if (input.hub) {
      const targetQuery = input.hub.trim();
      const resolvedQuery = path.resolve(this.workspaceRoot, expandHome(targetQuery)).toLowerCase();
      const isPathLike = targetQuery.includes('/') || targetQuery.includes('\\');
      const basenameMatches = existingHubs.filter(
        (h) => path.basename(h).toLowerCase() === targetQuery.toLowerCase()
      );

      if (!isPathLike && basenameMatches.length > 1) {
        const list = basenameMatches.map((h) => `  • ${h}`).join('\n');
        throw new Error(
          `Hub name collision: Multiple configured data hubs share basename "${targetQuery}". Please specify by unambiguous path:\n${list}`
        );
      } else if (basenameMatches.length === 1 && !isPathLike) {
        targetHub = basenameMatches[0];
      } else {
        const exactPathMatch = existingHubs.find((h) => h.toLowerCase() === resolvedQuery);
        if (exactPathMatch) {
          targetHub = exactPathMatch;
        } else if (basenameMatches.length === 1) {
          targetHub = basenameMatches[0];
        } else {
          const directHubPath = path.resolve(this.workspaceRoot, expandHome(targetQuery));
          if (
            fs.existsSync(directHubPath) &&
            (fs.existsSync(path.join(directHubPath, 'projects')) || fs.existsSync(path.join(directHubPath, 'projects.json')))
          ) {
            targetHub = directHubPath;
          } else {
            const available = existingHubs.map((h) => `${path.basename(h)} (${h})`).join(', ');
            throw new Error(
              `Hub "${targetQuery}" not found. Configured data hubs: ${available || '(none)'}`
            );
          }
        }
      }
    } else {
      if (existingHubs.length === 1) {
        targetHub = existingHubs[0];
      } else if (existingHubs.length > 1) {
        const basenames = existingHubs.map((h) => path.basename(h));
        const hasCollision = new Set(basenames.map((b) => b.toLowerCase())).size < basenames.length;
        const formattedList = existingHubs.map((h) => `  • ${path.basename(h)} (${h})`).join('\n');
        throw new Error(
          `Multiple data hubs configured. Please specify --hub <name${hasCollision ? '|path' : ''}>:\n${formattedList}`
        );
      }
    }

    if (targetHub) {
      const normalizedTargetHub = path.resolve(targetHub).toLowerCase();
      const existingLocations = this.resolveProjectLocations();
      const existingConflict = existingLocations.find((l) => {
        if (l.project.code.toLowerCase() !== cleanLower) return false;
        if (l.sourceType === 'hub' && l.hubDir) {
          return path.resolve(l.hubDir).toLowerCase() !== normalizedTargetHub;
        }
        return false;
      });
      if (existingConflict && existingConflict.hubDir) {
        const conflictLoc = path.basename(existingConflict.hubDir);
        throw new Error(
          `Project code "${cleanCode}" already exists in another data hub (${conflictLoc}). Duplicate project codes across hubs are not supported.`
        );
      }

      const hubProjectsDir = path.join(targetHub, 'projects');
      let resolvedDirName = cleanCode;

      // Case-remembering directory resolution: match existing directory case-insensitively
      if (fs.existsSync(hubProjectsDir)) {
        try {
          const entries = fs.readdirSync(hubProjectsDir, { withFileTypes: true });
          const matchedDir = entries.find(
            (e) => e.isDirectory() && e.name.toLowerCase() === cleanLower
          );
          if (matchedDir) {
            resolvedDirName = matchedDir.name;
          }
        } catch {}
      }

      const projectDir = path.join(hubProjectsDir, resolvedDirName);
      const ticketsDir = path.join(projectDir, 'tickets');
      if (!fs.existsSync(ticketsDir)) {
        fs.mkdirSync(ticketsDir, { recursive: true });
      }

      const pJsonPath = path.join(projectDir, 'project.json');
      let existingPJson: any = null;
      if (fs.existsSync(pJsonPath)) {
        try { existingPJson = JSON.parse(fs.readFileSync(pJsonPath, 'utf-8')); } catch {}
      }

      // Case-remembering code resolution: preserve original code casing if project already exists
      const resolvedCode = existingPJson?.code || resolvedDirName || cleanCode;

      const existingProjects = await this.getProjects();
      const maxId = existingProjects.reduce((max, p) => Math.max(max, p.id || 0), 0);
      const id = existingPJson?.id || (maxId + 1);
      const projectDesc: ProjectDescriptor = {
        id,
        code: resolvedCode,
        name: cleanName,
        description: cleanDesc,
        colors,
      };

      writeSafeFile(pJsonPath, JSON.stringify(projectDesc, null, 2) + '\n');

      const hubProjectsFile = path.join(targetHub, 'projects.json');
      if (fs.existsSync(hubProjectsFile)) {
        try {
          const arr: ProjectDescriptor[] = JSON.parse(fs.readFileSync(hubProjectsFile, 'utf-8'));
          const idx = arr.findIndex((p) => p.code.toLowerCase() === cleanLower);
          if (idx >= 0) {
            arr[idx] = projectDesc;
          } else {
            arr.push(projectDesc);
          }
          writeSafeFile(hubProjectsFile, JSON.stringify(arr, null, 2) + '\n');
        } catch {}
      }

      return projectDesc;
    }

    // 2. Standalone in-repo topology
    const esedreDir = path.join(this.workspaceRoot, '.esedre');
    const ticketsDir = path.join(esedreDir, 'tickets');
    if (!fs.existsSync(ticketsDir)) {
      fs.mkdirSync(ticketsDir, { recursive: true });
    }

    const pJsonPath = path.join(esedreDir, 'project.json');
    let existingPJson: any = null;
    if (fs.existsSync(pJsonPath)) {
      try { existingPJson = JSON.parse(fs.readFileSync(pJsonPath, 'utf-8')); } catch {}
    }

    const resolvedCode = (existingPJson?.code && existingPJson.code.toLowerCase() === cleanLower)
      ? existingPJson.code
      : cleanCode;

    const id = existingPJson?.id || 1;
    const projectDesc: ProjectDescriptor = {
      id,
      code: resolvedCode,
      name: cleanName,
      description: cleanDesc,
      colors,
    };

    writeSafeFile(pJsonPath, JSON.stringify(projectDesc, null, 2) + '\n');

    const projectsJsonPath = path.join(esedreDir, 'projects.json');
    if (fs.existsSync(projectsJsonPath)) {
      try {
        const arr: ProjectDescriptor[] = JSON.parse(fs.readFileSync(projectsJsonPath, 'utf-8'));
        const idx = arr.findIndex((p) => p.code.toLowerCase() === cleanLower);
        if (idx >= 0) {
          arr[idx] = projectDesc;
        } else {
          arr.push(projectDesc);
        }
        writeSafeFile(projectsJsonPath, JSON.stringify(arr, null, 2) + '\n');
      } catch {}
    }

    return projectDesc;
  }

  public async updateProject(input: UpdateProjectInput): Promise<ProjectDescriptor> {
    const cleanCode = input.code.trim();
    const cleanLower = cleanCode.toLowerCase();

    if (input.name !== undefined) {
      const nameVal = validateProjectName(input.name);
      if (!nameVal.valid) {
        throw new Error(nameVal.error);
      }
    }

    const locations = this.resolveProjectLocations();
    const loc = locations.find((l) => l.project.code.toLowerCase() === cleanLower);
    if (!loc) {
      throw new Error(`Project "${cleanCode}" not found`);
    }

    const updatedDesc: ProjectDescriptor = {
      ...loc.project,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.colors !== undefined ? { colors: input.colors } : {}),
      ...(input.techStack !== undefined ? { techStack: input.techStack } : {}),
      ...(input.groundingRules !== undefined ? { groundingRules: input.groundingRules } : {}),
      ...(input.guidelinesRef !== undefined ? { guidelinesRef: input.guidelinesRef } : {}),
    };

    if (loc.sourceType === 'hub' && loc.hubDir) {
      const projectDir = path.dirname(loc.ticketsDir);
      const pJsonPath = path.join(projectDir, 'project.json');
      let existingPJson: any = {};
      if (fs.existsSync(pJsonPath)) {
        try { existingPJson = JSON.parse(fs.readFileSync(pJsonPath, 'utf-8')); } catch {}
      }
      const mergedPJson = { ...existingPJson, ...updatedDesc };
      writeSafeFile(pJsonPath, JSON.stringify(mergedPJson, null, 2) + '\n');

      const hubProjectsFile = path.join(loc.hubDir, 'projects.json');
      const subHubProjectsFile = path.join(loc.hubDir, 'projects', 'projects.json');
      for (const f of [hubProjectsFile, subHubProjectsFile]) {
        if (fs.existsSync(f)) {
          try {
            const arr: ProjectDescriptor[] = JSON.parse(fs.readFileSync(f, 'utf-8'));
            const idx = arr.findIndex((p) => p.code.toLowerCase() === cleanLower);
            if (idx >= 0) {
              arr[idx] = { ...arr[idx], ...updatedDesc };
              writeSafeFile(f, JSON.stringify(arr, null, 2) + '\n');
            }
          } catch {}
        }
      }
    } else {
      // In-repo or federated
      const projectDir = loc.sourceType === 'federated' ? path.dirname(loc.ticketsDir) : path.join(this.workspaceRoot, '.esedre');
      const candidates = [
        path.join(projectDir, 'project.json'),
        path.join(this.workspaceRoot, '.esedre', 'project.json'),
        path.join(this.workspaceRoot, 'project.json'),
      ];
      for (const pJsonPath of candidates) {
        if (fs.existsSync(pJsonPath)) {
          try {
            const existing = JSON.parse(fs.readFileSync(pJsonPath, 'utf-8'));
            const merged = { ...existing, ...updatedDesc };
            writeSafeFile(pJsonPath, JSON.stringify(merged, null, 2) + '\n');
          } catch {}
        }
      }
      const pJsonListCandidates = [
        path.join(projectDir, 'projects.json'),
        path.join(this.workspaceRoot, '.esedre', 'projects.json'),
        path.join(this.workspaceRoot, 'projects.json'),
      ];
      for (const projectsJsonPath of pJsonListCandidates) {
        if (fs.existsSync(projectsJsonPath)) {
          try {
            const arr: ProjectDescriptor[] = JSON.parse(fs.readFileSync(projectsJsonPath, 'utf-8'));
            const idx = arr.findIndex((p) => p.code.toLowerCase() === cleanLower);
            if (idx >= 0) {
              arr[idx] = { ...arr[idx], ...updatedDesc };
              writeSafeFile(projectsJsonPath, JSON.stringify(arr, null, 2) + '\n');
            }
          } catch {}
        }
      }
    }

    this.refreshConfig();
    return updatedDesc;
  }

  public async renameProjectCode(input: RenameProjectCodeInput): Promise<RenameProjectCodeResult> {
    const cleanOld = input.oldCode.trim();
    const cleanNew = input.newCode.trim();
    const oldLower = cleanOld.toLowerCase();
    const newLower = cleanNew.toLowerCase();

    const codeVal = validateProjectCode(cleanNew);
    if (!codeVal.valid) {
      throw new Error(codeVal.error);
    }

    if (input.newName !== undefined) {
      const nameVal = validateProjectName(input.newName);
      if (!nameVal.valid) {
        throw new Error(nameVal.error);
      }
    }

    const locations = this.resolveProjectLocations();
    const loc = locations.find((l) => l.project.code.toLowerCase() === oldLower);
    if (!loc) {
      throw new Error(`Project "${cleanOld}" not found`);
    }

    if (oldLower !== newLower) {
      const collision = locations.find((l) => l.project.code.toLowerCase() === newLower);
      if (collision) {
        throw new Error(`Project code "${cleanNew}" collides with existing project "${collision.project.code}".`);
      }
    }

    let migratedTicketsCount = 0;
    const updatedHubs: string[] = [];
    const updatedConfigs: string[] = [];

    const updatedDesc: ProjectDescriptor = {
      ...loc.project,
      code: cleanNew,
      ...(input.newName ? { name: input.newName.trim() } : {}),
    };

    if (loc.sourceType === 'hub' && loc.hubDir) {
      const hubDir = loc.hubDir;
      const oldProjectDir = path.dirname(loc.ticketsDir);
      const hubProjectsDir = path.dirname(oldProjectDir);
      const newProjectDir = path.join(hubProjectsDir, cleanNew);

      // Handle folder rename
      if (oldProjectDir.toLowerCase() === newProjectDir.toLowerCase()) {
        // Case-only rename
        if (path.basename(oldProjectDir) !== cleanNew) {
          const tempHop = `${oldProjectDir}__rename_hop_${Date.now()}`;
          fs.renameSync(oldProjectDir, tempHop);
          fs.renameSync(tempHop, newProjectDir);
        }
      } else {
        if (fs.existsSync(newProjectDir)) {
          throw new Error(`Target directory "${newProjectDir}" already exists.`);
        }
        fs.renameSync(oldProjectDir, newProjectDir);
      }

      // Update project.json in target directory
      const pJsonPath = path.join(newProjectDir, 'project.json');
      let existingPJson: any = {};
      if (fs.existsSync(pJsonPath)) {
        try { existingPJson = JSON.parse(fs.readFileSync(pJsonPath, 'utf-8')); } catch {}
      }
      const mergedPJson = { ...existingPJson, ...updatedDesc, code: cleanNew };
      writeSafeFile(pJsonPath, JSON.stringify(mergedPJson, null, 2) + '\n');

      // Update hub projects.json
      const hubProjectsFile = path.join(hubDir, 'projects.json');
      const subHubProjectsFile = path.join(hubDir, 'projects', 'projects.json');
      for (const f of [hubProjectsFile, subHubProjectsFile]) {
        if (fs.existsSync(f)) {
          try {
            const arr: ProjectDescriptor[] = JSON.parse(fs.readFileSync(f, 'utf-8'));
            const idx = arr.findIndex((p) => p.code.toLowerCase() === oldLower);
            if (idx >= 0) {
              arr[idx] = { ...arr[idx], ...updatedDesc, code: cleanNew };
              writeSafeFile(f, JSON.stringify(arr, null, 2) + '\n');
              if (!updatedHubs.includes(f)) updatedHubs.push(f);
            }
          } catch {}
        }
      }

      // Update tickets under newProjectDir/tickets/
      const newTicketsDir = path.join(newProjectDir, 'tickets');
      if (fs.existsSync(newTicketsDir)) {
        try {
          const entries = fs.readdirSync(newTicketsDir, { withFileTypes: true });
          for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            const tMetaPath = path.join(newTicketsDir, ent.name, 'meta.json');
            if (fs.existsSync(tMetaPath)) {
              try {
                const meta = JSON.parse(fs.readFileSync(tMetaPath, 'utf-8'));
                meta.project = cleanNew;
                if (Array.isArray(meta.links)) {
                  for (const l of meta.links) {
                    if (l.targetProject && l.targetProject.toLowerCase() === oldLower) {
                      l.targetProject = cleanNew;
                      l.targetKey = `${cleanNew}-${l.targetId}`;
                    }
                  }
                }
                writeSafeFile(tMetaPath, JSON.stringify(meta, null, 2) + '\n');
                migratedTicketsCount++;
              } catch {}
            }
          }
        } catch {}
      }

      // Update links in other projects pointing to the renamed project code
      for (const otherLoc of locations) {
        if (otherLoc.project.code.toLowerCase() === oldLower) continue;
        if (fs.existsSync(otherLoc.ticketsDir)) {
          try {
            const entries = fs.readdirSync(otherLoc.ticketsDir, { withFileTypes: true });
            for (const ent of entries) {
              if (!ent.isDirectory()) continue;
              const tMetaPath = path.join(otherLoc.ticketsDir, ent.name, 'meta.json');
              if (fs.existsSync(tMetaPath)) {
                try {
                  const meta = JSON.parse(fs.readFileSync(tMetaPath, 'utf-8'));
                  if (Array.isArray(meta.links)) {
                    let changed = false;
                    for (const l of meta.links) {
                      if (l.targetProject && l.targetProject.toLowerCase() === oldLower) {
                        l.targetProject = cleanNew;
                        l.targetKey = `${cleanNew}-${l.targetId}`;
                        changed = true;
                      }
                    }
                    if (changed) {
                      writeSafeFile(tMetaPath, JSON.stringify(meta, null, 2) + '\n');
                    }
                  }
                } catch {}
              }
            }
          } catch {}
        }
      }

      // Update milestones.json under newProjectDir
      const newMilestonesPath = path.join(newProjectDir, 'milestones.json');
      if (fs.existsSync(newMilestonesPath)) {
        try {
          const arr: Milestone[] = JSON.parse(fs.readFileSync(newMilestonesPath, 'utf-8'));
          for (const m of arr) {
            m.project = cleanNew;
          }
          writeSafeFile(newMilestonesPath, JSON.stringify(arr, null, 2) + '\n');
        } catch {}
      }
    } else {
      // In-repo or federated
      const esedreDir = path.join(this.workspaceRoot, '.esedre');
      const pJsonPath = path.join(esedreDir, 'project.json');
      if (fs.existsSync(pJsonPath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(pJsonPath, 'utf-8'));
          writeSafeFile(pJsonPath, JSON.stringify({ ...existing, ...updatedDesc, code: cleanNew }, null, 2) + '\n');
        } catch {}
      }

      const projectsJsonPath = path.join(esedreDir, 'projects.json');
      if (fs.existsSync(projectsJsonPath)) {
        try {
          const arr: ProjectDescriptor[] = JSON.parse(fs.readFileSync(projectsJsonPath, 'utf-8'));
          const idx = arr.findIndex((p) => p.code.toLowerCase() === oldLower);
          if (idx >= 0) {
            arr[idx] = { ...arr[idx], ...updatedDesc, code: cleanNew };
            writeSafeFile(projectsJsonPath, JSON.stringify(arr, null, 2) + '\n');
          }
        } catch {}
      }

      // Update tickets in in-repo tickets directory
      if (fs.existsSync(loc.ticketsDir)) {
        try {
          const entries = fs.readdirSync(loc.ticketsDir, { withFileTypes: true });
          for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            const tMetaPath = path.join(loc.ticketsDir, ent.name, 'meta.json');
            if (fs.existsSync(tMetaPath)) {
              try {
                const meta = JSON.parse(fs.readFileSync(tMetaPath, 'utf-8'));
                meta.project = cleanNew;
                if (Array.isArray(meta.links)) {
                  for (const l of meta.links) {
                    if (l.targetProject && l.targetProject.toLowerCase() === oldLower) {
                      l.targetProject = cleanNew;
                      l.targetKey = `${cleanNew}-${l.targetId}`;
                    }
                  }
                }
                writeSafeFile(tMetaPath, JSON.stringify(meta, null, 2) + '\n');
                migratedTicketsCount++;
              } catch {}
            }
          }
        } catch {}
      }

      const milestonesJsonPath = path.join(esedreDir, 'milestones.json');
      if (fs.existsSync(milestonesJsonPath)) {
        try {
          const arr: Milestone[] = JSON.parse(fs.readFileSync(milestonesJsonPath, 'utf-8'));
          for (const m of arr) {
            if (m.project.toLowerCase() === oldLower) {
              m.project = cleanNew;
            }
          }
          writeSafeFile(milestonesJsonPath, JSON.stringify(arr, null, 2) + '\n');
        } catch {}
      }
    }

    // Workspace configuration update: .esedre/esedre.json
    const workspaceConfigFile = path.join(this.workspaceRoot, '.esedre', 'esedre.json');
    if (fs.existsSync(workspaceConfigFile)) {
      try {
        const wsCfg: EsedreConfig = JSON.parse(fs.readFileSync(workspaceConfigFile, 'utf-8'));
        let modified = false;
        if (wsCfg.projectCode && wsCfg.projectCode.toLowerCase() === oldLower) {
          wsCfg.projectCode = cleanNew;
          if (input.newName) wsCfg.projectName = input.newName.trim();
          modified = true;
        }
        if (Array.isArray(wsCfg.allowedProjects)) {
          const idx = wsCfg.allowedProjects.findIndex((p) => p.toLowerCase() === oldLower);
          if (idx >= 0) {
            wsCfg.allowedProjects[idx] = cleanNew;
            modified = true;
          }
        }
        if (modified) {
          writeSafeFile(workspaceConfigFile, JSON.stringify(wsCfg, null, 2) + '\n');
          updatedConfigs.push(workspaceConfigFile);
        }
      } catch {}
    }

    // Global configuration update: ~/.esedre/config.json
    const globalConfigFile = path.join(os.homedir(), '.esedre', 'config.json');
    if (fs.existsSync(globalConfigFile)) {
      try {
        const gCfg = JSON.parse(fs.readFileSync(globalConfigFile, 'utf-8'));
        let modified = false;
        if (gCfg.projects && typeof gCfg.projects === 'object') {
          for (const [key, val] of Object.entries(gCfg.projects)) {
            if (key.toLowerCase() === oldLower) {
              delete gCfg.projects[key];
              gCfg.projects[cleanNew] = val;
              modified = true;
              break;
            }
          }
        }
        if (modified) {
          writeSafeFile(globalConfigFile, JSON.stringify(gCfg, null, 2) + '\n');
          updatedConfigs.push(globalConfigFile);
        }
      } catch {}
    }

    if (this.config.projectCode && this.config.projectCode.toLowerCase() === oldLower) {
      this.config.projectCode = cleanNew;
      if (input.newName) this.config.projectName = input.newName.trim();
    }
    if (Array.isArray(this.config.allowedProjects)) {
      const idx = this.config.allowedProjects.findIndex((p) => p.toLowerCase() === oldLower);
      if (idx >= 0) {
        this.config.allowedProjects[idx] = cleanNew;
      }
    }

    this.invalidateTicketCache();
    this.invalidateMilestoneCache();
    this.refreshConfig();
    return {
      success: true,
      oldCode: cleanOld,
      newCode: cleanNew,
      project: updatedDesc,
      migratedTicketsCount,
      updatedHubs,
      updatedConfigs,
    };
  }

  public getMilestonesPath(loc: ResolvedProjectLocation): string {
    const parent = path.dirname(loc.ticketsDir);
    return path.join(parent, 'milestones.json');
  }

  public readProjectMilestones(loc: ResolvedProjectLocation): Milestone[] {
    const mPath = this.getMilestonesPath(loc);
    const resolvedPath = path.resolve(mPath);
    if (!fs.existsSync(mPath)) {
      this.milestoneMemoryCache.delete(resolvedPath);
      return [];
    }
    try {
      const stat = fs.statSync(mPath);
      const cached = this.milestoneMemoryCache.get(resolvedPath);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.milestones;
      }
      const raw = fs.readFileSync(mPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const milestones = Array.isArray(parsed) ? parsed : [];
      this.milestoneMemoryCache.set(resolvedPath, {
        milestones,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
      return milestones;
    } catch {
      return [];
    }
  }

  public writeProjectMilestones(loc: ResolvedProjectLocation, milestones: Milestone[]): void {
    const mPath = this.getMilestonesPath(loc);
    writeSafeFile(mPath, JSON.stringify(milestones, null, 2) + '\n');
    this.invalidateMilestoneCache(loc);
    this.invalidateTicketCache();
  }

  public resolveMilestone(milestoneRef: string, localLoc?: ResolvedProjectLocation): Milestone | null {
    const cleanRef = normalizeDashesAndMojibake(milestoneRef).trim();
    if (!cleanRef) return null;

    const locations = this.resolveProjectLocations();

    // 1. Check for compound project notation: "ProjectCode:Milestone" or "ProjectCode:Id"
    const colonIdx = cleanRef.indexOf(':');
    if (colonIdx > 0) {
      const projPrefix = cleanRef.substring(0, colonIdx).trim();
      const targetRef = cleanRef.substring(colonIdx + 1).trim();
      const targetLoc = locations.find((l) => isProjectMatch(l.project.code, projPrefix));
      if (targetLoc) {
        const pMilestones = this.readProjectMilestones(targetLoc);
        const match = pMilestones.find(
          (m) =>
            String(m.id).toLowerCase() === targetRef.toLowerCase() ||
            m.title.toLowerCase() === targetRef.toLowerCase()
        );
        if (match) return { ...match, project: targetLoc.project.code };
      }
    }

    // 2. Check local project location first
    if (localLoc) {
      const localMilestones = this.readProjectMilestones(localLoc);
      const match = localMilestones.find(
        (m) =>
          String(m.id).toLowerCase() === cleanRef.toLowerCase() ||
          m.title.toLowerCase() === cleanRef.toLowerCase()
      );
      if (match) return { ...match, project: localLoc.project.code };
    }

    // 3. Fallback: Search all other registered project locations
    for (const loc of locations) {
      if (localLoc && isProjectMatch(loc.project.code, localLoc.project.code)) continue;
      const list = this.readProjectMilestones(loc);
      const match = list.find(
        (m) =>
          String(m.id).toLowerCase() === cleanRef.toLowerCase() ||
          m.title.toLowerCase() === cleanRef.toLowerCase()
      );
      if (match) return { ...match, project: loc.project.code };
    }

    return null;
  }

  public async listMilestones(projectCode?: string): Promise<Milestone[]> {
    const locations = this.resolveProjectLocations();
    const milestones: Milestone[] = [];
    for (const loc of locations) {
      if (projectCode && projectCode !== 'all') {
        if (!isProjectMatch(loc.project.code, projectCode)) continue;
      }
      const list = this.readProjectMilestones(loc);
      for (const m of list) {
        milestones.push({
          ...m,
          project: loc.project.code,
        });
      }
    }
    return milestones.sort((a, b) => {
      if (a.project !== b.project) return a.project.localeCompare(b.project);
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
  }

  public async getMilestone(id: number | string, projectCode?: string): Promise<Milestone | null> {
    const target = String(id).trim();
    const colonIdx = target.indexOf(':');
    let effectiveProject = projectCode;
    let effectiveId = target;
    if (colonIdx > 0 && (!projectCode || projectCode === 'all')) {
      effectiveProject = target.substring(0, colonIdx).trim();
      effectiveId = target.substring(colonIdx + 1).trim();
    }
    const all = await this.listMilestones(effectiveProject);
    const targetLower = effectiveId.toLowerCase();
    const found = all.find(
      (m) => String(m.id).toLowerCase() === targetLower || m.title.toLowerCase() === targetLower
    );
    return found || null;
  }

  public async createMilestone(input: CreateMilestoneInput): Promise<Milestone> {
    const locations = this.resolveProjectLocations();
    const projectCode = input.projectCode || this.config.projectCode;
    let targetLoc: ResolvedProjectLocation | undefined;
    if (projectCode) {
      targetLoc = locations.find((l) => isProjectMatch(l.project.code, projectCode));
    } else if (locations.length === 1) {
      targetLoc = locations[0];
    }
    if (!targetLoc) {
      throw new Error('Project is required to create a milestone.');
    }

    const existing = this.readProjectMilestones(targetLoc);
    const existingIds = existing
      .map((m) => (typeof m.id === 'number' ? m.id : parseInt(String(m.id), 10)))
      .filter((n) => !isNaN(n));
    const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;

    const now = new Date().toISOString();
    const title = normalizeDashesAndMojibake(input.title).trim();
    if (!title) {
      throw new Error('Milestone title is required.');
    }

    const milestone: Milestone = {
      id: nextId,
      project: targetLoc.project.code,
      title,
      description: input.description ? normalizeDashesAndMojibake(input.description).trim() : undefined,
      status: input.status || 'Planned',
      featureFlag: input.featureFlag ? normalizeDashesAndMojibake(input.featureFlag).trim() : undefined,
      targetDate: input.targetDate ? normalizeDashesAndMojibake(input.targetDate).trim() : undefined,
      createdAt: now,
      updatedAt: now,
    };

    existing.push(milestone);
    this.writeProjectMilestones(targetLoc, existing);
    return milestone;
  }

  public async updateMilestone(id: number | string, input: UpdateMilestoneInput, projectCode?: string): Promise<Milestone> {
    const locations = this.resolveProjectLocations();
    const targetId = String(id).trim().toLowerCase();
    let foundLoc: ResolvedProjectLocation | undefined;
    let foundIndex = -1;

    for (const loc of locations) {
      if (projectCode && projectCode !== 'all' && !isProjectMatch(loc.project.code, projectCode)) continue;
      const list = this.readProjectMilestones(loc);
      const idx = list.findIndex(
        (m) => String(m.id).toLowerCase() === targetId || m.title.toLowerCase() === targetId
      );
      if (idx >= 0) {
        foundLoc = loc;
        foundIndex = idx;
        break;
      }
    }

    if (!foundLoc || foundIndex < 0) {
      throw new Error(`Milestone '${id}' not found.`);
    }

    const now = new Date().toISOString();
    const list = this.readProjectMilestones(foundLoc);
    const m = list[foundIndex];

    if (input.title !== undefined) m.title = normalizeDashesAndMojibake(input.title).trim();
    if (input.description !== undefined) {
      m.description = input.description ? normalizeDashesAndMojibake(input.description).trim() : undefined;
    }
    if (input.status !== undefined) {
      m.status = input.status;
      if (input.status === 'Completed' && !m.completedAt) {
        m.completedAt = now;
      } else if (input.status !== 'Completed') {
        delete m.completedAt;
      }
    }
    if (input.featureFlag !== undefined) {
      if (input.featureFlag === null || input.featureFlag === '' || input.featureFlag.toLowerCase() === 'none') {
        delete m.featureFlag;
      } else {
        m.featureFlag = normalizeDashesAndMojibake(input.featureFlag).trim();
      }
    }
    if (input.targetDate !== undefined) {
      if (input.targetDate === null || input.targetDate === '' || input.targetDate.toLowerCase() === 'none') {
        delete m.targetDate;
      } else {
        m.targetDate = normalizeDashesAndMojibake(input.targetDate).trim();
      }
    }
    m.updatedAt = now;
    m.project = foundLoc.project.code;

    this.writeProjectMilestones(foundLoc, list);
    return m;
  }

  public async deleteMilestone(id: number | string, projectCode?: string): Promise<boolean> {
    const locations = this.resolveProjectLocations();
    const targetId = String(id).trim().toLowerCase();

    for (const loc of locations) {
      if (projectCode && projectCode !== 'all' && !isProjectMatch(loc.project.code, projectCode)) continue;
      const list = this.readProjectMilestones(loc);
      const filtered = list.filter(
        (m) => String(m.id).toLowerCase() !== targetId && m.title.toLowerCase() !== targetId
      );
      if (filtered.length !== list.length) {
        this.writeProjectMilestones(loc, filtered);
        return true;
      }
    }
    return false;
  }

  private findTicketLocation(id: number | string): { loc: ResolvedProjectLocation; ticketDir: string; id: number } | null {
    const locations = this.resolveProjectLocations();
    if (locations.length === 0) return null;

    const strId = String(id).trim();

    // Check if prefixed with project code (e.g. "Prof-35", "Esedre-1", "Prof_35", "Prof:35")
    const prefixMatch = strId.match(/^([a-zA-Z0-9]{1,8})[-_:](\d+)$/i);
    if (prefixMatch) {
      const code = prefixMatch[1].toLowerCase();
      const num = parseInt(prefixMatch[2], 10);
      const loc = locations.find((l) => isProjectMatch(l.project.code, code));
      if (!loc) return null;
      const ticketDir = path.join(loc.ticketsDir, String(num));
      const metaPath = path.join(ticketDir, 'meta.json');
      if (fs.existsSync(metaPath)) {
        if (loc.isSharedDir) {
          try {
            const metaRaw = fs.readFileSync(metaPath, 'utf-8');
            const meta: TicketMeta = JSON.parse(metaRaw);
      meta.type = meta.type || meta.category || 'Feature';
      meta.category = meta.type;
            const mProj = (meta.project || '').toLowerCase();
            if (mProj && mProj !== code && mProj !== loc.project.code.toLowerCase()) {
              return null;
            }
          } catch {}
        }
        return { loc, ticketDir, id: num };
      }
      return null;
    }

    // Pure numeric ID
    const num = typeof id === 'number' ? id : parseInt(strId, 10);
    if (isNaN(num)) return null;

    // Check all candidate locations
    const matches: { loc: ResolvedProjectLocation; ticketDir: string; id: number }[] = [];
    const checkedDirs = new Set<string>();

    for (const loc of locations) {
      const ticketDir = path.join(loc.ticketsDir, String(num));
      const metaPath = path.join(ticketDir, 'meta.json');
      if (!fs.existsSync(metaPath)) continue;

      if (loc.isSharedDir) {
        if (checkedDirs.has(ticketDir)) continue;
        checkedDirs.add(ticketDir);
        try {
          const metaRaw = fs.readFileSync(metaPath, 'utf-8');
          const meta: TicketMeta = JSON.parse(metaRaw);
          const matchedLoc =
            locations.find(
              (l) =>
                (meta.projectId !== undefined && l.project.id === meta.projectId) ||
                (meta.project && l.project.code.toLowerCase() === meta.project.toLowerCase())
            ) || loc;
          matches.push({ loc: matchedLoc, ticketDir, id: num });
        } catch {
          matches.push({ loc, ticketDir, id: num });
        }
      } else {
        matches.push({ loc, ticketDir, id: num });
      }
    }

    if (this.config.projectCode) {
      const prefLower = this.config.projectCode.toLowerCase();
      const preferredMatch = matches.find(
        (m) => m.loc.project.code.toLowerCase() === prefLower
      );
      if (preferredMatch) return preferredMatch;
    }

    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length > 1) {
      const codes = matches.map((m) => m.loc.project.code);
      throw new Error(
        `Ambiguous ticket #${num}: exists in multiple projects (${codes.join(', ')}). Please specify as <ProjectCode>-${num} (e.g. ${codes[0]}-${num}).`
      );
    }

    return null;
  }

  private readTicketFromDir(
    ticketDir: string,
    num: number,
    loc: ResolvedProjectLocation,
    locations: ResolvedProjectLocation[],
    codeToDescriptor?: Map<string, ProjectDescriptor>,
    idToDescriptor?: Map<number | string, ProjectDescriptor>
  ): EsedreTicket | null {
    const resolvedTicketDir = path.resolve(ticketDir);
    const filesToCheck = [
      'meta.json',
      'detail.md',
      'implementation_plan.md',
      'comments.json',
      'answers.json',
      'inline-comments.json',
    ];

    const currentStats: Record<string, { mtimeMs: number; size: number }> = {};
    for (const f of filesToCheck) {
      const p = path.join(ticketDir, f);
      try {
        const st = fs.statSync(p);
        currentStats[f] = { mtimeMs: st.mtimeMs, size: st.size };
      } catch {}
    }

    if (!currentStats['meta.json']) return null;

    const cached = this.ticketMemoryCache.get(resolvedTicketDir);
    if (cached) {
      const cachedKeys = Object.keys(cached.stats);
      const currentKeys = Object.keys(currentStats);
      if (cachedKeys.length === currentKeys.length) {
        let match = true;
        for (const key of currentKeys) {
          const c = cached.stats[key];
          const s = currentStats[key];
          if (!c || c.mtimeMs !== s.mtimeMs || c.size !== s.size) {
            match = false;
            break;
          }
        }
        if (match) {
          let ticket = cached.ticket;
          if (ticket.meta.links && ticket.meta.links.length > 0) {
            ticket = {
              ...ticket,
              meta: { ...ticket.meta, links: ticket.meta.links.map((l) => ({ ...l })) },
            };
            this.enrichTicketLinks(ticket);
          }
          return ticket;
        }
      }
    }

    try {
      const metaPath = path.join(ticketDir, 'meta.json');
      const metaRaw = fs.readFileSync(metaPath, 'utf-8');
      const meta: TicketMeta = JSON.parse(metaRaw);
      meta.id = meta.id ?? num;
      meta.type = meta.type || meta.category || 'Feature';
      meta.category = meta.type;
      if (meta.priority) {
        meta.priority = normalizePriority(meta.priority);
      }

      let effectiveLoc = loc;
      if (loc.isSharedDir) {
        let found: ResolvedProjectLocation | undefined;
        if (idToDescriptor && codeToDescriptor) {
          const desc = (meta.projectId !== undefined ? idToDescriptor.get(meta.projectId) : undefined)
            || (meta.project ? codeToDescriptor.get(meta.project.toLowerCase()) : undefined);
          if (desc) {
            found = locations.find((l) => l.project.code.toLowerCase() === desc.code.toLowerCase());
          }
        } else {
          found = locations.find(
            (l) =>
              (meta.projectId !== undefined && l.project.id === meta.projectId) ||
              (meta.project && l.project.code.toLowerCase() === meta.project.toLowerCase())
          );
        }
        if (found) effectiveLoc = found;
      }

      meta.project = effectiveLoc.project.code;
      meta.projectId = effectiveLoc.project.id;

      if (meta.milestone) {
        meta.milestone = normalizeDashesAndMojibake(meta.milestone);
        const mMatch = this.resolveMilestone(meta.milestone, effectiveLoc);
        if (mMatch?.featureFlag) {
          meta.inheritedFeatureFlag = mMatch.featureFlag;
          if (!meta.featureFlag) {
            meta.featureFlag = mMatch.featureFlag;
          }
        }
      }

      let detail: TicketDetail | undefined;
      const detailPath = path.join(ticketDir, 'detail.md');
      if (currentStats['detail.md']) {
        const raw = fs.readFileSync(detailPath, 'utf-8');
        detail = this.parseDetailMarkdown(raw);
      }

      let planMarkdown: string | undefined;
      const planPath = path.join(ticketDir, 'implementation_plan.md');
      if (currentStats['implementation_plan.md']) {
        planMarkdown = fs.readFileSync(planPath, 'utf-8');
      }

      let comments: TicketComment[] = [];
      const commentsPath = path.join(ticketDir, 'comments.json');
      if (currentStats['comments.json']) {
        try {
          comments = JSON.parse(fs.readFileSync(commentsPath, 'utf-8'));
        } catch {}
      }

      let answers: Record<string, string> | undefined;
      const answersPath = path.join(ticketDir, 'answers.json');
      if (currentStats['answers.json']) {
        try {
          answers = JSON.parse(fs.readFileSync(answersPath, 'utf-8'));
        } catch {}
      }

      let inlineComments: any[] | undefined;
      const inlinesPath = path.join(ticketDir, 'inline-comments.json');
      if (currentStats['inline-comments.json']) {
        try {
          inlineComments = JSON.parse(fs.readFileSync(inlinesPath, 'utf-8'));
        } catch {}
      }

      const ticketObj: EsedreTicket = {
        meta,
        detail,
        planMarkdown,
        comments,
        answers,
        inlineComments,
        projectDescriptor: effectiveLoc.project,
      };
      normalizeTicketFields(ticketObj);
      this.enrichTicketLinks(ticketObj);
      ticketObj.sha1 = computeTicketHash(ticketObj);
      ticketObj.lastHash = ticketObj.sha1;

      this.ticketMemoryCache.set(resolvedTicketDir, {
        ticket: ticketObj,
        stats: currentStats,
      });

      return ticketObj;
    } catch {
      return null;
    }
  }

  public async listTickets(filter?: ListTicketsFilter): Promise<EsedreTicket[]> {
    const locations = this.resolveProjectLocations();
    const tickets: EsedreTicket[] = [];
    const processedSharedTickets = new Set<string>();

    const codeToDescriptor = new Map<string, ProjectDescriptor>();
    const idToDescriptor = new Map<number | string, ProjectDescriptor>();
    for (const l of locations) {
      codeToDescriptor.set(l.project.code.toLowerCase(), l.project);
      if (l.project.id !== undefined) {
        idToDescriptor.set(l.project.id, l.project);
        idToDescriptor.set(String(l.project.id), l.project);
      }
    }

    for (const loc of locations) {
      if (filter?.project && filter.project !== 'all') {
        if (!isProjectMatch(loc.project.code, filter.project)) {
          continue;
        }
      }

      if (!fs.existsSync(loc.ticketsDir)) continue;

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(loc.ticketsDir, { withFileTypes: true });
      } catch {
        continue;
      }

      const activeDirNames = new Set<string>();

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const num = parseInt(entry.name, 10);
        if (isNaN(num)) continue;

        activeDirNames.add(entry.name);
        const ticketDir = path.join(loc.ticketsDir, entry.name);

        if (loc.isSharedDir) {
          const key = `${loc.ticketsDir}:${entry.name}`;
          if (processedSharedTickets.has(key)) continue;
          processedSharedTickets.add(key);
        }

        const ticketObj = this.readTicketFromDir(
          ticketDir,
          num,
          loc,
          locations,
          codeToDescriptor,
          idToDescriptor
        );
        if (!ticketObj) continue;

        const meta = ticketObj.meta;

        if (filter?.project && filter.project !== 'all') {
          if (!isProjectMatch(meta.project, filter.project)) {
            continue;
          }
        }

        if (filter?.milestone) {
          const mFilter = filter.milestone.trim().toLowerCase();
          const targetLoc = (meta.project && locations.find((l) => l.project.code.toLowerCase() === meta.project!.toLowerCase())) || loc;
          const resolvedFilterMilestone = this.resolveMilestone(filter.milestone, targetLoc);
          const mMatch = meta.milestone ? this.resolveMilestone(meta.milestone, targetLoc) : null;
          const matchesDirect = Boolean(meta.milestone && meta.milestone.toLowerCase() === mFilter);
          const matchesResolvedTitle = Boolean(
            resolvedFilterMilestone &&
            meta.milestone &&
            meta.milestone.toLowerCase() === resolvedFilterMilestone.title.toLowerCase()
          );
          const matchesResolvedId = Boolean(
            resolvedFilterMilestone &&
            meta.milestone &&
            String(resolvedFilterMilestone.id).toLowerCase() === meta.milestone.toLowerCase()
          );
          const matchesCompound = Boolean(
            resolvedFilterMilestone &&
            meta.milestone &&
            `${resolvedFilterMilestone.project}:${resolvedFilterMilestone.title}`.toLowerCase() === meta.milestone.toLowerCase()
          );
          const matchesResolvedSelf = Boolean(
            mMatch &&
            (mMatch.title.toLowerCase() === mFilter ||
              String(mMatch.id).toLowerCase() === mFilter ||
              `${mMatch.project}:${mMatch.title}`.toLowerCase() === mFilter ||
              `${mMatch.project}:${mMatch.id}`.toLowerCase() === mFilter)
          );
          if (!matchesDirect && !matchesResolvedTitle && !matchesResolvedId && !matchesCompound && !matchesResolvedSelf) {
            continue;
          }
        }

        if (filter?.status && meta.status !== filter.status) {
          continue;
        }
        if (filter?.category && meta.category !== filter.category) {
          continue;
        }
        if (filter?.priority !== undefined) {
          const fPrio = String(filter.priority).trim().toLowerCase();
          if (fPrio === 'none' || fPrio === 'null') {
            if (meta.priority) {
              continue;
            }
          } else {
            if (!meta.priority || meta.priority.toLowerCase() !== fPrio) {
              continue;
            }
          }
        }
        if (filter?.search) {
          const term = filter.search.toLowerCase();
          const matchesTitle = meta.title.toLowerCase().includes(term);
          const matchesNum = String(meta.id).includes(term) || `${meta.project}-${meta.id}`.toLowerCase().includes(term);
          if (!matchesTitle && !matchesNum) {
            continue;
          }
        }

        if (filter?.isBlocked !== undefined && Boolean(ticketObj.isBlocked) !== Boolean(filter.isBlocked)) {
          continue;
        }
        if (filter?.linkedTo) {
          const target = filter.linkedTo.trim().toLowerCase();
          const hasLink = ticketObj.meta.links?.some((l) => {
            const tk = l.targetKey.toLowerCase();
            const idStr = String(l.targetId);
            return tk === target || idStr === target;
          });
          if (!hasLink) {
            continue;
          }
        }

        tickets.push(ticketObj);
      }

      // Tombstone pruning for this location: remove any cache entries for deleted ticket folders
      const locResolvedDir = path.resolve(loc.ticketsDir);
      for (const cachedPath of this.ticketMemoryCache.keys()) {
        if (cachedPath.startsWith(locResolvedDir + path.sep)) {
          const folderName = path.basename(cachedPath);
          if (!activeDirNames.has(folderName)) {
            this.ticketMemoryCache.delete(cachedPath);
          }
        }
      }
    }

    return tickets.sort((a, b) => {
      if (a.meta.project !== b.meta.project) {
        return (a.meta.project || '').localeCompare(b.meta.project || '');
      }
      return a.meta.id - b.meta.id;
    });
  }

  public async getTicket(id: number | string): Promise<EsedreTicket | null> {
    const locInfo = this.findTicketLocation(id);
    if (!locInfo) return null;
    const locations = this.resolveProjectLocations();
    return this.readTicketFromDir(locInfo.ticketDir, locInfo.id, locInfo.loc, locations);
  }

  private parseDetailMarkdown(raw: string): TicketDetail {
    const titleMatch = raw.match(/^#\s*(?:Ticket\s*#?\d+\s*:\s*|\d+\s*:\s*)?([^\n]+)/im);
    const title = titleMatch ? titleMatch[1].trim() : 'Untitled Ticket';

    const typeMatch = raw.match(/\*\*(?:Type|Category)\*\*:\s*([^\n]+)/i);
    const type = (typeMatch ? typeMatch[1].trim() : 'Feature') as TicketType;
    const category = type;

    const complexityMatch = raw.match(/\*\*Complexity\*\*:\s*([^\n]+)/i);
    const complexity = complexityMatch ? complexityMatch[1].trim() : 'Medium';

    const effortMatch = raw.match(/\*\*Estimated Effort\*\*:\s*([^\n]+)/i);
    const estimatedEffort = effortMatch ? effortMatch[1].trim() : '2.0 - 4.0 hours';

    let summary: string | undefined;
    const summaryMatch = raw.match(/(?:##|###)\s*(?:Summary|Rationale)\s*\n([\s\S]*?)(?=\n##|\n###|\n#|$)/i);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    }

    const breakdown: string[] = [];
    const breakdownMatch = raw.match(/(?:##|###)\s*Feature Breakdown\s*\n([\s\S]*?)(?=\n##|\n###|\n#|$)/i);
    if (breakdownMatch) {
      const lines = breakdownMatch[1].split('\n');
      for (const line of lines) {
        const itemMatch = line.match(/^\s*(?:\d+\.|\*|-)\s+(.*)/);
        if (itemMatch) breakdown.push(itemMatch[1].trim());
      }
    }

    const technicalDetails: string[] = [];
    const techMatch = raw.match(/###\s*(?:Technical Details?|Architecture)\s*\n+([\s\S]*?)(?=\n###|\n---|\n##|$)/i);
    if (techMatch) {
      const lines = techMatch[1].split('\n');
      for (const line of lines) {
        const itemMatch = line.match(/^\s*(?:\d+\.|\*|-)\s+(.*)/);
        if (itemMatch) technicalDetails.push(itemMatch[1].trim());
      }
    }

    const openQuestions: string[] = [];
    const questionsMatch = raw.match(/###\s*(?:Open Questions?|Technical Detail & Open Questions?|Decisions)\s*\n+([\s\S]*?)(?=\n###|\n---|\n##|$)/i);
    if (questionsMatch) {
      const lines = questionsMatch[1].split('\n');
      for (const line of lines) {
        const itemMatch = line.match(/^\s*(?:\d+\.|\*|-)\s+(.*)/);
        if (itemMatch) openQuestions.push(itemMatch[1].trim());
      }
    }

    const priorityMatch = raw.match(/\*\*Priority\*\*:\s*([^\n]+)/i);
    const priority = priorityMatch ? normalizePriority(priorityMatch[1].trim()) : undefined;

    return {
      title,
      type,
      category,
      priority,
      complexity,
      estimatedEffort,
      summary,
      breakdown,
      technicalDetails,
      openQuestions,
      raw,
    };
  }

  public async createTicket(input: CreateTicketInput): Promise<EsedreTicket> {
    const locations = this.resolveProjectLocations();
    if (locations.length === 0) {
      throw new Error('No projects registered in workspace. Please configure projects before creating tickets.');
    }

    const requestedIdentifier = input.projectCode || input.projectId || this.config.projectCode;
    let targetLoc: ResolvedProjectLocation | undefined;

    if (requestedIdentifier) {
      const lower = String(requestedIdentifier).trim().toLowerCase();
      targetLoc = locations.find(
        (l) =>
          l.project.code?.toLowerCase() === lower ||
          String(l.project.id) === lower ||
          l.project.name?.toLowerCase() === lower
      );
      if (!targetLoc) {
        throw new Error(`Project '${requestedIdentifier}' is invalid or not registered in this workspace.`);
      }
    } else if (locations.length === 1) {
      targetLoc = locations[0];
    } else {
      const availableCodes = locations.map((l) => l.project.code).join(', ');
      throw new Error(`Project is required to create a ticket (available: ${availableCodes}).`);
    }

    if (!fs.existsSync(targetLoc.ticketsDir)) {
      fs.mkdirSync(targetLoc.ticketsDir, { recursive: true });
    }

    const existing = fs.readdirSync(targetLoc.ticketsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !isNaN(parseInt(d.name, 10)))
      .map((d) => parseInt(d.name, 10));
    const nextId = existing.length > 0 ? Math.max(...existing) + 1 : 1;

    const ticketDir = path.join(targetLoc.ticketsDir, String(nextId));
    fs.mkdirSync(ticketDir, { recursive: true });

    const now = new Date().toISOString();
    const effectiveType = (input.type || input.category || 'Feature') as TicketType;
    const cleanTitle = normalizeDashesAndMojibake(input.title).slice(0, 48).trim();
    const cleanEffort = normalizeDashesAndMojibake(input.estimatedEffort || input.effort || '2.0 - 4.0 hours');
    const cleanComplexity = normalizeDashesAndMojibake(input.complexity || 'Medium');
    const cleanPriority = normalizePriority(input.priority);
    let cleanMilestone = input.milestone ? normalizeDashesAndMojibake(String(input.milestone)).trim() : undefined;
    let inheritedFlag: string | undefined;
    let initialFlag: string | undefined;

    if (cleanMilestone) {
      const pMilestones = this.readProjectMilestones(targetLoc);
      const mMatch = pMilestones.find(
        (m) =>
          String(m.id).toLowerCase() === cleanMilestone?.toLowerCase() ||
          m.title.toLowerCase() === cleanMilestone?.toLowerCase()
      );
      if (mMatch?.featureFlag) {
        inheritedFlag = mMatch.featureFlag;
        initialFlag = mMatch.featureFlag;
      }
    }

    let cleanFeatureFlag = input.featureFlag ? normalizeDashesAndMojibake(input.featureFlag).trim() : undefined;
    if (!cleanFeatureFlag && initialFlag) {
      cleanFeatureFlag = initialFlag;
    }

    const cleanSummary = input.summary ? normalizeDashesAndMojibake(input.summary) : undefined;
    const cleanDetailRaw = (input.detailMarkdown || input.detail) ? normalizeDashesAndMojibake(input.detailMarkdown || input.detail) : undefined;

    const meta: TicketMeta = {
      id: nextId,
      title: cleanTitle,
      type: effectiveType,
      category: effectiveType,
      ...(cleanPriority ? { priority: cleanPriority } : {}),
      ...(cleanMilestone ? { milestone: cleanMilestone } : {}),
      ...(cleanFeatureFlag ? { featureFlag: cleanFeatureFlag } : {}),
      ...(inheritedFlag ? { inheritedFeatureFlag: inheritedFlag } : {}),
      complexity: cleanComplexity,
      estimatedEffort: cleanEffort,
      submittedBy: input.submittedBy || 'Developer',
      timestamp: now,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      isActivePlanning: false,
      status: 'Planned',
      projectId: targetLoc.project.id,
      project: targetLoc.project.code,
    };

    const rawDetail = cleanDetailRaw?.trim();
    const priorityLine = meta.priority ? `**Priority**: ${meta.priority}  \n` : '';
    const milestoneLine = meta.milestone ? `**Milestone**: ${meta.milestone}  \n` : '';
    let detailMd: string;

    if (rawDetail) {
      if (/^#\s+[^\n]+/m.test(rawDetail)) {
        // Starts with or contains a top-level single-hash heading (# Title)
        let processed = rawDetail.replace(/^#\s+[^\n]+/m, `# Ticket #${nextId}: ${meta.title}`);
        if (!/\*\*(?:Type|Category)\*\*:/i.test(processed)) {
          const metaBlock = `\n**Category**: ${meta.category}  \n${priorityLine}${milestoneLine}**Complexity**: ${meta.complexity}  \n**Estimated Effort**: ${meta.estimatedEffort}  \n`;
          processed = processed.replace(/^(# Ticket[^\n]+\n)/m, `$1${metaBlock}`);
        }
        if (!/(?:##|###)\s*(?:Summary|Rationale)/i.test(processed)) {
          const summaryBlock = `\n### Summary\n${input.summary || 'Summary to be defined.'}\n`;
          processed = processed.replace(/^((?:# Ticket[^\n]+\n)(?:\*\*[^\n]+\n)*)/m, `$1${summaryBlock}`);
        }
        detailMd = processed.endsWith('\n') ? processed : `${processed}\n`;
      } else {
        // Sub-headings (##, ###) or plain body text
        const hasSummary = /(?:##|###)\s*(?:Summary|Rationale)/i.test(rawDetail);
        const hasBreakdown = /(?:##|###)\s*Feature Breakdown/i.test(rawDetail);

        let body = '';
        if (!hasSummary) {
          body += `### Summary\n${input.summary || 'Summary to be defined.'}\n\n`;
        }
        if (!hasBreakdown && !rawDetail.startsWith('#')) {
          body += `### Feature Breakdown\n${rawDetail}\n\n### Technical Details & Architecture\n- Architecture specifications to be documented.\n\n### Open Questions & Decisions\n- None recorded at initialization.\n`;
        } else {
          body += `${rawDetail}\n`;
        }

        detailMd = `# Ticket #${nextId}: ${meta.title}
**Category**: ${meta.category}  
${priorityLine}${milestoneLine}**Complexity**: ${meta.complexity}  
**Estimated Effort**: ${meta.estimatedEffort}  

${body.trim()}\n`;
      }
    } else {
      detailMd = `# Ticket #${nextId}: ${meta.title}
**Category**: ${meta.category}  
${priorityLine}${milestoneLine}**Complexity**: ${meta.complexity}  
**Estimated Effort**: ${meta.estimatedEffort}  

### Summary
${input.summary || 'Summary to be defined.'}

### Feature Breakdown
1. **Initial Requirement**:
   - Details to be populated during planning.

### Technical Details & Architecture
- Architecture specifications to be documented.

### Open Questions & Decisions
- None recorded at initialization.
`;
    }

    writeSafeFile(path.join(ticketDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
    writeSafeFile(path.join(ticketDir, 'detail.md'), detailMd);
    this.invalidateTicketCache(ticketDir);

    const created = await this.getTicket(`${targetLoc.project.code}-${nextId}`);
    return created!;
  }

  public async updateTicket(id: number | string, updates: Partial<TicketMeta> & { priority?: any }, lastHash?: string): Promise<EsedreTicket> {
    const existing = await this.getTicket(id);
    if (!existing) {
      throw new Error(`Ticket #${id} does not exist`);
    }

    if (lastHash !== undefined) {
      const currentHash = existing.sha1 || computeTicketHash(existing);
      if (!verifyTicketHash(currentHash, lastHash)) {
        throw new EsedreConflictError(id, currentHash, lastHash);
      }
    }

    const locInfo = this.findTicketLocation(id);
    if (!locInfo) {
      throw new Error(`Ticket #${id} could not be located on disk`);
    }

    const metaPath = path.join(locInfo.ticketDir, 'meta.json');
    const now = new Date().toISOString();
    const isNowCompleted = updates.status === 'Completed';
    const completedAt = isNowCompleted
      ? existing.meta.completedAt || now
      : (updates.status && updates.status !== 'Completed' ? undefined : existing.meta.completedAt);
    const revision = (existing.meta.revision || 1) + 1;

    const sanitizedUpdates: Partial<TicketMeta> = { ...updates };
    if (sanitizedUpdates.title) sanitizedUpdates.title = normalizeDashesAndMojibake(sanitizedUpdates.title);
    if (sanitizedUpdates.estimatedEffort) sanitizedUpdates.estimatedEffort = normalizeDashesAndMojibake(sanitizedUpdates.estimatedEffort);
    if (sanitizedUpdates.complexity) sanitizedUpdates.complexity = normalizeDashesAndMojibake(sanitizedUpdates.complexity);

    const updatedMeta: TicketMeta = {
      ...existing.meta,
      ...sanitizedUpdates,
      id: locInfo.id,
      project: locInfo.loc.project.code,
      updatedAt: now,
      completedAt,
      revision,
    };

    if ('priority' in updates || updates.priority !== undefined) {
      const rawPrio = updates.priority;
      if (rawPrio === null || rawPrio === 'none' || rawPrio === 'null' || rawPrio === '') {
        delete updatedMeta.priority;
      } else {
        const norm = normalizePriority(rawPrio);
        if (norm) {
          updatedMeta.priority = norm;
        } else {
          delete updatedMeta.priority;
        }
      }
    }

    if ('milestone' in updates || updates.milestone !== undefined) {
      const rawMilestone = updates.milestone;
      if (rawMilestone === null || rawMilestone === 'none' || rawMilestone === 'null' || rawMilestone === '') {
        delete updatedMeta.milestone;
        if (updatedMeta.inheritedFeatureFlag && updatedMeta.featureFlag === updatedMeta.inheritedFeatureFlag) {
          delete updatedMeta.featureFlag;
        }
        delete updatedMeta.inheritedFeatureFlag;
      } else {
        updatedMeta.milestone = normalizeDashesAndMojibake(String(rawMilestone)).trim();
        const pMilestones = this.readProjectMilestones(locInfo.loc);
        const mMatch = pMilestones.find(
          (m) =>
            String(m.id).toLowerCase() === updatedMeta.milestone?.toLowerCase() ||
            m.title.toLowerCase() === updatedMeta.milestone?.toLowerCase()
        );
        if (mMatch?.featureFlag) {
          updatedMeta.inheritedFeatureFlag = mMatch.featureFlag;
          if (!updatedMeta.featureFlag) {
            updatedMeta.featureFlag = mMatch.featureFlag;
          }
        }
      }
    }

    writeSafeFile(metaPath, JSON.stringify(updatedMeta, null, 2) + '\n');

    const newType = updates.type || updates.category;
    if (newType) { updatedMeta.type = newType; updatedMeta.category = newType; }
    if (existing.detail && ('priority' in updates || 'milestone' in updates || updates.title || updates.type || updates.category || updates.complexity || updates.estimatedEffort)) {
      let content = existing.detail.raw;
      if (updates.title) {
        content = content.replace(/^#\s*(?:Ticket\s*#?\d+\s*:\s*|\d+\s*:\s*)?[^\n]+/im, `# Ticket #${locInfo.id}: ${updatedMeta.title}`);
      }
      if (updates.type || updates.category) {
        content = content.replace(/\*\*(?:Type|Category)\*\*:\s*[^\n]+/i, `**Type**: ${updatedMeta.type}`);
      }
      if ('priority' in updates) {
        if (updatedMeta.priority) {
          if (/\*\*Priority\*\*:\s*[^\n]+/i.test(content)) {
            content = content.replace(/\*\*Priority\*\*:\s*[^\n]+/i, `**Priority**: ${updatedMeta.priority}`);
          } else if (/\*\*(?:Type|Category)\*\*:\s*[^\n]+/i.test(content)) {
            content = content.replace(/(\*\*(?:Type|Category)\*\*:\s*[^\n]+)/i, `$1  \n**Priority**: ${updatedMeta.priority}`);
          }
        } else {
          content = content.replace(/\*\*Priority\*\*:\s*[^\n]+\n?/i, '');
        }
      }
      if ('milestone' in updates) {
        if (updatedMeta.milestone) {
          if (/\*\*Milestone\*\*:\s*[^\n]+/i.test(content)) {
            content = content.replace(/\*\*Milestone\*\*:\s*[^\n]+/i, `**Milestone**: ${updatedMeta.milestone}`);
          } else if (/\*\*(?:Priority|Type|Category)\*\*:\s*[^\n]+/i.test(content)) {
            content = content.replace(/(\*\*(?:Priority|Type|Category)\*\*:\s*[^\n]+)/i, `$1  \n**Milestone**: ${updatedMeta.milestone}`);
          }
        } else {
          content = content.replace(/\*\*Milestone\*\*:\s*[^\n]+\n?/i, '');
        }
      }
      if (updates.complexity) {
        content = content.replace(/\*\*Complexity\*\*:\s*[^\n]+/i, `**Complexity**: ${updatedMeta.complexity}`);
      }
      if (updates.estimatedEffort) {
        content = content.replace(/\*\*Estimated Effort\*\*:\s*[^\n]+/i, `**Estimated Effort**: ${updatedMeta.estimatedEffort}`);
      }
      writeSafeFile(path.join(locInfo.ticketDir, 'detail.md'), content);
    }
    this.invalidateTicketCache(locInfo.ticketDir);

    return (await this.getTicket(`${locInfo.loc.project.code}-${locInfo.id}`))!;
  }

  public async getPlan(id: number | string): Promise<string | null> {
    const locInfo = this.findTicketLocation(id);
    if (!locInfo) return null;

    const planPath = path.join(locInfo.ticketDir, 'implementation_plan.md');
    if (!fs.existsSync(planPath)) return null;
    return normalizeDashesAndMojibake(fs.readFileSync(planPath, 'utf-8'));
  }

  public async savePlan(id: number | string, planMarkdown: string, lastHash?: string): Promise<void> {
    const ticket = await this.getTicket(id);
    if (!ticket) {
      throw new Error(`Ticket #${id} does not exist`);
    }

    if (lastHash !== undefined) {
      const currentHash = ticket.sha1 || computeTicketHash(ticket);
      if (!verifyTicketHash(currentHash, lastHash)) {
        throw new EsedreConflictError(id, currentHash, lastHash);
      }
    }

    const locInfo = this.findTicketLocation(id);
    if (!locInfo) {
      throw new Error(`Ticket #${id} could not be located on disk`);
    }

    const planPath = path.join(locInfo.ticketDir, 'implementation_plan.md');
    writeSafeFile(planPath, normalizeDashesAndMojibake(planMarkdown));

    const metaPath = path.join(locInfo.ticketDir, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        meta.updatedAt = new Date().toISOString();
        meta.revision = (meta.revision || 1) + 1;
        writeSafeFile(metaPath, JSON.stringify(meta, null, 2) + '\n');
      } catch {}
    }
    this.invalidateTicketCache(locInfo.ticketDir);
  }

  public async addComment(id: number | string, comment: { author: string; text: string }): Promise<TicketComment> {
    const ticket = await this.getTicket(id);
    if (!ticket) {
      throw new Error(`Ticket #${id} does not exist`);
    }

    const locInfo = this.findTicketLocation(id);
    if (!locInfo) {
      throw new Error(`Ticket #${id} could not be located on disk`);
    }

    const commentsPath = path.join(locInfo.ticketDir, 'comments.json');
    let comments: TicketComment[] = [];
    if (fs.existsSync(commentsPath)) {
      try {
        comments = JSON.parse(fs.readFileSync(commentsPath, 'utf-8'));
      } catch {}
    }

    const newComment: TicketComment = {
      id: `${locInfo.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      author: normalizeDashesAndMojibake(comment.author || 'User'),
      text: normalizeDashesAndMojibake(comment.text.trim()),
    };

    comments.push(newComment);
    writeSafeFile(commentsPath, JSON.stringify(comments, null, 2) + '\n');
    this.invalidateTicketCache(locInfo.ticketDir);
    return newComment;
  }

  public async getAnswers(id: number | string): Promise<Record<string, string>> {
    const locInfo = this.findTicketLocation(id);
    if (!locInfo) return {};

    const answersPath = path.join(locInfo.ticketDir, 'answers.json');
    if (!fs.existsSync(answersPath)) return {};
    try {
      return JSON.parse(fs.readFileSync(answersPath, 'utf-8'));
    } catch {
      return {};
    }
  }

  public async saveAnswer(id: number | string, questionIndex: number, answer: string): Promise<Record<string, string>> {
    const locInfo = this.findTicketLocation(id);
    if (!locInfo) {
      throw new Error(`Ticket #${id} could not be located on disk`);
    }

    const answersPath = path.join(locInfo.ticketDir, 'answers.json');
    let currentAnswers: Record<string, string> = {};
    if (fs.existsSync(answersPath)) {
      try {
        currentAnswers = JSON.parse(fs.readFileSync(answersPath, 'utf-8'));
      } catch {}
    }

    currentAnswers[String(questionIndex)] = normalizeDashesAndMojibake(answer);
    writeSafeFile(answersPath, JSON.stringify(currentAnswers, null, 2) + '\n');
    this.invalidateTicketCache(locInfo.ticketDir);
    return currentAnswers;
  }

  public async saveDetail(
    id: number | string,
    detailMarkdown: string,
    metaUpdates?: Partial<TicketMeta>
  ): Promise<{ success: boolean; meta?: TicketMeta; detail?: string }> {
    const locInfo = this.findTicketLocation(id);
    if (!locInfo) {
      throw new Error(`Ticket #${id} could not be located on disk`);
    }

    let updatedMeta: TicketMeta | undefined;
    if (metaUpdates && Object.keys(metaUpdates).length > 0) {
      const updatedTicket = await this.updateTicket(id, metaUpdates);
      updatedMeta = updatedTicket.meta;
    } else {
      const metaPath = path.join(locInfo.ticketDir, 'meta.json');
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          meta.updatedAt = new Date().toISOString();
          meta.revision = (meta.revision || 1) + 1;
          writeSafeFile(metaPath, JSON.stringify(meta, null, 2) + '\n');
        } catch {}
      }
    }

    const detailPath = path.join(locInfo.ticketDir, 'detail.md');
    writeSafeFile(detailPath, normalizeDashesAndMojibake(detailMarkdown));
    this.invalidateTicketCache(locInfo.ticketDir);

    const finalTicket = await this.getTicket(`${locInfo.loc.project.code}-${locInfo.id}`);
    return {
      success: true,
      meta: finalTicket?.meta || updatedMeta,
      detail: detailMarkdown,
    };
  }

  public async getInlineComments(id: number | string): Promise<any[]> {
    const locInfo = this.findTicketLocation(id);
    if (!locInfo) return [];

    const inlinesPath = path.join(locInfo.ticketDir, 'inline-comments.json');
    if (!fs.existsSync(inlinesPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(inlinesPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  public async saveInlineComment(
    id: number | string,
    selectedText: string,
    comment: string,
    author?: string
  ): Promise<any[]> {
    const locInfo = this.findTicketLocation(id);
    if (!locInfo) {
      throw new Error(`Ticket #${id} could not be located on disk`);
    }

    const inlinesPath = path.join(locInfo.ticketDir, 'inline-comments.json');
    let currentInlines: any[] = [];
    if (fs.existsSync(inlinesPath)) {
      try {
        currentInlines = JSON.parse(fs.readFileSync(inlinesPath, 'utf-8'));
      } catch {}
    }

    const newEntry = {
      id: `${locInfo.id}-ic-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      selectedText: normalizeDashesAndMojibake(selectedText),
      comment: normalizeDashesAndMojibake(comment.trim()),
      author: normalizeDashesAndMojibake(author || 'Developer'),
      timestamp: new Date().toISOString(),
    };
    currentInlines.push(newEntry);
    writeSafeFile(inlinesPath, JSON.stringify(currentInlines, null, 2) + '\n');
    this.invalidateTicketCache(locInfo.ticketDir);
    return currentInlines;
  }

  public async saveAttachment(
    id: number | string,
    filename: string,
    buffer: Buffer
  ): Promise<{ filename: string; relativePath: string }> {
    const locInfo = this.findTicketLocation(id);
    if (!locInfo) {
      throw new Error(`Ticket #${id} could not be located on disk`);
    }

    const attachmentsDir = path.join(locInfo.ticketDir, 'attachments');
    if (!fs.existsSync(attachmentsDir)) {
      fs.mkdirSync(attachmentsDir, { recursive: true });
    }

    const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
    if (buffer.length > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new Error(`Attachment exceeds maximum allowable size of 10MB (received ${(buffer.length / (1024 * 1024)).toFixed(1)}MB)`);
    }

    const MAX_TICKET_ATTACHMENTS = 30;
    const existingFiles = fs.readdirSync(attachmentsDir);
    if (existingFiles.length >= MAX_TICKET_ATTACHMENTS) {
      throw new Error(`Ticket #${id} has reached the maximum allowed limit of ${MAX_TICKET_ATTACHMENTS} attachments`);
    }

    let safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeName || safeName === '.' || safeName === '..' || safeName.replace(/_/g, '') === '') {
      safeName = `attachment_${Date.now()}`;
    }
    let targetFile = path.join(attachmentsDir, safeName);
    if (fs.existsSync(targetFile)) {
      const ext = path.extname(safeName);
      const nameWithoutExt = path.basename(safeName, ext);
      safeName = `${nameWithoutExt}_${Date.now()}${ext}`;
      targetFile = path.join(attachmentsDir, safeName);
    }
    writeSafeFile(targetFile, buffer);
    this.invalidateTicketCache(locInfo.ticketDir);
    return { filename: safeName, relativePath: `attachments/${safeName}` };
  }

  public getAttachmentPath(id: number | string, filename: string): string | null {
    const locInfo = this.findTicketLocation(id);
    if (!locInfo) return null;
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeName || safeName === '.' || safeName === '..') return null;
    const attachmentsDir = path.resolve(locInfo.ticketDir, 'attachments');
    const target = path.resolve(attachmentsDir, safeName);
    if (!target.startsWith(attachmentsDir)) return null;
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      return target;
    }
    return null;
  }

  public resolveTicketIdentifier(
    id: number | string,
    defaultProject?: string
  ): { loc: ResolvedProjectLocation; ticketDir: string; id: number; key: string; project: string } | null {
    const str = String(id).trim();
    if (!/^([a-zA-Z0-9]{1,8})[-_:](\d+)$/i.test(str) && defaultProject && defaultProject !== 'all') {
      const candidate = this.findTicketLocation(`${defaultProject}-${str}`);
      if (candidate) {
        return {
          ...candidate,
          key: `${candidate.loc.project.code}-${candidate.id}`,
          project: candidate.loc.project.code,
        };
      }
    }
    const loc = this.findTicketLocation(id);
    if (!loc) return null;
    return {
      ...loc,
      key: `${loc.loc.project.code}-${loc.id}`,
      project: loc.loc.project.code,
    };
  }

  private wouldCreateCycle(
    sourceKey: string,
    targetKey: string,
    relation: TicketLinkRelation
  ): boolean {
    if (relation !== 'blocks' && relation !== 'parent-of') {
      return false;
    }
    const sLower = sourceKey.toLowerCase();
    const visited = new Set<string>();
    const queue = [targetKey.toLowerCase()];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === sLower) {
        return true;
      }
      if (visited.has(current)) continue;
      visited.add(current);

      const loc = this.findTicketLocation(current);
      if (!loc) continue;
      const metaPath = path.join(loc.ticketDir, 'meta.json');
      if (!fs.existsSync(metaPath)) continue;
      try {
        const meta: TicketMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (Array.isArray(meta.links)) {
          for (const l of meta.links) {
            if (l.relation === relation) {
              queue.push(l.targetKey.toLowerCase());
            }
          }
        }
      } catch {}
    }
    return false;
  }

  public enrichTicketLinks(ticket: EsedreTicket): void {
    if (!ticket.meta.links || ticket.meta.links.length === 0) {
      ticket.links = [];
      ticket.isBlocked = false;
      return;
    }

    const enriched: EnrichedTicketLink[] = [];
    let isBlocked = false;

    for (const link of ticket.meta.links) {
      const enrichedLink: EnrichedTicketLink = { ...link, isResolved: false };
      const targetLoc = this.findTicketLocation(link.targetKey);
      if (targetLoc) {
        const targetMetaPath = path.join(targetLoc.ticketDir, 'meta.json');
        if (fs.existsSync(targetMetaPath)) {
          try {
            const targetMeta: TicketMeta = JSON.parse(fs.readFileSync(targetMetaPath, 'utf-8'));
            enrichedLink.targetTitle = targetMeta.title;
            enrichedLink.targetType = targetMeta.type || targetMeta.category || 'Feature';
            enrichedLink.targetStatus = targetMeta.status || 'Planned';
            enrichedLink.isTargetCompleted = targetMeta.status === 'Completed';
            if (targetMeta.priority) {
              enrichedLink.targetPriority = normalizePriority(targetMeta.priority);
            }
            enrichedLink.isResolved = true;
            if (link.relation === 'blocked-by' && targetMeta.status !== 'Completed') {
              enrichedLink.isBlockedByUncompleted = true;
              isBlocked = true;
            }
          } catch {}
        }
      }
      enriched.push(enrichedLink);
    }

    ticket.links = enriched;
    ticket.isBlocked = isBlocked;
  }

  public async addTicketLink(
    sourceId: number | string,
    relation: TicketLinkRelation,
    targetId: number | string,
    options?: { author?: string; project?: string }
  ): Promise<{ source: EsedreTicket; target?: EsedreTicket }> {
    if (!INVERSE_RELATIONS[relation]) {
      throw new Error(
        `Invalid link relation: "${relation}". Valid relations: ${Object.keys(INVERSE_RELATIONS).join(', ')}`
      );
    }

    const sourceInfo = this.resolveTicketIdentifier(sourceId, options?.project);
    if (!sourceInfo) {
      throw new Error(`Source ticket #${sourceId} could not be located.`);
    }

    const targetInfo = this.resolveTicketIdentifier(targetId, options?.project || sourceInfo.project);
    if (!targetInfo) {
      throw new Error(`Target ticket #${targetId} could not be located.`);
    }

    if (sourceInfo.key.toLowerCase() === targetInfo.key.toLowerCase()) {
      throw new Error(`Cannot link ticket ${sourceInfo.key} to itself.`);
    }

    if (this.wouldCreateCycle(sourceInfo.key, targetInfo.key, relation)) {
      throw new Error(
        `Circular dependency detected: linking ${sourceInfo.key} -> ${targetInfo.key} with "${relation}" forms a cycle.`
      );
    }

    const now = new Date().toISOString();
    const sourceMetaPath = path.join(sourceInfo.ticketDir, 'meta.json');
    const sourceMeta: TicketMeta = JSON.parse(fs.readFileSync(sourceMetaPath, 'utf-8'));
    sourceMeta.links = sourceMeta.links || [];

    const existingSourceLink = sourceMeta.links.find(
      (l) => l.targetKey.toLowerCase() === targetInfo.key.toLowerCase()
    );

    if (existingSourceLink) {
      existingSourceLink.relation = relation;
      existingSourceLink.targetProject = targetInfo.project;
      existingSourceLink.targetId = targetInfo.id;
    } else {
      sourceMeta.links.push({
        relation,
        targetKey: targetInfo.key,
        targetProject: targetInfo.project,
        targetId: targetInfo.id,
        createdAt: now,
        createdBy: options?.author ? normalizeDashesAndMojibake(options.author) : undefined,
      });
    }

    sourceMeta.updatedAt = now;
    sourceMeta.revision = (sourceMeta.revision || 1) + 1;
    writeSafeFile(sourceMetaPath, JSON.stringify(sourceMeta, null, 2) + '\n');
    this.invalidateTicketCache(sourceInfo.ticketDir);

    // Update target ticket bi-directionally if accessible
    let updatedTarget: EsedreTicket | undefined;
    const targetMetaPath = path.join(targetInfo.ticketDir, 'meta.json');
    if (fs.existsSync(targetMetaPath)) {
      try {
        const targetMeta: TicketMeta = JSON.parse(fs.readFileSync(targetMetaPath, 'utf-8'));
        targetMeta.links = targetMeta.links || [];
        const inverseRel = INVERSE_RELATIONS[relation];
        const existingTargetLink = targetMeta.links.find(
          (l) => l.targetKey.toLowerCase() === sourceInfo.key.toLowerCase()
        );

        if (existingTargetLink) {
          existingTargetLink.relation = inverseRel;
          existingTargetLink.targetProject = sourceInfo.project;
          existingTargetLink.targetId = sourceInfo.id;
        } else {
          targetMeta.links.push({
            relation: inverseRel,
            targetKey: sourceInfo.key,
            targetProject: sourceInfo.project,
            targetId: sourceInfo.id,
            createdAt: now,
            createdBy: options?.author ? normalizeDashesAndMojibake(options.author) : undefined,
          });
        }

        targetMeta.updatedAt = now;
        targetMeta.revision = (targetMeta.revision || 1) + 1;
        writeSafeFile(targetMetaPath, JSON.stringify(targetMeta, null, 2) + '\n');
        this.invalidateTicketCache(targetInfo.ticketDir);
        updatedTarget = (await this.getTicket(targetInfo.key)) || undefined;
      } catch {}
    }

    const updatedSource = (await this.getTicket(sourceInfo.key))!;
    return { source: updatedSource, target: updatedTarget };
  }

  public async removeTicketLink(
    sourceId: number | string,
    targetId: number | string,
    options?: { relation?: TicketLinkRelation; project?: string }
  ): Promise<{ source: EsedreTicket; target?: EsedreTicket }> {
    const sourceInfo = this.resolveTicketIdentifier(sourceId, options?.project);
    if (!sourceInfo) {
      throw new Error(`Source ticket #${sourceId} could not be located.`);
    }

    const targetInfo = this.resolveTicketIdentifier(targetId, options?.project || sourceInfo.project);
    const targetKey = targetInfo ? targetInfo.key : String(targetId).trim();

    const now = new Date().toISOString();
    const sourceMetaPath = path.join(sourceInfo.ticketDir, 'meta.json');
    if (fs.existsSync(sourceMetaPath)) {
      try {
        const sourceMeta: TicketMeta = JSON.parse(fs.readFileSync(sourceMetaPath, 'utf-8'));
        if (Array.isArray(sourceMeta.links)) {
          const originalLen = sourceMeta.links.length;
          sourceMeta.links = sourceMeta.links.filter(
            (l) =>
              !(
                l.targetKey.toLowerCase() === targetKey.toLowerCase() &&
                (!options?.relation || l.relation === options.relation)
              )
          );
          if (sourceMeta.links.length !== originalLen) {
            sourceMeta.updatedAt = now;
            sourceMeta.revision = (sourceMeta.revision || 1) + 1;
            writeSafeFile(sourceMetaPath, JSON.stringify(sourceMeta, null, 2) + '\n');
            this.invalidateTicketCache(sourceInfo.ticketDir);
          }
        }
      } catch {}
    }

    let updatedTarget: EsedreTicket | undefined;
    if (targetInfo) {
      const targetMetaPath = path.join(targetInfo.ticketDir, 'meta.json');
      if (fs.existsSync(targetMetaPath)) {
        try {
          const targetMeta: TicketMeta = JSON.parse(fs.readFileSync(targetMetaPath, 'utf-8'));
          if (Array.isArray(targetMeta.links)) {
            const originalLen = targetMeta.links.length;
            targetMeta.links = targetMeta.links.filter(
              (l) =>
                !(
                  l.targetKey.toLowerCase() === sourceInfo.key.toLowerCase() &&
                  (!options?.relation || l.relation === INVERSE_RELATIONS[options.relation])
                )
            );
            if (targetMeta.links.length !== originalLen) {
              targetMeta.updatedAt = now;
              targetMeta.revision = (targetMeta.revision || 1) + 1;
              writeSafeFile(targetMetaPath, JSON.stringify(targetMeta, null, 2) + '\n');
              this.invalidateTicketCache(targetInfo.ticketDir);
              updatedTarget = (await this.getTicket(targetInfo.key)) || undefined;
            }
          }
        } catch {}
      }
    }

    const updatedSource = (await this.getTicket(sourceInfo.key))!;
    return { source: updatedSource, target: updatedTarget };
  }
}
