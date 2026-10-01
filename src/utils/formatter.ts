import { EsedreTicket, TicketPriority, Milestone } from '../types.js';

const isColorSupported = !process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR);

export const colors = {
  reset: isColorSupported ? '\x1b[0m' : '',
  bold: isColorSupported ? '\x1b[1m' : '',
  dim: isColorSupported ? '\x1b[2m' : '',
  cyan: isColorSupported ? '\x1b[36m' : '',
  green: isColorSupported ? '\x1b[32m' : '',
  yellow: isColorSupported ? '\x1b[33m' : '',
  magenta: isColorSupported ? '\x1b[35m' : '',
  red: isColorSupported ? '\x1b[31m' : '',
  blue: isColorSupported ? '\x1b[34m' : '',
};

/**
 * Normalizes priority casing to canonical 'Critical' | 'High' | 'Medium' | 'Low'.
 */
export function normalizePriority(val?: string | null): TicketPriority | undefined {
  if (!val) return undefined;
  const lower = String(val).trim().toLowerCase();
  if (lower === 'critical') return 'Critical';
  if (lower === 'high') return 'High';
  if (lower === 'medium') return 'Medium';
  if (lower === 'low') return 'Low';
  return undefined;
}

/**
 * Normalizes Unicode dashes, Windows-1252 / ISO-8859-1 mojibake sequences,
 * and double-encoded UTF-8 characters to clean ASCII hyphens and quotes.
 * Guarantees consistent terminal output without mojibake across all platforms.
 */
export function normalizeDashesAndMojibake(text: string): string;
export function normalizeDashesAndMojibake<T>(val: T): T;
export function normalizeDashesAndMojibake(val: any): any {
  if (typeof val !== 'string') return val;
  return val
    // Double-encoded UTF-8 mojibake for dashes
    .replace(/Ã¢â‚¬â€œ|Ã¢â‚¬â€”/g, '-')
    // Double-encoded UTF-8 mojibake for quotes
    .replace(/Ã¢â‚¬[Ëœâ„¢]/g, "'")
    .replace(/Ã¢â‚¬[Å“Â ]/g, '"')
    // Windows-1252 / ISO-8859-1 mojibake of UTF-8 en-dash (0xE2 0x80 0x93 -> â€“)
    .replace(/\u00e2\u20ac\u201c|\u00e2\u0080\u0093|â€“/g, '-')
    // Windows-1252 / ISO-8859-1 mojibake of UTF-8 em-dash (0xE2 0x80 0x94 -> â€”)
    .replace(/\u00e2\u20ac\u201d|\u00e2\u0080\u0094|â€”/g, '-')
    // Windows-1252 / ISO-8859-1 mojibake of UTF-8 quotes
    .replace(/\u00e2\u20ac\u02dc|\u00e2\u20ac\u2122|â€˜|â€™/g, "'")
    .replace(/\u00e2\u20ac\u0153|\u00e2\u20ac\u009d|\u00e2\u0080\u009d|â€œ|â€\u009d|â€ /g, '"')
    // Windows-1252 / ISO-8859-1 mojibake of UTF-8 ellipsis
    .replace(/\u00e2\u20ac\u00a6|â€¦/g, '...')
    // Unicode en-dash, em-dash, horizontal bar, figure dash, and minus sign
    .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, '-');
}

