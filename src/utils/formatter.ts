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

export function formatTicketListTable(tickets: EsedreTicket[]): string {
  if (tickets.length === 0) {
    return `${colors.dim}No tickets found matching criteria.${colors.reset}`;
  }

  const rows = tickets.map((t) => {
    const id = t.projectDescriptor?.code ? `${t.projectDescriptor.code}-${t.meta.id}` : `#${t.meta.id}`;
    const project = t.projectDescriptor?.code || 'CORE';
    const type = t.meta.type || t.meta.category || 'Feature';
    const status = t.meta.status;
    const title = t.meta.title;
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
  lines.push(`${colors.bold}${colors.cyan}Ticket #${meta.project ? `${meta.project}-${meta.id}` : meta.id}: ${meta.title}${colors.reset}`);
  lines.push(`${colors.dim}${'='.repeat(60)}${colors.reset}`);

  lines.push(`${colors.bold}Project:${colors.reset}     ${projectDescriptor ? `${projectDescriptor.code} - ${projectDescriptor.name}` : 'Default'}`);
  lines.push(`${colors.bold}Type:${colors.reset}        ${colorType(meta.type || meta.category || 'Feature')}`);
  lines.push(`${colors.bold}Status:${colors.reset}      ${colorStatus(meta.status)}`);
  lines.push(`${colors.bold}Complexity:${colors.reset}  ${meta.complexity || 'Medium'}`);
  lines.push(`${colors.bold}Effort:${colors.reset}      ${meta.estimatedEffort || 'N/A'}`);
  lines.push(`${colors.bold}Submitted By:${colors.reset} ${meta.submittedBy || 'Unknown'}`);
  if (meta.featureFlag) {
    lines.push(`${colors.bold}Feature Flag:${colors.reset} ${colors.yellow}${meta.featureFlag}${colors.reset}`);
  }

  if (detail?.summary) {
    lines.push('');
    lines.push(`${colors.bold}Summary:${colors.reset}`);
    lines.push(detail.summary);
  }

  if (detail?.breakdown && detail.breakdown.length > 0) {
    lines.push('');
    lines.push(`${colors.bold}Feature Breakdown:${colors.reset}`);
    for (const b of detail.breakdown) {
      lines.push(`  • ${b}`);
    }
  }

  if (detail?.technicalDetails && detail.technicalDetails.length > 0) {
    lines.push('');
    lines.push(`${colors.bold}Technical Details:${colors.reset}`);
    for (const t of detail.technicalDetails) {
      lines.push(`  • ${t}`);
    }
  }

  if (detail?.openQuestions && detail.openQuestions.length > 0) {
    lines.push('');
    lines.push(`${colors.bold}Open Decisions & Questions:${colors.reset}`);
    for (const q of detail.openQuestions) {
      lines.push(`  • ${q}`);
    }
  }

  if (planMarkdown) {
    lines.push('');
    lines.push(`${colors.bold}Implementation Plan:${colors.reset}`);
    lines.push(planMarkdown.trim());
  }

  if (comments && comments.length > 0) {
    lines.push('');
    lines.push(`${colors.bold}Comments (${comments.length}):${colors.reset}`);
    for (const c of comments) {
      lines.push(`  ${colors.dim}[${c.timestamp.slice(0, 10)}]${colors.reset} ${colors.bold}${c.author}:${colors.reset} ${c.text}`);
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
