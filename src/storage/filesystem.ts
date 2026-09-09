function isProjectMatch(code: string, slug: string, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  const c = code.trim().toLowerCase();
  const s = slug.trim().toLowerCase();
  if (c === f || s === f) return true;
  if ((f === 'prof' || f === 'core' || f === 'pasrc') && (c === 'prof' || c === 'core')) return true;
  if ((f === 'esedre' || f === 'ese' || f === 'docs') && (c === 'esedre' || c === 'docs')) return true;
  if ((f === 'alce' || f === 'web') && (c === 'alce' || c === 'web')) return true;
  return false;
}

import fs from 'node:fs';
import path from 'node:path';
import { EsedreTicket, TicketMeta, ProjectDescriptor, TicketComment, TicketDetail, TicketType, TicketCategory, EsedreConflictError } from '../types.js';
import { StorageAdapter, CreateTicketInput, ListTicketsFilter, RegisterProjectInput } from './adapter.js';
import { EsedreConfig, findEsedreConfig } from '../config.js';
import { computeTicketHash, verifyTicketHash } from '../snapshot.js';

function writeSafeFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const normalized = content.replace(/\n/g, '\n');
  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.writeFileSync(tempPath, normalized, 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch {
    fs.writeFileSync(filePath, normalized, 'utf-8');
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

export class FilesystemStorageAdapter implements StorageAdapter {
  private workspaceRoot: string;
  private config: EsedreConfig;

  constructor(workspaceRoot?: string, config?: EsedreConfig) {
    this.workspaceRoot = workspaceRoot || this.resolveWorkspaceRoot();
    if (config) {
      this.config = config;
    } else {
      try {
        const discovered = findEsedreConfig(this.workspaceRoot);
        this.config = discovered.config || {};
      } catch {
        this.config = {};
      }
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
    const locations: ResolvedProjectLocation[] = [];
    const seenCodes = new Set<string>();

    // 1. Hub Directories from config.dataDir
    const rawDataDirs = Array.isArray(this.config.dataDir)
      ? this.config.dataDir
      : (this.config.dataDir ? [this.config.dataDir] : []);

    for (const dDir of rawDataDirs) {
      const resolvedHub = path.resolve(this.workspaceRoot, dDir);
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
                    (p) => p.code.toLowerCase() === ent.name.toLowerCase() || p.slug.toLowerCase() === ent.name.toLowerCase()
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
              slug: ent.name.toLowerCase(),
              name: ent.name,
              description: `${ent.name} project`,
            };
          }

          const codeKey = desc.code.toLowerCase();
          if (!seenCodes.has(codeKey)) {
            seenCodes.add(codeKey);
            locations.push({
              project: desc,
              ticketsDir: projectTicketsDir,
              sourceType: 'hub',
              hubDir: resolvedHub,
            });
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
            slug: pCode.toLowerCase(),
            name: pCode,
            description: `${pCode} project`,
          }];
        }

        const isShared = descs.length > 1;
        for (const desc of descs) {
          const codeKey = desc.code.toLowerCase();
          if (!seenCodes.has(codeKey)) {
            seenCodes.add(codeKey);
            locations.push({
              project: desc,
              ticketsDir: actualTicketsDir,
              sourceType: 'hub',
              hubDir: resolvedHub,
              isSharedDir: isShared,
            });
          }
        }
      }
    }

    // 2. Federated Projects from config.projects
    if (this.config.projects && typeof this.config.projects === 'object') {
      for (const [code, rawPath] of Object.entries(this.config.projects)) {
        const projectDir = path.resolve(this.workspaceRoot, rawPath);
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
            slug: code.toLowerCase(),
            name: code,
            description: `${code} project`,
          };
        }

        const codeKey = desc.code.toLowerCase();
        if (!seenCodes.has(codeKey)) {
          seenCodes.add(codeKey);
          locations.push({
            project: desc,
            ticketsDir: actualTicketsDir,
            sourceType: 'federated',
          });
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

      const foundTicketsDir = candidateDirs.find((d) => fs.existsSync(d)) || path.join(this.workspaceRoot, '.esedre', 'tickets');

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
            slug: this.config.projectCode.toLowerCase(),
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
    const cleanCode = rawCode.toUpperCase();
    const cleanName = input.name?.trim() || cleanCode;
    const cleanDesc = input.description?.trim() || `${cleanName} project`;
    const slug = cleanCode.toLowerCase();

    const colors = input.colors || {
      badge: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
      dot: 'bg-cyan-400',
      border: 'border-cyan-500/40',
    };

    // 1. Check if dataDir hub is configured
    const rawDataDirs = Array.isArray(this.config.dataDir)
      ? this.config.dataDir
      : (this.config.dataDir ? [this.config.dataDir] : []);

    let targetHub: string | null = null;
    for (const dDir of rawDataDirs) {
      const resolved = path.resolve(this.workspaceRoot, dDir);
      if (fs.existsSync(resolved)) {
        targetHub = resolved;
        break;
      }
    }

    if (targetHub) {
      const hubProjectsDir = path.join(targetHub, 'projects');
      const projectDir = path.join(hubProjectsDir, cleanCode);
      const ticketsDir = path.join(projectDir, 'tickets');
      if (!fs.existsSync(ticketsDir)) {
        fs.mkdirSync(ticketsDir, { recursive: true });
      }

      const pJsonPath = path.join(projectDir, 'project.json');
      let existingPJson: any = null;
      if (fs.existsSync(pJsonPath)) {
        try { existingPJson = JSON.parse(fs.readFileSync(pJsonPath, 'utf-8')); } catch {}
      }

      const id = existingPJson?.id || (await this.getProjects()).length + 1;
      const projectDesc: ProjectDescriptor = {
        id,
        code: cleanCode,
        slug,
        name: cleanName,
        description: cleanDesc,
        colors,
      };

      writeSafeFile(pJsonPath, JSON.stringify(projectDesc, null, 2) + '\n');

      const hubProjectsFile = path.join(targetHub, 'projects.json');
      if (fs.existsSync(hubProjectsFile)) {
        try {
          const arr: ProjectDescriptor[] = JSON.parse(fs.readFileSync(hubProjectsFile, 'utf-8'));
          const idx = arr.findIndex((p) => p.code.toLowerCase() === slug);
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

    const id = existingPJson?.id || 1;
    const projectDesc: ProjectDescriptor = {
      id,
      code: cleanCode,
      slug,
      name: cleanName,
      description: cleanDesc,
      colors,
    };

    writeSafeFile(pJsonPath, JSON.stringify(projectDesc, null, 2) + '\n');

    const projectsJsonPath = path.join(esedreDir, 'projects.json');
    if (fs.existsSync(projectsJsonPath)) {
      try {
        const arr: ProjectDescriptor[] = JSON.parse(fs.readFileSync(projectsJsonPath, 'utf-8'));
        const idx = arr.findIndex((p) => p.code.toLowerCase() === slug);
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

  private findTicketLocation(id: number | string): { loc: ResolvedProjectLocation; ticketDir: string; id: number } | null {
    const locations = this.resolveProjectLocations();
    if (locations.length === 0) return null;

    const strId = String(id).trim();

    // Check if prefixed with project code (e.g. "Prof-35", "Esedre-1", "Prof_35", "Prof:35")
    const prefixMatch = strId.match(/^([a-zA-Z0-9]{1,6})[-_:](\d+)$/i);
    if (prefixMatch) {
      const code = prefixMatch[1].toLowerCase();
      const num = parseInt(prefixMatch[2], 10);
      const loc = locations.find((l) => isProjectMatch(l.project.code, l.project.slug, code));
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
            if (mProj && mProj !== code && mProj !== loc.project.slug.toLowerCase()) {
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
                (meta.project && (l.project.code.toLowerCase() === meta.project.toLowerCase() || l.project.slug.toLowerCase() === meta.project.toLowerCase()))
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
        (m) => m.loc.project.code.toLowerCase() === prefLower || m.loc.project.slug.toLowerCase() === prefLower
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

  public async listTickets(filter?: ListTicketsFilter): Promise<EsedreTicket[]> {
    const locations = this.resolveProjectLocations();
    const tickets: EsedreTicket[] = [];
    const processedSharedTickets = new Set<string>();

    for (const loc of locations) {
      if (filter?.project && filter.project !== 'all') {
        const pLower = filter.project.toLowerCase();
        if (!isProjectMatch(loc.project.code, loc.project.slug, filter.project)) {
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

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const num = parseInt(entry.name, 10);
        if (isNaN(num)) continue;

        const ticketDir = path.join(loc.ticketsDir, entry.name);
        const metaPath = path.join(ticketDir, 'meta.json');
        if (!fs.existsSync(metaPath)) continue;

        if (loc.isSharedDir) {
          const key = `${loc.ticketsDir}:${entry.name}`;
          if (processedSharedTickets.has(key)) continue;
          processedSharedTickets.add(key);
        }

        try {
          const metaRaw = fs.readFileSync(metaPath, 'utf-8');
          const meta: TicketMeta = JSON.parse(metaRaw);
          meta.id = meta.id ?? num;
          meta.type = meta.type || meta.category || 'Feature';
          meta.category = meta.type;

          let effectiveLoc = loc;
          if (loc.isSharedDir) {
            const found = locations.find(
              (l) =>
                (meta.projectId !== undefined && l.project.id === meta.projectId) ||
                (meta.project && (l.project.code.toLowerCase() === meta.project.toLowerCase() || l.project.slug.toLowerCase() === meta.project.toLowerCase()))
            );
            if (found) effectiveLoc = found;
          }

          meta.project = effectiveLoc.project.code;
          meta.projectId = effectiveLoc.project.id;

          if (filter?.project && filter.project !== 'all') {
            const pLower = filter.project.toLowerCase();
            if (!isProjectMatch(meta.project, effectiveLoc.project.slug, filter.project)) {
              continue;
            }
          }

          if (filter?.status && meta.status !== filter.status) {
            continue;
          }
          if (filter?.category && meta.category !== filter.category) {
            continue;
          }
          if (filter?.search) {
            const term = filter.search.toLowerCase();
            const matchesTitle = meta.title.toLowerCase().includes(term);
            const matchesNum = String(meta.id).includes(term) || `${meta.project}-${meta.id}`.toLowerCase().includes(term);
            if (!matchesTitle && !matchesNum) {
              continue;
            }
          }

          let detail: TicketDetail | undefined;
          const detailPath = path.join(ticketDir, 'detail.md');
          if (fs.existsSync(detailPath)) {
            const raw = fs.readFileSync(detailPath, 'utf-8');
            detail = this.parseDetailMarkdown(raw);
          }

          let planMarkdown: string | undefined;
          const planPath = path.join(ticketDir, 'implementation_plan.md');
          if (fs.existsSync(planPath)) {
            planMarkdown = fs.readFileSync(planPath, 'utf-8');
          }

          let comments: TicketComment[] = [];
          const commentsPath = path.join(ticketDir, 'comments.json');
          if (fs.existsSync(commentsPath)) {
            try {
              comments = JSON.parse(fs.readFileSync(commentsPath, 'utf-8'));
            } catch {}
          }

          const ticketObj: EsedreTicket = {
            meta,
            detail,
            planMarkdown,
            comments,
            projectDescriptor: effectiveLoc.project,
          };
          ticketObj.sha1 = computeTicketHash(ticketObj);
          ticketObj.lastHash = ticketObj.sha1;
          tickets.push(ticketObj);
        } catch {}
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

    const metaPath = path.join(locInfo.ticketDir, 'meta.json');
    if (!fs.existsSync(metaPath)) return null;

    try {
      const metaRaw = fs.readFileSync(metaPath, 'utf-8');
      const meta: TicketMeta = JSON.parse(metaRaw);
      meta.id = meta.id ?? locInfo.id;
      meta.project = locInfo.loc.project.code;
      meta.projectId = locInfo.loc.project.id;

      let detail: TicketDetail | undefined;
      const detailPath = path.join(locInfo.ticketDir, 'detail.md');
      if (fs.existsSync(detailPath)) {
        const raw = fs.readFileSync(detailPath, 'utf-8');
        detail = this.parseDetailMarkdown(raw);
      }

      let planMarkdown: string | undefined;
      const planPath = path.join(locInfo.ticketDir, 'implementation_plan.md');
      if (fs.existsSync(planPath)) {
        planMarkdown = fs.readFileSync(planPath, 'utf-8');
      }

      let comments: TicketComment[] = [];
      const commentsPath = path.join(locInfo.ticketDir, 'comments.json');
      if (fs.existsSync(commentsPath)) {
        try {
          comments = JSON.parse(fs.readFileSync(commentsPath, 'utf-8'));
        } catch {}
      }

      const ticket: EsedreTicket = {
        meta,
        detail,
        planMarkdown,
        comments,
        projectDescriptor: locInfo.loc.project,
      };
      ticket.sha1 = computeTicketHash(ticket);
      ticket.lastHash = ticket.sha1;
      return ticket;
    } catch {
      return null;
    }
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

    return {
      title,
      type,
      category,
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
          l.project.code.toLowerCase() === lower ||
          l.project.slug.toLowerCase() === lower ||
          String(l.project.id) === lower ||
          l.project.name.toLowerCase() === lower
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
    const meta: TicketMeta = {
      id: nextId,
      title: input.title.slice(0, 48).trim(),
      type: effectiveType,
      category: effectiveType,
      complexity: input.complexity || 'Medium',
      estimatedEffort: input.estimatedEffort || input.effort || '2.0 - 4.0 hours',
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

    const detailMd = `# Ticket #${nextId}: ${meta.title}
**Category**: ${meta.category}  
**Complexity**: ${meta.complexity}  
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

    writeSafeFile(path.join(ticketDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
    writeSafeFile(path.join(ticketDir, 'detail.md'), detailMd);

    const created = await this.getTicket(`${targetLoc.project.code}-${nextId}`);
    return created!;
  }

  public async updateTicket(id: number | string, updates: Partial<TicketMeta>, lastHash?: string): Promise<EsedreTicket> {
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

    const updatedMeta: TicketMeta = {
      ...existing.meta,
      ...updates,
      id: locInfo.id,
      updatedAt: now,
      completedAt,
      revision,
    };

    writeSafeFile(metaPath, JSON.stringify(updatedMeta, null, 2) + '\n');

    const newType = updates.type || updates.category;
    if (newType) { updatedMeta.type = newType; updatedMeta.category = newType; }
    if (existing.detail && (updates.title || updates.type || updates.category || updates.complexity || updates.estimatedEffort)) {
      let content = existing.detail.raw;
      if (updates.title) {
        content = content.replace(/^#\s*(?:Ticket\s*#?\d+\s*:\s*|\d+\s*:\s*)?[^\n]+/im, `# Ticket #${locInfo.id}: ${updatedMeta.title}`);
      }
      if (updates.type || updates.category) {
        content = content.replace(/\*\*(?:Type|Category)\*\*:\s*[^\n]+/i, `**Type**: ${updatedMeta.type}`);
      }
      if (updates.complexity) {
        content = content.replace(/\*\*Complexity\*\*:\s*[^\n]+/i, `**Complexity**: ${updatedMeta.complexity}`);
      }
      if (updates.estimatedEffort) {
        content = content.replace(/\*\*Estimated Effort\*\*:\s*[^\n]+/i, `**Estimated Effort**: ${updatedMeta.estimatedEffort}`);
      }
      writeSafeFile(path.join(locInfo.ticketDir, 'detail.md'), content);
    }

    return (await this.getTicket(`${locInfo.loc.project.code}-${locInfo.id}`))!;
  }

  public async getPlan(id: number | string): Promise<string | null> {
    const locInfo = this.findTicketLocation(id);
    if (!locInfo) return null;

    const planPath = path.join(locInfo.ticketDir, 'implementation_plan.md');
    if (!fs.existsSync(planPath)) return null;
    return fs.readFileSync(planPath, 'utf-8');
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
    writeSafeFile(planPath, planMarkdown);

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
      author: comment.author || 'User',
      text: comment.text.trim(),
    };

    comments.push(newComment);
    writeSafeFile(commentsPath, JSON.stringify(comments, null, 2) + '\n');
    return newComment;
  }
}