export function normalizeTicketFields(ticket: EsedreTicket): EsedreTicket {
  if (!ticket) return ticket;
  if (ticket.meta) {
    if (ticket.meta.title) ticket.meta.title = normalizeDashesAndMojibake(ticket.meta.title);
    if (ticket.meta.estimatedEffort) ticket.meta.estimatedEffort = normalizeDashesAndMojibake(ticket.meta.estimatedEffort);
    if (ticket.meta.complexity) ticket.meta.complexity = normalizeDashesAndMojibake(ticket.meta.complexity);
    if (ticket.meta.milestone) ticket.meta.milestone = normalizeDashesAndMojibake(ticket.meta.milestone);
    if (ticket.meta.featureFlag) ticket.meta.featureFlag = normalizeDashesAndMojibake(ticket.meta.featureFlag);
    if (ticket.meta.inheritedFeatureFlag) ticket.meta.inheritedFeatureFlag = normalizeDashesAndMojibake(ticket.meta.inheritedFeatureFlag);
    if (ticket.meta.priority) {
      const norm = normalizePriority(ticket.meta.priority);
      if (norm) {
        ticket.meta.priority = norm;
      } else {
        delete ticket.meta.priority;
      }
    }
  }
  if (ticket.detail) {
    if (ticket.detail.title) ticket.detail.title = normalizeDashesAndMojibake(ticket.detail.title);
    if (ticket.detail.estimatedEffort) ticket.detail.estimatedEffort = normalizeDashesAndMojibake(ticket.detail.estimatedEffort);
    if (ticket.detail.summary) ticket.detail.summary = normalizeDashesAndMojibake(ticket.detail.summary);
    if (ticket.detail.milestone) ticket.detail.milestone = normalizeDashesAndMojibake(ticket.detail.milestone);
    if (ticket.detail.priority) {
      const norm = normalizePriority(ticket.detail.priority);
      if (norm) {
        ticket.detail.priority = norm;
      } else {
        delete ticket.detail.priority;
      }
    }
    if (ticket.detail.breakdown) ticket.detail.breakdown = ticket.detail.breakdown.map((b) => normalizeDashesAndMojibake(b));
    if (ticket.detail.technicalDetails) ticket.detail.technicalDetails = ticket.detail.technicalDetails.map((t) => normalizeDashesAndMojibake(t));
    if (ticket.detail.openQuestions) ticket.detail.openQuestions = ticket.detail.openQuestions.map((q) => normalizeDashesAndMojibake(q));
    if (ticket.detail.raw) ticket.detail.raw = normalizeDashesAndMojibake(ticket.detail.raw);
  }
  if (ticket.planMarkdown) {
    ticket.planMarkdown = normalizeDashesAndMojibake(ticket.planMarkdown);
  }
  if (ticket.comments) {
    for (const c of ticket.comments) {
      if (c.text) c.text = normalizeDashesAndMojibake(c.text);
      if (c.author) c.author = normalizeDashesAndMojibake(c.author);
    }
  }
  if (ticket.answers) {
    for (const key of Object.keys(ticket.answers)) {
      ticket.answers[key] = normalizeDashesAndMojibake(ticket.answers[key]);
    }
  }
  if (ticket.inlineComments) {
    for (const ic of ticket.inlineComments) {
      if (ic.selectedText) ic.selectedText = normalizeDashesAndMojibake(ic.selectedText);
      if (ic.comment) ic.comment = normalizeDashesAndMojibake(ic.comment);
      if (ic.author) ic.author = normalizeDashesAndMojibake(ic.author);
    }
  }
  return ticket;
}

