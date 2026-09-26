import { EsedreTicket } from '../types.js';

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
    .replace(/Ã¢â‚¬[Å“Â]/g, '"')
    // Windows-1252 / ISO-8859-1 mojibake of UTF-8 en-dash (0xE2 0x80 0x93 -> â€“)
    .replace(/\u00e2\u20ac\u201c|\u00e2\u0080\u0093|â€“/g, '-')
    // Windows-1252 / ISO-8859-1 mojibake of UTF-8 em-dash (0xE2 0x80 0x94 -> â€”)
    .replace(/\u00e2\u20ac\u201d|\u00e2\u0080\u0094|â€”/g, '-')
    // Windows-1252 / ISO-8859-1 mojibake of UTF-8 quotes
    .replace(/\u00e2\u20ac\u02dc|\u00e2\u20ac\u2122|â€˜|â€™/g, "'")
    .replace(/\u00e2\u20ac\u0153|\u00e2\u0080\u009d|â€œ|â€/g, '"')
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
  }
  if (ticket.detail) {
    if (ticket.detail.title) ticket.detail.title = normalizeDashesAndMojibake(ticket.detail.title);
    if (ticket.detail.estimatedEffort) ticket.detail.estimatedEffort = normalizeDashesAndMojibake(ticket.detail.estimatedEffort);
    if (ticket.detail.summary) ticket.detail.summary = normalizeDashesAndMojibake(ticket.detail.summary);
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
  return ticket;
}

export function formatTicketListTable(tickets: EsedreTicket[]): string {
  if (tickets.length === 0) {
    return `${colors.dim}No tickets found matching criteria.${colors.reset}`;
  }

  const rows = tickets.map((t) => {
    const id = t.projectDescriptor?.code ? `${t.projectDescriptor.code}-${t.meta.id}` : `#${t.meta.id}`;
    const project = t.projectDescriptor?.code || 'CORE';
    const type = t.meta.type || t.meta.category || 'Feature';
    const status = t.meta.status;
    const title = normalizeDashesAndMojibake(t.meta.title);
    return { id, project, type, status, title };
  });

  const idWidth = Math.max(4, ...rows.map((r) => r.id.length));
  const projWidth = Math.max(7, ...rows.map((r) => r.project.length));
  const typeWidth = Math.max(8, ...rows.map((r) => r.type.length));
  const statusWidth = Math.max(14, ...rows.map((r) => r.status.length));

  const header = `${colors.bold}${pad('ID', idWidth)}  ${pad('Project', projWidth)}  ${pad('Type', typeWidth)}  ${pad('Status', statusWidth)}  Title${colors.reset}`;
  const divider = `${colors.dim}${'-'.repeat(idWidth)}  ${'-'.repeat(projWidth)}  ${'-'.repeat(typeWidth)}  ${'-'.repeat(statusWidth)}  ${'-'.repeat(40)}${colors.reset}`;

  const formattedRows = rows.map((r) => {
    const statusColored = colorStatus(r.status);
    const typeColored = colorType(r.type);
    const projColored = `${colors.magenta}${r.project}${colors.reset}`;
    return `${colors.bold}${pad(r.id, idWidth)}${colors.reset}  ${pad(projColored, projWidth + (isColorSupported ? colors.magenta.length + colors.reset.length : 0))}  ${pad(typeColored, typeWidth + (isColorSupported ? 9 : 0))}  ${pad(statusColored, statusWidth + (isColorSupported ? 9 : 0))}  ${r.title}`;
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
  lines.push(`${colors.bold}Status:${colors.reset}      ${colorStatus(meta.status)}`);
  lines.push(`${colors.bold}Complexity:${colors.reset}  ${normalizeDashesAndMojibake(meta.complexity || 'Medium')}`);
  lines.push(`${colors.bold}Effort:${colors.reset}      ${normalizeDashesAndMojibake(meta.estimatedEffort || 'N/A')}`);
  lines.push(`${colors.bold}Submitted By:${colors.reset} ${meta.submittedBy || 'Unknown'}`);
  if (meta.featureFlag) {
    lines.push(`${colors.bold}Feature Flag:${colors.reset} ${colors.yellow}${meta.featureFlag}${colors.reset}`);
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
    for (const q of detail.openQuestions) {
      lines.push(`  • ${normalizeDashesAndMojibake(q)}`);
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
