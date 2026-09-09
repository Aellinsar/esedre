import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EsedreTicket, TicketType, TicketCategory, TicketStatus } from './types.js';
import { StorageAdapter } from './storage/adapter.js';

export interface TicketSnapshotEntry {
  id: number;
  ticketKey: string;
  title: string;
  type: TicketType;
  category: TicketCategory;
  status: TicketStatus;
  complexity?: string;
  estimatedEffort?: string;
  project: string;
  summary?: string;
  hasPlan: boolean;
  planMarkdown?: string;

  // Revision and temporal metadata for design staleness awareness
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  revision: number;
  daysSinceUpdate: number;

  sha1: string;
}

export interface ProjectSnapshot {
  version: string;
  projectCode: string;
  generatedAt: string;
  totalTickets: number;
  tickets: TicketSnapshotEntry[];
}

export function computeTicketHash(ticket: {
  meta: {
    id: number;
    title: string;
    category: string;
    status: string;
    complexity?: string;
    estimatedEffort?: string;
    project?: string;
    projectId?: number;
    revision?: number;
    completedAt?: string;
  };
  detail?: { raw?: string; summary?: string };
  planMarkdown?: string;
}): string {
  const hash = crypto.createHash('sha1');
  const payload = JSON.stringify({
    id: ticket.meta.id,
    title: (ticket.meta.title || '').trim(),
    category: ticket.meta.category,
    status: ticket.meta.status,
    complexity: ticket.meta.complexity || '',
    effort: ticket.meta.estimatedEffort || '',
    project: ticket.meta.project || '',
    revision: ticket.meta.revision || 1,
    completedAt: ticket.meta.completedAt || '',
    detailRaw: (ticket.detail?.raw || '').trim(),
    planMarkdown: (ticket.planMarkdown || '').trim(),
  });
  hash.update(payload, 'utf-8');
  return hash.digest('hex');
}

export function verifyTicketHash(currentHash: string, lastHash?: string): boolean {
  if (!lastHash) return true;
  const cleanLast = lastHash.trim().toLowerCase();
  const cleanCurrent = currentHash.trim().toLowerCase();
  if (cleanCurrent === cleanLast) return true;
  if (cleanLast.length >= 7 && cleanCurrent.startsWith(cleanLast)) return true;
  return false;
}

export async function generateProjectSnapshot(
  storage: StorageAdapter,
  projectCode: string,
  outputDir: string
): Promise<ProjectSnapshot> {
  const tickets = await storage.listTickets({ project: projectCode });
  const entries: TicketSnapshotEntry[] = [];
  const now = Date.now();

  for (const t of tickets) {
    const lookupKey = t.projectDescriptor?.code ? `${t.projectDescriptor.code}-${t.meta.id}` : t.meta.id;
    const fullTicket = await storage.getTicket(lookupKey);
    const plan = await storage.getPlan(lookupKey);
    const ticketObj: EsedreTicket = fullTicket || t;
    ticketObj.planMarkdown = plan || undefined;

    const pCode = ticketObj.projectDescriptor?.code || ticketObj.meta.project || projectCode;
    const ticketKey = `${pCode}-${ticketObj.meta.id}`;

    const createdAt = ticketObj.meta.createdAt || ticketObj.meta.timestamp;
    const updatedAt = ticketObj.meta.updatedAt || ticketObj.meta.timestamp || createdAt;
    const completedAt =
      ticketObj.meta.completedAt ||
      (ticketObj.meta.status === 'Completed' ? ticketObj.meta.timestamp : undefined);
    const revision = ticketObj.meta.revision || 1;

    let daysSinceUpdate = 0;
    if (updatedAt) {
      const updateTime = new Date(updatedAt).getTime();
      if (!isNaN(updateTime)) {
        daysSinceUpdate = Math.max(0, Math.floor((now - updateTime) / (1000 * 60 * 60 * 24)));
      }
    }

    const sha1 = computeTicketHash(ticketObj);
    entries.push({
      id: ticketObj.meta.id,
      ticketKey,
      title: ticketObj.meta.title,
      type: (ticketObj.meta.type || ticketObj.meta.category || 'Feature') as TicketType,
      category: (ticketObj.meta.type || ticketObj.meta.category || 'Feature') as TicketType,
      status: ticketObj.meta.status,
      complexity: ticketObj.meta.complexity,
      estimatedEffort: ticketObj.meta.estimatedEffort,
      project: pCode,
      summary: ticketObj.detail?.summary,
      hasPlan: Boolean(plan && plan.trim().length > 0),
      planMarkdown: plan && plan.trim().length > 0 ? plan : undefined,
      createdAt,
      updatedAt,
      completedAt,
      revision,
      daysSinceUpdate,
      sha1,
    });
  }

  const snapshot: ProjectSnapshot = {
    version: '0.1.0',
    projectCode,
    generatedAt: new Date().toISOString(),
    totalTickets: entries.length,
    tickets: entries,
  };

  const esedreDir = path.join(outputDir, '.esedre');
  if (!fs.existsSync(esedreDir)) {
    fs.mkdirSync(esedreDir, { recursive: true });
  }

  const snapshotPath = path.join(esedreDir, 'snapshot.json');
  const tempSnapshotPath = `${snapshotPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.writeFileSync(tempSnapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
    fs.renameSync(tempSnapshotPath, snapshotPath);
  } catch {
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
    if (fs.existsSync(tempSnapshotPath)) {
      try { fs.unlinkSync(tempSnapshotPath); } catch {}
    }
  }



  return snapshot;
}