export function formatTicketListTable(tickets: EsedreTicket[]): string {
  if (tickets.length === 0) {
    return `${colors.dim}No tickets found matching criteria.${colors.reset}`;
  }

  const showPriority = tickets.some((t) => Boolean(t.meta.priority));

  const rows = tickets.map((t) => {
    const id = t.projectDescriptor?.code ? `${t.projectDescriptor.code}-${t.meta.id}` : `#${t.meta.id}`;
    const project = t.projectDescriptor?.code || 'CORE';
    const type = t.meta.type || t.meta.category || 'Feature';
    const priority = t.meta.priority || '-';
    const status = t.meta.status;
    const title = normalizeDashesAndMojibake(t.meta.title) + (t.isBlocked ? ` ${colors.red}[BLOCKED]${colors.reset}` : '');
    return { id, project, type, priority, status, title };
  });

  const idWidth = Math.max(4, ...rows.map((r) => r.id.length));
  const projWidth = Math.max(7, ...rows.map((r) => r.project.length));
  const typeWidth = Math.max(8, ...rows.map((r) => r.type.length));
  const prioWidth = showPriority ? Math.max(8, ...rows.map((r) => r.priority.length)) : 0;
  const statusWidth = Math.max(14, ...rows.map((r) => r.status.length));

  const headerParts = [
    pad('ID', idWidth),
    pad('Project', projWidth),
    pad('Type', typeWidth),
  ];
  if (showPriority) headerParts.push(pad('Priority', prioWidth));
  headerParts.push(pad('Status', statusWidth), 'Title');
  const header = `${colors.bold}${headerParts.join('  ')}${colors.reset}`;

  const dividerParts = [
    '-'.repeat(idWidth),
    '-'.repeat(projWidth),
    '-'.repeat(typeWidth),
  ];
  if (showPriority) dividerParts.push('-'.repeat(prioWidth));
  dividerParts.push('-'.repeat(statusWidth), '-'.repeat(40));
  const divider = `${colors.dim}${dividerParts.join('  ')}${colors.reset}`;

  const formattedRows = rows.map((r) => {
    const statusColored = colorStatus(r.status);
    const typeColored = colorType(r.type);
    const projColored = `${colors.magenta}${r.project}${colors.reset}`;
    const rowParts = [
      `${colors.bold}${pad(r.id, idWidth)}${colors.reset}`,
      pad(projColored, projWidth + (isColorSupported ? colors.magenta.length + colors.reset.length : 0)),
      pad(typeColored, typeWidth + (isColorSupported ? 9 : 0)),
    ];
    if (showPriority) {
      const prioColored = r.priority === '-' ? `${colors.dim}-${colors.reset}` : colorPriority(r.priority);
      rowParts.push(pad(prioColored, prioWidth + (isColorSupported && r.priority !== '-' ? 9 : (isColorSupported ? colors.dim.length + colors.reset.length : 0))));
    }
    rowParts.push(
      pad(statusColored, statusWidth + (isColorSupported ? 9 : 0)),
      r.title
    );
    return rowParts.join('  ');
  });

  return [header, divider, ...formattedRows].join('\n');
}

