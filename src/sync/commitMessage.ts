import { SyncMutationEvent } from '../types.js';

export interface FormattedSyncCommit {
  subject: string;
  body?: string;
  message: string;
}

const CONVENTIONAL_PREFIX_RE =
  /^(?:feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(?:\([^)]*\))?!?:\s*/i;

export function sanitizeCommitText(input: string): string {
  return input
    .replace(/[\u2014\u2013]/g, '-')
    .replace(CONVENTIONAL_PREFIX_RE, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, Math.max(1, maxLen - 3)).trimEnd() + '...';
}

interface CoalescedEntry {
  anchor: string;
  summary: string;
}

function coalesceEventsForAnchor(anchor: string, events: SyncMutationEvent[]): string {
  const actions = new Set(events.map((e) => e.action));
  const latestWithTitle = [...events].reverse().find((e) => e.title && e.title.trim());
  const cleanTitle = latestWithTitle?.title ? sanitizeCommitText(latestWithTitle.title) : undefined;

  if (actions.has('create-ticket')) {
    if (actions.has('save-plan')) {
      return 'Create ticket and save implementation plan';
    }
    if (cleanTitle) {
      return `Create ticket: ${truncateText(cleanTitle, 44)}`;
    }
    return 'Create ticket';
  }

  if (actions.has('complete-ticket')) {
    if (actions.has('save-plan') || actions.has('add-comment')) {
      return 'Complete ticket and update verification records';
    }
    return 'Update ticket status to Completed';
  }

  if (actions.has('reject-ticket')) {
    return 'Update ticket status to Rejected';
  }

  if (actions.has('update-ticket') && actions.has('save-plan')) {
    return 'Update ticket specification and save implementation plan';
  }

  if (actions.size === 1) {
    if (actions.has('save-plan')) {
      return 'Save implementation plan';
    }
    if (actions.has('add-comment')) {
      return 'Add comment on ticket';
    }
    if (actions.has('link-ticket')) {
      const target = events.find((e) => e.targetKey)?.targetKey?.replace(/^#/, '');
      return target ? `Link ticket to #${ sanitizeCommitText(target) }` : 'Link ticket';
    }
    if (actions.has('unlink-ticket')) {
      const target = events.find((e) => e.targetKey)?.targetKey?.replace(/^#/, '');
      return target ? `Unlink ticket from #${ sanitizeCommitText(target) }` : 'Unlink ticket';
    }
    if (actions.has('create-milestone') || actions.has('update-milestone')) {
      return 'Update project milestones';
    }
    if (actions.has('upgrade-project') || actions.has('update-project')) {
      return 'Update project metadata';
    }
  }

  const changedFields = Array.from(
    new Set(
      events
        .flatMap((e) => e.changedFields || [])
        .map((f) => sanitizeCommitText(f))
        .filter(Boolean)
    )
  );
  if (changedFields.length > 0 && changedFields.length <= 3) {
    return `Update ticket (${changedFields.join(', ')})`;
  }

  return 'Update ticket specification and metadata';
}

function inferEntriesFromStagedFiles(stagedFiles: string[], existingAnchors: Set<string>): CoalescedEntry[] {
  const byTicket = new Map<string, Set<string>>();
  const milestoneProjects = new Set<string>();
  let touchedProjectManifest = false;

  for (const rawFile of stagedFiles) {
    const norm = rawFile.replace(/\\/g, '/').replace(/^\/+/, '');
    const ticketMatch = norm.match(/^projects\/([^/]+)\/tickets\/(\d+)\/(.+)$/);
    if (ticketMatch) {
      const [, proj, id, file] = ticketMatch;
      if (file.toLowerCase() === 'lease.json') continue;
      const anchor = `#${proj}-${id}`;
      if (existingAnchors.has(anchor.toLowerCase())) continue;
      if (!byTicket.has(anchor)) {
        byTicket.set(anchor, new Set());
      }
      byTicket.get(anchor)!.add(file.toLowerCase());
      continue;
    }

    const msMatch = norm.match(/^projects\/([^/]+)\/milestones\.json$/);
    if (msMatch) {
      const anchor = `#${msMatch[1]}`;
      if (!existingAnchors.has(anchor.toLowerCase())) {
        milestoneProjects.add(msMatch[1]);
      }
      continue;
    }

    if (norm === 'projects.json' || /^projects\/[^/]+\/project\.json$/.test(norm)) {
      touchedProjectManifest = true;
    }
  }

  const inferred: CoalescedEntry[] = [];
  for (const [anchor, files] of byTicket.entries()) {
    let summary = 'Sync ticket data';
    if (files.size === 1 && (files.has('implementation_plan.md') || files.has('plan.md'))) {
      summary = 'Save implementation plan';
    } else if (files.size === 1 && files.has('comments.json')) {
      summary = 'Add comment on ticket';
    } else if (files.has('detail.md') && (files.has('implementation_plan.md') || files.has('plan.md'))) {
      summary = 'Update ticket specification and save implementation plan';
    } else if (files.has('detail.md') || files.has('meta.json')) {
      summary = 'Update ticket specification and metadata';
    }
    inferred.push({ anchor, summary });
  }

  for (const proj of milestoneProjects) {
    inferred.push({ anchor: `#${proj}`, summary: 'Update project milestones' });
  }

  if (inferred.length === 0 && touchedProjectManifest && existingAnchors.size === 0) {
    inferred.push({ anchor: 'Data', summary: 'Update project manifest metadata' });
  }

  return inferred;
}

export function formatSyncCommitMessage(
  events: SyncMutationEvent[] = [],
  stagedFiles: string[] = []
): FormattedSyncCommit {
  const grouped = new Map<string, { anchor: string; events: SyncMutationEvent[] }>();

  for (const ev of events) {
    let anchor: string;
    if (ev.ticketKey) {
      anchor = `#${ev.ticketKey.replace(/^#/, '')}`;
    } else if (ev.ticketId !== undefined && ev.project) {
      anchor = `#${ev.project}-${ev.ticketId}`;
    } else if (ev.project) {
      anchor = `#${ev.project}`;
    } else {
      anchor = 'Data';
    }
    const lower = anchor.toLowerCase();
    if (!grouped.has(lower)) {
      grouped.set(lower, { anchor, events: [] });
    }
    grouped.get(lower)!.events.push(ev);
  }

  const entries: CoalescedEntry[] = [];
  const seenAnchors = new Set<string>();

  for (const [lower, group] of grouped.entries()) {
    seenAnchors.add(lower);
    entries.push({
      anchor: sanitizeCommitText(group.anchor),
      summary: sanitizeCommitText(coalesceEventsForAnchor(group.anchor, group.events)),
    });
  }

  if (stagedFiles.length > 0) {
    const inferred = inferEntriesFromStagedFiles(stagedFiles, seenAnchors);
    for (const item of inferred) {
      entries.push({
        anchor: sanitizeCommitText(item.anchor),
        summary: sanitizeCommitText(item.summary),
      });
    }
  }

  if (entries.length === 0) {
    const fallback = '[Data] Sync ticket repository changes';
    return { subject: fallback, message: fallback };
  }

  if (entries.length === 1) {
    const single = `[${entries[0].anchor}] ${entries[0].summary}`;
    return { subject: single, message: single };
  }

  const uniqueAnchors = Array.from(new Set(entries.map((e) => e.anchor)));
  const anchorHeader =
    uniqueAnchors.length <= 3
      ? uniqueAnchors.join(', ')
      : `${uniqueAnchors.slice(0, 3).join(', ')}, +${uniqueAnchors.length - 3}`;

  const subject = `[${anchorHeader}] Sync ${entries.length} ticket updates`;
  const body = entries.map((e) => `- [${e.anchor}] ${e.summary}`).join('\n');
  return {
    subject,
    body,
    message: `${subject}\n\n${body}`,
  };
}