export function formatTicketDetail(ticket: EsedreTicket): string {
  const { meta, detail, comments, planMarkdown, projectDescriptor } = ticket;

  const lines: string[] = [];
  lines.push(`${colors.bold}${colors.cyan}Ticket #${meta.project ? `${meta.project}-${meta.id}` : meta.id}: ${normalizeDashesAndMojibake(meta.title)}${colors.reset}`);
  lines.push(`${colors.dim}${'='.repeat(60)}${colors.reset}`);

  lines.push(`${colors.bold}Project:${colors.reset}     ${projectDescriptor ? `${projectDescriptor.code} - ${projectDescriptor.name}` : 'Default'}`);
  lines.push(`${colors.bold}Type:${colors.reset}        ${colorType(meta.type || meta.category || 'Feature')}`);
  if (meta.priority) {
    lines.push(`${colors.bold}Priority:${colors.reset}    ${colorPriority(meta.priority)}`);
  }
  lines.push(`${colors.bold}Status:${colors.reset}      ${colorStatus(meta.status)}`);
  lines.push(`${colors.bold}Complexity:${colors.reset}  ${normalizeDashesAndMojibake(meta.complexity || 'Medium')}`);
  lines.push(`${colors.bold}Effort:${colors.reset}      ${normalizeDashesAndMojibake(meta.estimatedEffort || 'N/A')}`);
  lines.push(`${colors.bold}Submitted By:${colors.reset} ${meta.submittedBy || 'Unknown'}`);
  if (meta.milestone) {
    lines.push(`${colors.bold}Milestone:${colors.reset}   ${colors.magenta}${meta.milestone}${colors.reset}`);
  }
  if (meta.featureFlag) {
    const isInherited = meta.inheritedFeatureFlag && meta.inheritedFeatureFlag === meta.featureFlag;
    lines.push(`${colors.bold}Feature Flag:${colors.reset} ${colors.yellow}${meta.featureFlag}${colors.reset}${isInherited ? ` ${colors.dim}(inherited from Milestone)${colors.reset}` : ''}`);
  }
  if (ticket.isBlocked) {
    lines.push(`${colors.bold}Dependency:${colors.reset}   ${colors.red}${colors.bold}Blocked by uncompleted ticket${colors.reset}`);
  }

  if (detail?.summary) {
    lines.push('');
    lines.push(`${colors.bold}Summary:${colors.reset}`);
    lines.push(normalizeDashesAndMojibake(detail.summary));
  }

  if (detail?.breakdown && detail.breakdown.length > 0) {
    lines.push('');
    lines.push(`${colors.bold}Feature Breakdown:${colors.reset}`);
    for (const b of detail.breakdown) {
      lines.push(`  • ${normalizeDashesAndMojibake(b)}`);
    }
  }

  if (detail?.technicalDetails && detail.technicalDetails.length > 0) {
    lines.push('');
    lines.push(`${colors.bold}Technical Details:${colors.reset}`);
    for (const t of detail.technicalDetails) {
      lines.push(`  • ${normalizeDashesAndMojibake(t)}`);
    }
  }

  if (detail?.openQuestions && detail.openQuestions.length > 0) {
    lines.push('');
    lines.push(`${colors.bold}Open Decisions & Questions:${colors.reset}`);
    detail.openQuestions.forEach((q, idx) => {
      lines.push(`  • ${normalizeDashesAndMojibake(q)}`);
      if (ticket.answers && ticket.answers[String(idx)]) {
        lines.push(`    ${colors.green}> Answer:${colors.reset} ${normalizeDashesAndMojibake(ticket.answers[String(idx)])}`);
      }
    });
  }

  if (ticket.links && ticket.links.length > 0) {
    lines.push('');
    lines.push(`${colors.bold}Linked Tickets (${ticket.links.length}):${colors.reset}`);
    for (const l of ticket.links) {
      const relFormatted =
        l.relation === 'blocks'
          ? `${colors.red}Blocks${colors.reset}`
          : l.relation === 'blocked-by'
          ? `${colors.red}Blocked by${colors.reset}`
          : l.relation === 'parent-of'
          ? `${colors.magenta}Parent of${colors.reset}`
          : l.relation === 'child-of'
          ? `${colors.magenta}Child of${colors.reset}`
          : l.relation === 'duplicates'
          ? `${colors.yellow}Duplicates${colors.reset}`
          : l.relation === 'duplicated-by'
          ? `${colors.yellow}Duplicated by${colors.reset}`
          : `${colors.cyan}Relates to${colors.reset}`;

      const blockedTag = l.isBlockedByUncompleted ? ` ${colors.red}[BLOCKED]${colors.reset}` : '';
      const titleSnippet = l.targetTitle ? ` : ${normalizeDashesAndMojibake(l.targetTitle)}` : '';
      const statusSnippet = l.targetStatus ? ` [${l.targetStatus}]` : '';
      lines.push(`  • ${relFormatted} ${colors.bold}${l.targetKey}${colors.reset}${statusSnippet}${titleSnippet}${blockedTag}`);
    }
  }

  if (planMarkdown) {
    lines.push('');
    lines.push(`${colors.bold}Implementation Plan:${colors.reset}`);
    lines.push(normalizeDashesAndMojibake(planMarkdown.trim()));
  }

  if (comments && comments.length > 0) {
    lines.push('');
    lines.push(`${colors.bold}Comments (${comments.length}):${colors.reset}`);
    for (const c of comments) {
      lines.push(`  ${colors.dim}[${c.timestamp.slice(0, 10)}]${colors.reset} ${colors.bold}${normalizeDashesAndMojibake(c.author)}:${colors.reset} ${normalizeDashesAndMojibake(c.text)}`);
    }
  }

  return lines.join('\n');
}

function pad(str: string, width: number): string {
  return str.padEnd(width, ' ');
}

function colorStatus(status: string): string {
  switch (status) {
    case 'Completed': return `${colors.green}${status}${colors.reset}`;
    case 'In Development': return `${colors.green}${status}${colors.reset}`;
    case 'Rejected': return `${colors.red}${status}${colors.reset}`;
    default: return `${colors.cyan}${status}${colors.reset}`;
  }
}

function colorType(type: string): string {
  switch (type) {
    case 'Feature': return `${colors.blue}${type}${colors.reset}`;
    case 'Platform': return `${colors.magenta}${type}${colors.reset}`;
    case 'Tools': return `${colors.yellow}${type}${colors.reset}`;
    case 'Bug': return `${colors.red}${type}${colors.reset}`;
    case 'Idea': return `${colors.green}${type}${colors.reset}`;
    default: return type;
  }
}

export function colorPriority(priority?: string): string {
  if (!priority) return '';
  switch (priority.toLowerCase()) {
    case 'critical': return `${colors.red}${colors.bold}Critical${colors.reset}`;
    case 'high': return `${colors.yellow}${colors.bold}High${colors.reset}`;
    case 'medium': return `${colors.blue}Medium${colors.reset}`;
    case 'low': return `${colors.dim}Low${colors.reset}`;
    default: return priority;
  }
}

export function formatMilestoneListTable(milestones: Milestone[], tickets?: EsedreTicket[]): string {
  if (milestones.length === 0) {
    return `${colors.dim}No milestones found.${colors.reset}`;
  }

  const rows = milestones.map((m) => {
    const id = String(m.id);
    const project = m.project;
    const title = m.title;
    const status = m.status;
    const flag = m.featureFlag || '-';
    let progress = '-';
    if (tickets) {
      const mTickets = tickets.filter(
        (t) =>
          t.meta.milestone &&
          (t.meta.milestone.toLowerCase() === String(m.id).toLowerCase() ||
            t.meta.milestone.toLowerCase() === m.title.toLowerCase())
      );
      const completed = mTickets.filter((t) => t.meta.status === 'Completed').length;
      progress = `${completed}/${mTickets.length}`;
    }
    return { id, project, status, flag, progress, title };
  });

  const idWidth = Math.max(4, ...rows.map((r) => r.id.length));
  const projWidth = Math.max(7, ...rows.map((r) => r.project.length));
  const statusWidth = Math.max(10, ...rows.map((r) => r.status.length));
  const flagWidth = Math.max(14, ...rows.map((r) => r.flag.length));
  const progWidth = Math.max(8, ...rows.map((r) => r.progress.length));

  const header = `${colors.bold}${pad('ID', idWidth)}  ${pad('Project', projWidth)}  ${pad('Status', statusWidth)}  ${pad('Umbrella Flag', flagWidth)}  ${pad('Progress', progWidth)}  Title${colors.reset}`;
  const divider = `${colors.dim}${'-'.repeat(idWidth)}  ${'-'.repeat(projWidth)}  ${'-'.repeat(statusWidth)}  ${'-'.repeat(flagWidth)}  ${'-'.repeat(progWidth)}  ${'-'.repeat(30)}${colors.reset}`;

  const formattedRows = rows.map((r) => {
    return `${colors.bold}${pad(r.id, idWidth)}${colors.reset}  ${pad(r.project, projWidth)}  ${pad(r.status, statusWidth)}  ${pad(r.flag, flagWidth)}  ${pad(r.progress, progWidth)}  ${r.title}`;
  });

  return [header, divider, ...formattedRows].join('\n');
}

