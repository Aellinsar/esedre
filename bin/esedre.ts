#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { StorageAdapter } from '../src/storage/adapter.js';
import { SecurityFilter } from '../src/securityFilter.js';
import { formatTicketListTable, formatTicketDetail, formatMilestoneListTable, colors, normalizeDashesAndMojibake, normalizePriority } from '../src/utils/formatter.js';
import { EsedreMcpServer } from '../src/mcp/server.js';
import { TicketType, TicketCategory, TicketStatus, TicketPriority, Milestone, MilestoneStatus, ProjectDescriptor, EsedreConflictError, TicketLinkRelation } from '../src/types.js';
import {
  findEsedreConfig,
  EsedreAuthorizationError,
  validateProjectCode,
  validateProjectName,
  getGlobalConfigPath,
  readGlobalConfig,
  writeGlobalConfig,
  addLocationToGlobalConfig,
  removeLocationFromGlobalConfig,
  setGlobalConfigKey,
  getGlobalConfigKey,
  resolvePorts,
  expandHome,
  writeGlobalVersion,
  DEFAULT_ESEDRE_PORT,
  MAX_PROJECT_CODE_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
} from '../src/config.js';
import { detectProjectManifest } from '../src/utils/manifestDetector.js';
import { generateProjectSnapshot } from '../src/snapshot.js';
import {
  configureWorkspace,
  initWorkspace,
  initHub,
  CURRENT_ESEDRE_VERSION,
  findViteConfig,
  findOutdatedWrappers,
  upgradeAllWorkspaces,
} from '../src/upgrade.js';
import { startGatewayCluster } from '../src/server/gateway.js';
import { startDaemon, stopDaemon, getDaemonStatus, printDaemonLogs } from '../src/server/daemon.js';

function printHelp(config?: any): void {
  const port = config?.port || DEFAULT_ESEDRE_PORT;
  const projectCode = config?.projectCode;
  const webUrl = `http://localhost:${port}/app${projectCode ? '?project=' + encodeURIComponent(projectCode) : '?project=all'}`;

  console.log(`
${colors.bold}${colors.cyan}Esedre CLI (/eh-seh-dreh/)${colors.reset}: Developer Roadmap & LLM Coding Partner Coordination Engine

${colors.bold}WEB UI:${colors.reset}
  Interactive Planner: ${colors.cyan}${webUrl}${colors.reset}

${colors.bold}USAGE:${colors.reset}
  .esedre/esedre <command> [options]
  .esedre/ese <command> [options]
  esedre <command> [options]
  ese <command> [options]

${colors.bold}ROADMAP COMMANDS (Pair Programming & LLM Agents):${colors.reset}
  ${colors.bold}list${colors.reset}        [-p|--project <code|all>] [-s|--status <status>] [-t|--type <type>] [-q|--search <q>] [--json]
               List roadmap tickets with optional filters (defaults to active project).
               • Status values: 'Planned', 'In Development', 'Completed', 'Rejected'
               • Type values:   'Feature', 'Platform', 'Tools', 'Idea', 'Bug'

  ${colors.bold}get${colors.reset}         <id> [--json]
               Inspect full ticket specification, feature breakdown, and comments.

  ${colors.bold}plan${colors.reset}        <id> [--file <path> | --set "<markdown>"] [--last-hash <sha1>] [--json]
               View or update implementation plan with optimistic concurrency control.

  ${colors.bold}create${colors.reset}      --title "..." [-p|--project <code>] [-t|--type <type>] [-P|--priority <prio>] [--complexity <c>] [--effort "<e>"] [--summary "<s>"] [--detail "<md>"] [--file <path>] [--json]
               Mint a new roadmap ticket with sequential numeric ID.

  ${colors.bold}update${colors.reset}      <id> [-s|--status <status>] [-t|--type <type>] [-P|--priority <prio>] [--title "..."] [--complexity <c>] [--effort "<e>"] [--detail "<md>"] [--file <path>] [--in-dev] [--flag <name>] [--last-hash <sha1>] [--force] [--json]
               Mutate ticket status, type, priority, title, complexity, effort, active state, or feature flag with OCC protection.

  ${colors.bold}comment${colors.reset}     <id> ["<text>"] [--text "..."] [--author "..."] [--json]
               Append a research finding, test verification, or note to ticket history.

  ${colors.bold}link${colors.reset}        <sourceId> <relation> <targetId> [--author "..."] [--json]
               Establish a bi-directional link between two tickets (within or across projects).
               • Relations: 'relates-to', 'blocks', 'blocked-by', 'parent-of', 'child-of', 'duplicates', 'duplicated-by'

  ${colors.bold}unlink${colors.reset}      <sourceId> <targetId> [--json]
               Remove a link between two tickets and its reciprocal link.

  ${colors.bold}snapshot, refresh${colors.reset} [--project <code>] [--json]
               Generate lean read-only projection snapshot (.esedre/snapshot.json) for zero-latency agent context.

  ${colors.bold}milestone${colors.reset}   [list | get <id> | create | update <id> | delete <id>] [options] [--json]
               Manage project milestones with optional umbrella feature flags.
               • list:   ese milestone list [-p <project>]
               • get:    ese milestone get <id> [-p <project>]
               • create: ese milestone create --title "..." [-p <project>] [--flag <name>] [--status <status>] [--target-date <date>] [--desc "..."]
               • update: ese milestone update <id> [--title "..."] [--flag <name>] [--status <status>] [--target-date <date>] [--desc "..."]
               • delete: ese milestone delete <id> [-p <project>]

${colors.bold}SERVICE DAEMON COMMANDS:${colors.reset}
  ${colors.bold}start${colors.reset}       [--port <n>] [--foreground | -f] [--quiet] [--json]
               Start the Esedre background server and web UI daemon (default port ${DEFAULT_ESEDRE_PORT}).
               Use --foreground (-f) to run directly in terminal foreground (blocks terminal, Ctrl+C to stop).

  ${colors.bold}stop${colors.reset}        [--port <n>] [--quiet] [--json]
               Stop the running Esedre background server daemon.

  ${colors.bold}status${colors.reset}      [--port <n>] [--json]
               Check health, uptime, and diagnostics of the running Esedre server.

  ${colors.bold}logs${colors.reset}        [--port <n>] [--lines <n>]
               Tail recent logs from the Esedre background server.

  ${colors.bold}mcp${colors.reset}         Start the Model Context Protocol (MCP) JSON-RPC 2.0 stdio server for autonomous LLM coding agents.

${colors.bold}DEVELOPER ADMINISTRATION (Human Setup & Configuration):${colors.reset}
  ${colors.bold}init${colors.reset}        [<path>] [--project <code>] [-n|--name <name>] [--hub <name|path>] [--allow <c1,c2>] [--port <n>] [-y|--yes] [--json]
               Bring a project repository online (.esedre footprint, wrappers, snapshot), bootstrap a data hub (--hub), or register a project directly into an Esedre ticket data hub (--project <code>).
               • In-repo workspace: ese init (creates .esedre/esedre.json in current directory)
               • Data hub project:  ese init --project <code> --name "<name>" (creates project in configured dataDir hub)

  ${colors.bold}configure${colors.reset}   [add <path> | remove <code|path> | set <key> <val> | get <key>] [--json]
               Inspect or mutate central Esedre configuration (~/.esedre/config.json).
               • add <path>       Link an external project repository (federated projects map) or register a data hub (dataDir)
               • remove <target>  Unlink a project or data hub
               • set <key> <val>  Update a central configuration setting

  ${colors.bold}upgrade${colors.reset}     [<path>] [--all|-a] [--force|-f] [--json]
               Upgrade workspace configuration schema, wrappers, and agent skills. Refreshes snapshot.
               Pass --all (-a) to upgrade all registered projects in central ~/.esedre/config.json.
               Pass --force to overwrite customized skills with the latest official template.

  ${colors.bold}projects${colors.reset}    [--json]
               List registered workspace projects, project codes (e.g. 'CORE', 'WEB', 'DOCS'), and descriptions.

  ${colors.bold}project${colors.reset}     [set <code> [-n|--name <name>] [-d|--desc <text>] | rename <old> <new>] [--json]
               Inspect, update metadata, or rename workspace projects.

  ${colors.bold}rename-project${colors.reset} <oldCode> <newCode> [-n|--name <name>] [--json]
               Safely rename a project code on disk, updating hub folders, manifests, ticket references, and workspace configs.

${colors.bold}OPTIONS:${colors.reset}
  -a, --all            Apply operation across all registered projects in central configuration.
  -p, --project <code> Project code (e.g. CORE, ALCE, DOCS).
  -n, --name <name>    Project display name (e.g. "Alce Web Reader").
  -t, --type <type>    Ticket type ('Feature', 'Platform', 'Tools', 'Idea', 'Bug').
  -P, --priority <prio> Ticket priority ('Critical', 'High', 'Medium', 'Low', 'none').
  -m, --milestone <name|id> Ticket milestone association.
  -s, --status <stat>  Ticket status ('Planned', 'In Development', 'Completed', 'Rejected').
  -q, --search <query> Case-insensitive substring search query.
  -r, --relation <rel> Link relation type ('relates-to', 'blocks', 'blocked-by', etc.).
  --to <targetId>      Target ticket ID for link/unlink commands.
  --blocked            Filter tickets that are blocked by uncompleted tickets.
  --linked-to <key>    Filter tickets that are linked to a specific ticket.
  --detail "<md>"      Specification markdown for ticket detail during create or update.
  --file <path>        Path to markdown file for detail (create, update) or implementation plan (plan).
  --json              Output raw machine-readable JSON (strongly recommended for autonomous LLM coding agents).
  --last-hash <hash>  Optimistic concurrency control: last known sha1 hash of the ticket from 'get'.
  --force             Bypass optimistic concurrency last-hash conflict checks on writes.
  -v, --version       Show the current version number.
  -h, --help          Show this help reference.

${colors.bold}TYPICAL AGENT WORKFLOW:${colors.reset}
  1. Inspect active tickets:  ese list --status "In Development" --json
  2. Inspect ticket spec:     ese get 96 --json
  3. Update plan markdown:    ese plan 96 --file plan.md --last-hash <sha1>
  4. Complete ticket:         ese update 96 --status "Completed" --last-hash <sha1>
  5. Add verification note:   ese comment 96 --text "Verified tests pass." --author "Agent"
  * Tip: Read .esedre/snapshot.json directly for zero-latency roadmap context without subprocess execution.
`);
}

function parseArgs(rawArgs: string[]): { command: string; positionals: string[]; flags: Record<string, string | boolean> } {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let command = '';

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rawArgs[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      if (key === 'h') {
        flags['help'] = true;
      } else if (key === 'y') {
        flags['yes'] = true;
      } else if (key === 't' || key === 'p' || key === 's' || key === 'q' || key === 'n' || key === 'P' || key === 'm' || key === 'r') {
        const next = rawArgs[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      } else {
        flags[key] = true;
      }
    } else {
      if (!command) {
        command = arg;
      } else {
        positionals.push(arg);
      }
    }
  }

  // Map canonical shorthand flags to their long-form equivalents
  if (flags['t'] && !flags['type']) flags['type'] = flags['t'];
  if (flags['p'] && !flags['project']) flags['project'] = flags['p'];
  if (flags['P'] && !flags['priority']) flags['priority'] = flags['P'];
  if (flags['m'] && !flags['milestone']) flags['milestone'] = flags['m'];
  if (flags['n'] && !flags['name']) flags['name'] = flags['n'];
  if (flags['s'] && !flags['status']) flags['status'] = flags['s'];
  if (flags['q'] && !flags['search']) flags['search'] = flags['q'];
  if (flags['r'] && !flags['relation']) flags['relation'] = flags['r'];
  if (flags['f'] && !flags['foreground']) flags['foreground'] = flags['f'];
  if (flags['a'] && !flags['all']) flags['all'] = flags['a'];

  return { command, positionals, flags };
}

function printDuplicateProjectWarnings(storage: StorageAdapter, isJson: boolean): void {
  if (isJson) return;
  const warnings = storage.getDuplicateProjectWarnings ? storage.getDuplicateProjectWarnings() : [];
  for (const warn of warnings) {
    console.error(
      `${colors.yellow}⚠️  Warning: Duplicate project code '${warn.code}' detected across multiple data hubs (${path.basename(warn.firstHub)} and ${path.basename(warn.duplicateHub)}). Duplicate project codes across hubs are not supported; only '${path.basename(warn.firstHub)}' is active.${colors.reset}`
    );
  }
}

async function main(): Promise<void> {
  // Ensure UTF-8 output encoding for standard streams
  if (process.stdout && typeof (process.stdout as any).setDefaultEncoding === 'function') {
    try { (process.stdout as any).setDefaultEncoding('utf-8'); } catch {}
  }
  if (process.stderr && typeof (process.stderr as any).setDefaultEncoding === 'function') {
    try { (process.stderr as any).setDefaultEncoding('utf-8'); } catch {}
  }

  const rawArgs = process.argv.slice(2);
  const { command, positionals, flags } = parseArgs(rawArgs);

  try {
    writeGlobalVersion();
  } catch {}

  const discovered = findEsedreConfig(process.cwd(), { fallbackToGlobal: true });

  const isJson = Boolean(flags['json']);

  if (flags['version'] || flags['v'] || command === 'version') {
    if (isJson) {
      console.log(JSON.stringify({ version: CURRENT_ESEDRE_VERSION }));
    } else {
      console.log(`esedre v${CURRENT_ESEDRE_VERSION}`);
    }
    return;
  }

  if (!command || flags['help'] || flags['h']) {
    printHelp(discovered.config);
    return;
  }

  // SecurityFilter wraps raw FilesystemStorageAdapter
  const rawStorage = new FilesystemStorageAdapter(discovered.workspaceRoot, discovered.config);
  const storage = new SecurityFilter(rawStorage, discovered.config);

  try {
    switch (command) {
      case 'init': {
        const rawTarget = positionals[0];
        const targetDir = rawTarget ? path.resolve(rawTarget) : discovered.workspaceRoot;
        const rawHubFlag = flags['hub'];
        const hubArg = typeof rawHubFlag === 'string' ? rawHubFlag : undefined;
        const isHubRequested = Boolean(rawHubFlag);

        if (isHubRequested && !flags['project'] && !flags['p']) {
          const hubRes = initHub(targetDir);
          try {
            addLocationToGlobalConfig(targetDir);
          } catch {}

          if (isJson) {
            console.log(JSON.stringify(hubRes, null, 2));
          } else {
            console.log(`${colors.bold}${colors.green}✔ Initialized Esedre ticket data hub!${colors.reset}`);
            console.log(`  • Location:      ${hubRes.hubDir}`);
            console.log(`  • Projects file: ${hubRes.projectsJsonCreated ? 'Created projects.json' : 'Existing projects.json'}`);
            console.log(`  • Projects dir:  ${hubRes.projectsDirCreated ? 'Created projects/ directory' : 'Existing projects/ directory'}`);
            console.log(`  • Global Config: Registered as dataDir in ~/.esedre/config.json`);
            console.log(`\n${colors.bold}Next Steps:${colors.reset}`);
            console.log(`  1. Link project repositories to this hub using:`);
            console.log(`     ${colors.cyan}ese configure add <projectPath>${colors.reset}`);
            console.log(`  2. Start the Esedre background server:`);
            console.log(`     ${colors.cyan}ese start${colors.reset}`);
          }
          return;
        }

        let projectCode = (flags['project'] as string) || (flags['p'] as string) || discovered.config?.projectCode;
        let projectName = (flags['name'] as string) || (flags['n'] as string) || discovered.config?.projectName;
        const allowArg = flags['allow'] as string;
        const port = flags['port'] ? parseInt(String(flags['port']), 10) : undefined;
        const setupMcp = flags['no-mcp'] ? false : true;
        const isYes = Boolean(flags['yes'] || flags['y']);

        const detected = detectProjectManifest(targetDir);
        const candidateCode = detected.candidateCode;
        const candidateName = detected.candidateName;

        if (!isJson && detected.manifestFile && !projectCode) {
          console.log(`${colors.dim}  • Detected ${detected.manifestType} project (${detected.manifestFile}): ${candidateName}${colors.reset}`);
        }

        if (isYes) {
          if (!projectCode) projectCode = candidateCode;
          if (!projectName) projectName = candidateName || projectCode;
        } else if (process.stdin.isTTY && (!projectCode || !projectName) && !isJson) {
          const readline = await import('node:readline/promises');
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          try {
            if (!projectCode) {
              const promptMsg = candidateCode
                ? `${colors.cyan}?${colors.reset} Project code (1-${MAX_PROJECT_CODE_LENGTH} alphanumeric characters) [${candidateCode}]: `
                : `${colors.cyan}?${colors.reset} Project code (1-${MAX_PROJECT_CODE_LENGTH} alphanumeric characters, e.g. ALCE, DOCS): `;
              const codeAnswer = await rl.question(promptMsg);
              projectCode = codeAnswer.trim() || candidateCode;
            }
            if (!projectName && projectCode) {
              const defaultDisplayName = candidateName || `${projectCode} App`;
              const nameAnswer = await rl.question(
                `${colors.cyan}?${colors.reset} Project display name [${defaultDisplayName}]: `
              );
              projectName = nameAnswer.trim() || defaultDisplayName;
            }
          } finally {
            rl.close();
          }
        }

        if (!projectCode) {
          console.error(`${colors.red}Error: Project code is required (--project <code>, -p <code>, or in esedre.json).${colors.reset}`);
          process.exit(1);
        }

        const codeVal = validateProjectCode(projectCode);
        if (!codeVal.valid) {
          console.error(`${colors.red}Error: ${codeVal.error}${colors.reset}`);
          process.exit(1);
        }

        if (!projectName) {
          projectName = projectCode;
        }

        const nameVal = validateProjectName(projectName);
        if (!nameVal.valid) {
          console.error(`${colors.red}Error: ${nameVal.error}${colors.reset}`);
          process.exit(1);
        }

        // Detect workspaceless project registration into a data hub
        const isTargetHub =
          fs.existsSync(path.join(targetDir, 'projects.json')) ||
          (fs.existsSync(path.join(targetDir, 'projects')) && !fs.existsSync(path.join(targetDir, '.esedre', 'esedre.json')));
        const isWorkspaceless =
          isHubRequested ||
          isTargetHub ||
          (Boolean(discovered.config?.projectCode) && !rawTarget && discovered.config?.projectCode?.toLowerCase() !== projectCode.toLowerCase());

        let projectNewlyRegistered = false;
        let registeredProj: ProjectDescriptor;
        try {
          const existingProjects = await storage.getProjects();
          const existing = existingProjects.find(
            (p) => p.code.toLowerCase() === projectCode!.toLowerCase()
          );
          if (!existing) {
            registeredProj = await rawStorage.registerProject({
              code: projectCode!,
              name: projectName,
              hub: hubArg,
            });
            projectNewlyRegistered = true;
          } else {
            registeredProj = existing;
            if (flags['name'] || flags['n']) {
              registeredProj = await rawStorage.registerProject({
                code: projectCode!,
                name: projectName,
                hub: hubArg,
              });
            }
          }
        } catch (err: any) {
          console.error(`${colors.red}Error: ${err.message}${colors.reset}`);
          process.exit(1);
        }

        if (isWorkspaceless) {
          if (isJson) {
            console.log(JSON.stringify({
              project: registeredProj,
              projectNewlyRegistered,
              registeredInHub: true,
              commands: {
                create: `ese create --title "..." --project ${registeredProj.code}`,
                list: `ese list --project ${registeredProj.code}`,
              },
            }, null, 2));
          } else {
            if (projectNewlyRegistered) {
              console.log(`${colors.bold}${colors.green}✔ Registered project '${registeredProj.code}' (${registeredProj.name}) in Esedre data hub!${colors.reset}`);
            } else {
              console.log(`${colors.bold}${colors.green}✔ Verified project '${registeredProj.code}' (${registeredProj.name}) in Esedre data hub!${colors.reset}`);
            }
            console.log(`  • Code: ${registeredProj.code}`);
            console.log(`  • Name: ${registeredProj.name}`);
            if (registeredProj.description) {
              console.log(`  • Description: ${registeredProj.description}`);
            }
            console.log(`\n${colors.bold}Next Steps:${colors.reset}`);
            console.log(`  1. Create your first ticket:`);
            console.log(`     ${colors.cyan}ese create --title "First feature" --type Feature --project ${registeredProj.code}${colors.reset}`);
            console.log(`  2. Inspect roadmap & tickets:`);
            console.log(`     ${colors.cyan}ese list --project ${registeredProj.code}${colors.reset}`);
          }
          return;
        }

        const allowedProjects = allowArg
          ? allowArg.split(',').map((s) => s.trim())
          : (discovered.config?.allowedProjects || [projectCode!]);

        let setupProxy: boolean | undefined = undefined;
        if (flags['proxy'] !== undefined) {
          setupProxy = Boolean(flags['proxy']);
        } else if (flags['no-proxy'] !== undefined) {
          setupProxy = false;
        }

        const viteConfigPath = findViteConfig(targetDir);
        if (viteConfigPath && setupProxy === undefined && !isJson) {
          try {
            const rawContent = fs.readFileSync(viteConfigPath, 'utf-8');
            const alreadyConfigured = rawContent.includes("'/esedre'") || rawContent.includes('"/esedre"');
            if (!alreadyConfigured) {
              if (isYes) {
                setupProxy = true;
              } else if (process.stdin.isTTY) {
                const readline = await import('node:readline/promises');
                const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                try {
                  const answer = await rl.question(
                    `${colors.cyan}?${colors.reset} Detected ${colors.bold}${path.basename(viteConfigPath)}${colors.reset}. Would you like to configure a reverse proxy for ${colors.bold}/esedre${colors.reset} targeting http://127.0.0.1:${port}? [Y/n] `
                  );
                  const trimmed = answer.trim().toLowerCase();
                  setupProxy = trimmed === '' || trimmed === 'y' || trimmed === 'yes';
                } finally {
                  rl.close();
                }
              }
            }
          } catch {}
        }

        const rawHub = (flags['data-dir'] as string) || (flags['hub'] as string) || discovered.config?.dataDir;
        let hubRelPath: string | undefined = undefined;
        if (rawHub) {
          const singleHub = Array.isArray(rawHub) ? rawHub[0] : rawHub;
          const resolvedHub = path.resolve(expandHome(singleHub));
          if (fs.existsSync(resolvedHub)) {
            const rel = path.relative(targetDir, resolvedHub).replace(/\\/g, '/');
            const isSubdir = !rel.startsWith('..') && !path.isAbsolute(rel);
            // Normal use does not add dataDir to project's .esedre/esedre.json UNLESS dataDir is a subdir of project repo
            if (isSubdir || Boolean(flags['data-dir'])) {
              hubRelPath = rel.startsWith('.') ? rel : './' + rel;
            }
          }
        }

        const res = initWorkspace(targetDir, {
          projectCode,
          projectName: registeredProj.name,
          allowedProjects,
          dataDir: hubRelPath,
          port,
          setupMcp,
          setupProxy,
        });

        // Automatically link this project into central configuration
        try {
          addLocationToGlobalConfig(targetDir);
        } catch {}

        // Generate initial projection snapshot (.esedre/snapshot.json) for zero-latency context
        let snapshotTickets = 0;
        try {
          const snapshot = await generateProjectSnapshot(storage, projectCode, targetDir);
          snapshotTickets = snapshot.totalTickets;
        } catch {}

        const effectivePort = resolvePorts(discovered.config, { port }).gateway;

        if (isJson) {
          console.log(JSON.stringify({
            ...res,
            project: registeredProj,
            projectNewlyRegistered,
            snapshotTickets,
            urls: {
              ui: `http://localhost:${effectivePort}/app?project=${projectCode}`,
              portfolio: `http://localhost:${effectivePort}/app?project=all`,
              api: `http://localhost:${effectivePort}/api`,
            },
            commands: {
              start: 'ese start',
              status: 'ese status',
              stop: 'ese stop',
              create: `ese create --title "..." --project ${projectCode}`,
              list: `ese list --project ${projectCode}`,
            },
          }, null, 2));
        } else {
          console.log(`${colors.bold}${colors.green}✔ Esedre workspace initialized successfully!${colors.reset}`);
          console.log(`  • Config: .esedre/esedre.json (Project: ${projectCode} (${registeredProj.name}), Version: ${CURRENT_ESEDRE_VERSION})`);
          if (projectNewlyRegistered) {
            console.log(`  • Project: ${colors.green}Registered new project '${projectCode}' (${registeredProj.name}) in Esedre${colors.reset}`);
          } else {
            console.log(`  • Project: Verified project '${projectCode}' (${registeredProj.name}) in Esedre`);
          }
          console.log(`  • In-repo wrappers: .esedre/esedre.cmd, .esedre/ese.cmd, .esedre/esedre, .esedre/ese`);
          console.log(`  • .gitignore: ${res.gitignoreUpdated ? 'Added .esedre/snapshot.json' : 'Already configured'}`);
          console.log(`  • Snapshot: Generated .esedre/snapshot.json (${snapshotTickets} tickets projected)`);
          console.log(`  • MCP: ${res.mcpConfigured ? 'Configured in .agents/mcp_config.json' : 'Skipped'}`);
          console.log(`  • Skill: ${res.skillConfigured ? 'Updated .agents/skills/esedre/SKILL.md' : `Retained (${res.skillStatus})`}`);
          console.log(`  • Central Config: Linked into ~/.esedre/config.json`);

          if (res.viteProxyStatus === 'CONFIGURED') {
            console.log(`  • ${colors.green}Vite Proxy: Added /esedre proxy to ${res.viteConfigFile} targeting http://127.0.0.1:${effectivePort}${colors.reset}`);
          } else if (res.viteProxyStatus === 'ALREADY_CONFIGURED') {
            console.log(`  • Vite Proxy: /esedre is already configured in ${res.viteConfigFile}`);
          } else if (res.viteProxyStatus === 'SKIPPED') {
            console.log(`  • Vite Proxy: Skipped configuring ${res.viteConfigFile}`);
            console.log(`\n${colors.bold}Recommendation:${colors.reset} To embed the dev planner within your UI, add this proxy to ${res.viteConfigFile}:`);
            console.log(colors.dim + (res.recommendedProxySnippet?.split('\n').map((l: string) => '    ' + l).join('\n') || '') + colors.reset);
          } else if (res.viteProxyStatus === 'NOT_APPLICABLE') {
            console.log(`\n${colors.bold}Recommendation:${colors.reset} If you wish to embed the dev planner within your project's UI, configure a reverse proxy for '/esedre' targeting http://127.0.0.1:${effectivePort}:`);
            console.log(colors.dim + (res.recommendedProxySnippet?.split('\n').map((l: string) => '    ' + l).join('\n') || '') + colors.reset);
          } else if (res.viteProxyStatus === 'MANUAL_REQUIRED') {
            console.log(`  • ${colors.yellow}Vite Proxy: Could not automatically inject proxy into ${res.viteConfigFile}.${colors.reset}`);
            console.log(`\n${colors.bold}Recommendation:${colors.reset} Please manually add this proxy to your dev server configuration:`);
            console.log(colors.dim + (res.recommendedProxySnippet?.split('\n').map((l: string) => '    ' + l).join('\n') || '') + colors.reset);
          }

          console.log(`\n${colors.bold}Next Steps:${colors.reset}`);
          console.log(`  1. ${colors.bold}Start the background server:${colors.reset}`);
          console.log(`     ${colors.cyan}ese start${colors.reset}   (or: ${colors.dim}.esedre/ese start${colors.reset})`);
          console.log(`\n  2. ${colors.bold}Open the visual Web UI:${colors.reset}`);
          console.log(`     ${colors.cyan}http://localhost:${effectivePort}/app?project=${projectCode}${colors.reset}`);
          if (res.viteProxyStatus === 'CONFIGURED' || res.viteProxyStatus === 'ALREADY_CONFIGURED') {
            console.log(`     ${colors.dim}Embedded via host dev server:${colors.reset} http://localhost:5173/esedre/app?project=${projectCode}`);
          }
          console.log(`\n  3. ${colors.bold}Create your first ticket:${colors.reset}`);
          console.log(`     ${colors.cyan}ese create --title "First feature" --type Feature --project ${projectCode}${colors.reset}`);
          console.log(`\n  4. ${colors.bold}Inspect roadmap & tickets:${colors.reset}`);
          console.log(`     ${colors.cyan}ese list --project ${projectCode}${colors.reset}`);
        }
        return;
      }

      case 'configure': {
        const subAction = positionals[0]?.toLowerCase();

        if (subAction === 'add') {
          const targetPath = positionals[1] || '.';
          const addRes = addLocationToGlobalConfig(targetPath);

          if (isJson) {
            console.log(JSON.stringify(addRes, null, 2));
            return;
          }

          if (addRes.type === 'hub') {
            console.log(`${colors.bold}${colors.green}✔ Detected Esedre Data Hub (${addRes.projectCount || 0} projects)${colors.reset}`);
            console.log(`  • Registered in ~/.esedre/config.json -> dataDir: ${addRes.path}`);
          } else if (addRes.type === 'project') {
            console.log(`${colors.bold}${colors.green}✔ Detected Esedre project '${addRes.code}'${addRes.name ? ` (${addRes.name})` : ''}${colors.reset}`);
            console.log(`  • Linked in ~/.esedre/config.json -> projects.${addRes.code}: ${addRes.path}`);
          } else {
            console.log(`${colors.yellow}⚠️ No Esedre project or data hub detected at "${addRes.path}"${colors.reset}`);
            console.log(`👉 Run 'ese init ${targetPath}' to bring this repository online first.`);
          }
          return;
        }

        if (subAction === 'remove' || subAction === 'rm') {
          const target = positionals[1];
          if (!target) {
            console.error(`${colors.red}Error: Project code or directory path required (e.g. ese configure remove ALCE)${colors.reset}`);
            process.exit(1);
          }
          const rmRes = removeLocationFromGlobalConfig(target);
          if (isJson) {
            console.log(JSON.stringify(rmRes, null, 2));
            return;
          }
          if (rmRes.removed) {
            console.log(`${colors.green}✔ Removed ${rmRes.type || 'entry'} "${rmRes.target || target}" from central configuration (~/.esedre/config.json)${colors.reset}`);
          } else {
            console.log(`${colors.yellow}○ "${target}" not found in central configuration.${colors.reset}`);
          }
          return;
        }

        if (subAction === 'set') {
          const key = positionals[1];
          const val = positionals[2];
          if (!key || val === undefined) {
            console.error(`${colors.red}Error: Key and value required (e.g. ese configure set port 5674)${colors.reset}`);
            process.exit(1);
          }
          const parsedVal = /^\d+$/.test(val) ? parseInt(val, 10) : val;
          const setRes = setGlobalConfigKey(key, parsedVal);
          if (isJson) {
            console.log(JSON.stringify(setRes, null, 2));
            return;
          }
          console.log(`${colors.green}✔ Updated central configuration: ${key} = ${JSON.stringify(parsedVal)}${colors.reset}`);
          return;
        }

        if (subAction === 'get') {
          const key = positionals[1];
          const cfg = readGlobalConfig() || {};
          const val = key ? getGlobalConfigKey(key) : cfg;
          if (isJson) {
            console.log(JSON.stringify({ key, value: val }, null, 2));
          } else {
            console.log(val !== undefined ? (typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val)) : `${colors.dim}(not set)${colors.reset}`);
          }
          return;
        }

        // Default: display central configuration
        const globalCfg = readGlobalConfig() || {};
        const configPath = getGlobalConfigPath();

        if (isJson) {
          console.log(JSON.stringify({
            configPath,
            config: globalCfg,
          }, null, 2));
          return;
        }

        console.log(`\n${colors.bold}${colors.cyan}Esedre Central Configuration${colors.reset}`);
        console.log(`  • Config File:  ${configPath} ${fs.existsSync(configPath) ? colors.green + '(active)' + colors.reset : colors.dim + '(default)' + colors.reset}`);
        console.log(`  • Default Port: ${globalCfg.port || DEFAULT_ESEDRE_PORT}`);

        console.log(`\n${colors.bold}Data Hubs (dataDir):${colors.reset}`);
        if (globalCfg.dataDir) {
          const hubs = Array.isArray(globalCfg.dataDir) ? globalCfg.dataDir : [globalCfg.dataDir];
          for (const h of hubs) {
            console.log(`  • ${colors.cyan}${h}${colors.reset}`);
          }
        } else {
          console.log(`  ${colors.dim}(none configured: add with 'ese configure add <hubPath>')${colors.reset}`);
        }

        console.log(`\n${colors.bold}Linked Projects (projects):${colors.reset}`);
        if (globalCfg.projects && Object.keys(globalCfg.projects).length > 0) {
          for (const [code, p] of Object.entries(globalCfg.projects)) {
            console.log(`  • ${colors.bold}${code}${colors.reset}: ${colors.cyan}${p}${colors.reset}`);
          }
        } else {
          console.log(`  ${colors.dim}(none linked: link with 'ese configure add <projectPath>')${colors.reset}`);
        }

        console.log(`\n${colors.bold}Commands:${colors.reset}`);
        console.log(`  • Link external repository: ${colors.cyan}ese configure add <repoPath>${colors.reset}`);
        console.log(`  • Register a data hub:      ${colors.cyan}ese configure add <hubPath>${colors.reset}`);
        console.log(`  • Create hub project:       ${colors.cyan}ese init --project <code> --name "<name>"${colors.reset}`);
        console.log(`  • Unlink a project or hub:  ${colors.cyan}ese configure remove <code|path>${colors.reset}`);
        console.log(`  • Set setting value:        ${colors.cyan}ese configure set <key> <value>${colors.reset}`);
        console.log(`  • Bring new repo online:    ${colors.cyan}ese init [path]${colors.reset}`);
        return;
      }

      case 'upgrade': {
        const isAll = Boolean(flags['all'] || flags['a']);
        const isForce = Boolean(flags['force'] || flags['f']);

        if (isAll) {
          const globalCfg = readGlobalConfig();
          const allRes = await upgradeAllWorkspaces({
            currentWorkspaceRoot: discovered.workspaceRoot,
            globalConfig: globalCfg,
            force: isForce,
          });

          if (isJson) {
            console.log(JSON.stringify(allRes, null, 2));
            return;
          }

          if (allRes.workspaces.length === 0) {
            console.log(`${colors.yellow}No registered workspaces found to upgrade.${colors.reset}`);
            return;
          }

          console.log(`\n${colors.bold}${colors.green}✔ Esedre multi-workspace upgrade completed across ${allRes.workspaces.length} workspace(s):${colors.reset}`);
          for (const w of allRes.workspaces) {
            if (w.error) {
              console.log(`  • ${colors.red}✗ ${w.name} (${w.dir}): ${w.error}${colors.reset}`);
            } else {
              const snapStr = w.totalTickets !== undefined ? ` (${w.totalTickets} tickets projected)` : '';
              console.log(`  • ${colors.bold}${w.name}${colors.reset} (${w.dir}):`);
              console.log(`    - Wrappers updated in .esedre/`);
              if (w.totalTickets !== undefined) {
                console.log(`    - Refreshed .esedre/snapshot.json${snapStr}`);
              }
              if (w.upgrade.skillConfigured) {
                console.log(`    - Updated .agents/skills/esedre/SKILL.md`);
              } else if (w.upgrade.skillStatus === 'CUSTOMIZED') {
                console.log(`    - Preserved customized .agents/skills/esedre/SKILL.md`);
              }
            }
          }
          return;
        }

        const targetDir = positionals[0] ? path.resolve(positionals[0]) : discovered.workspaceRoot;
        const targetDiscovered = targetDir === discovered.workspaceRoot
          ? discovered
          : findEsedreConfig(targetDir, { fallbackToGlobal: true });
        const res = configureWorkspace(targetDir, {
          projectCode: targetDiscovered.config?.projectCode,
          allowedProjects: targetDiscovered.config?.allowedProjects,
          port: targetDiscovered.config?.port,
          force: isForce,
        });

        // Also refresh snapshot
        const projectCode = targetDiscovered.config?.projectCode;
        if (!projectCode) {
          console.error(`${colors.red}Error: "projectCode" is required in esedre.json configuration (no default fallback).${colors.reset}`);
          process.exit(1);
        }
        const targetStorage = targetDir === discovered.workspaceRoot
          ? storage
          : new SecurityFilter(new FilesystemStorageAdapter(targetDir, targetDiscovered.config), targetDiscovered.config);
        const snapshot = await generateProjectSnapshot(targetStorage, projectCode, targetDir);

        if (isJson) {
          console.log(JSON.stringify({ upgrade: res, snapshot: { totalTickets: snapshot.totalTickets } }, null, 2));
        } else {
          console.log(`${colors.bold}${colors.green}✔ Esedre upgrade completed!${colors.reset}`);
          console.log(`  • Esedre Engine Version: ${CURRENT_ESEDRE_VERSION}`);
          console.log(`  • Wrappers updated in .esedre/`);
          console.log(`  • Refreshed .esedre/snapshot.json (${snapshot.totalTickets} tickets projected)`);
          if (res.skillConfigured) {
            console.log(`  • ${colors.green}Updated .agents/skills/esedre/SKILL.md to latest template${colors.reset}`);
          } else if (res.skillStatus === 'CUSTOMIZED') {
            console.log(`  • ${colors.yellow}Notice: .agents/skills/esedre/SKILL.md is customized; preserved user modifications (use --force to overwrite).${colors.reset}`);
          }
        }
        return;
      }

      case 'refresh':
      case 'snapshot': {
        const projectCode = (flags['project'] as string) || discovered.config?.projectCode;
        if (!projectCode) {
          console.error(`${colors.red}Error: Project code is required (--project <code> or configure projectCode in esedre.json).${colors.reset}`);
          process.exit(1);
        }
        const snapshot = await generateProjectSnapshot(storage, projectCode, discovered.workspaceRoot);
        if (isJson) {
          console.log(JSON.stringify(snapshot, null, 2));
        } else {
          console.log(`${colors.green}✔ Generated projection snapshot for project '${projectCode}'${colors.reset}`);
          console.log(`  • Location: .esedre/snapshot.json`);
          console.log(`  • Tickets: ${snapshot.totalTickets}`);
          console.log(`  • Timestamp: ${snapshot.generatedAt}`);
        }
        return;
      }

      case 'mcp': {
        const mcpServer = new EsedreMcpServer(storage);
        mcpServer.start();
        return;
      }

      case 'start': {
        const flagPort = flags['port'] ? parseInt(String(flags['port']), 10) : undefined;
        const ports = resolvePorts(discovered.config, { port: flagPort });
        const port = ports.gateway;
        const isForeground = Boolean(flags['foreground'] || flags['f']);

        // The gateway server hosts the developer's Web UI and portfolio view.
        // It must possess unconstrained visibility across all registered data hubs and projects.
        const serverConfig = {
          ...discovered.config,
          allowedProjects: ['*'],
        };
        const serverStorage = new FilesystemStorageAdapter(discovered.workspaceRoot, serverConfig);
        printDuplicateProjectWarnings(serverStorage, isJson);

        if (isForeground) {
          const cluster = startGatewayCluster({
            gatewayPort: ports.gateway,
            uiPort: ports.ui,
            apiPort: ports.api,
            storage: serverStorage,
            workspaceRoot: discovered.workspaceRoot,
          });

          console.log(`${colors.bold}${colors.green}✔ Esedre Server active on http://localhost:${ports.gateway}${colors.reset}`);
          console.log(`  • Web UI:      http://localhost:${ports.gateway}/app (internal: ${ports.ui})`);
          console.log(`  • REST API:    http://localhost:${ports.gateway}/api (internal: ${ports.api})`);
          console.log(`  • Rewrite /:   http://localhost:${ports.gateway}/ -> http://localhost:${ports.gateway}/app/`);
          console.log(`  • Portfolio:   http://localhost:${ports.gateway}/app?project=all`);
          console.log(`  • Press Ctrl+C to stop.`);

          process.on('SIGINT', async () => {
            console.log(`\n${colors.dim}Shutting down Esedre cluster...${colors.reset}`);
            await cluster.close();
            process.exit(0);
          });
          return;
        }

        const quiet = Boolean(flags['quiet'] || isJson);
        const state = await startDaemon({ port, quiet, workspaceRoot: discovered.workspaceRoot });
        if (isJson) {
          console.log(JSON.stringify(state, null, 2));
        }
        return;
      }

      case 'stop': {
        const flagPort = flags['port'] ? parseInt(String(flags['port']), 10) : undefined;
        const port = resolvePorts(discovered.config, { port: flagPort }).gateway;
        const quiet = Boolean(flags['quiet'] || isJson);
        const stopped = await stopDaemon({ port, quiet, workspaceRoot: discovered.workspaceRoot });
        if (isJson) {
          console.log(JSON.stringify({ port, stopped }, null, 2));
        }
        return;
      }

      case 'status': {
        printDuplicateProjectWarnings(storage, isJson);
        const flagPort = flags['port'] ? parseInt(String(flags['port']), 10) : undefined;
        const port = resolvePorts(discovered.config, { port: flagPort }).gateway;
        const status = await getDaemonStatus({ port, workspaceRoot: discovered.workspaceRoot });
        const globalCfg = readGlobalConfig() || discovered.config;
        const outdatedWrappers = findOutdatedWrappers(discovered.workspaceRoot, globalCfg);

        if (isJson) {
          console.log(JSON.stringify({ ...status, outdatedWrappers }, null, 2));
        } else {
          if (status.running) {
            console.log(`${colors.bold}${colors.green}● Esedre daemon is RUNNING${colors.reset}`);
            console.log(`  • Port:        ${status.port}`);
            if (status.pid) console.log(`  • PID:         ${status.pid}`);
            if (status.version) console.log(`  • Version:     v${status.version}`);
            if (status.uptimeSeconds !== undefined) console.log(`  • Uptime:      ${status.uptimeSeconds}s`);
            if (status.startedAt) console.log(`  • Started:     ${status.startedAt}`);
            if (status.projects?.length) console.log(`  • Projects:    ${status.projects.join(', ')}`);
            if (status.logFile) console.log(`  • Logs:        ${status.logFile}`);

            if (status.staleVersion) {
              console.log(`\n${colors.yellow}⚠️  Warning: Daemon is running v${status.version}, but v${status.installedVersion} is installed.${colors.reset}`);
              console.log(`   Restart to apply updates: ${colors.cyan}ese stop && ese start${colors.reset}`);
            }
          } else {
            console.log(`${colors.yellow}○ Esedre daemon is STOPPED (port ${status.port})${colors.reset}`);
            if (status.logFile && fs.existsSync(status.logFile)) {
              console.log(`  • Recent Logs: ${status.logFile}`);
            }
          }

          if (outdatedWrappers.length > 0) {
            console.log(`\n${colors.yellow}Notice: ${outdatedWrappers.length} workspace(s) have legacy CMD wrappers (${outdatedWrappers.map((o) => o.name).join(', ')}). Run 'ese upgrade --all' to update.${colors.reset}`);
          }
        }
        return;
      }

      case 'logs': {
        const flagPort = flags['port'] ? parseInt(String(flags['port']), 10) : undefined;
        const port = resolvePorts(discovered.config, { port: flagPort }).gateway;
        const lines = flags['lines'] ? parseInt(String(flags['lines']), 10) : 40;
        printDaemonLogs({ port, lines, workspaceRoot: discovered.workspaceRoot });
        return;
      }

      case 'rename-project': {
        const oldCode = positionals[0];
        const newCode = positionals[1];
        if (!oldCode || !newCode) {
          console.error(`${colors.red}Error: Both oldCode and newCode are required (e.g. ese rename-project Profe Lab151)${colors.reset}`);
          process.exit(1);
        }
        const newName = (flags['name'] || flags['n']) as string | undefined;
        const result = await storage.renameProjectCode({ oldCode, newCode, newName });
        if (isJson) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`${colors.green}✔ Successfully renamed project "${result.oldCode}" to "${result.newCode}"${colors.reset}`);
          console.log(`  • Display Name: ${result.project.name}`);
          console.log(`  • Migrated Tickets: ${result.migratedTicketsCount}`);
          if (result.updatedHubs.length > 0) {
            console.log(`  • Updated Data Hubs: ${result.updatedHubs.length}`);
          }
          if (result.updatedConfigs.length > 0) {
            console.log(`  • Updated Configs: ${result.updatedConfigs.join(', ')}`);
          }
        }
        return;
      }

      case 'project': {
        const sub = positionals[0]?.toLowerCase();
        if (sub === 'rename') {
          const oldCode = positionals[1];
          const newCode = positionals[2];
          if (!oldCode || !newCode) {
            console.error(`${colors.red}Error: Both oldCode and newCode are required (e.g. ese project rename Profe Lab151)${colors.reset}`);
            process.exit(1);
          }
          const newName = (flags['name'] || flags['n']) as string | undefined;
          const result = await storage.renameProjectCode({ oldCode, newCode, newName });
          if (isJson) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(`${colors.green}✔ Successfully renamed project "${result.oldCode}" to "${result.newCode}"${colors.reset}`);
            console.log(`  • Display Name: ${result.project.name}`);
            console.log(`  • Migrated Tickets: ${result.migratedTicketsCount}`);
          }
          return;
        }

        if (sub === 'set') {
          const code = positionals[1] || (flags['project'] as string) || (flags['p'] as string);
          if (!code) {
            console.error(`${colors.red}Error: Project code is required (e.g. ese project set Lab151 --name "Lab 151")${colors.reset}`);
            process.exit(1);
          }
          const name = (flags['name'] || flags['n']) as string | undefined;
          const description = (flags['description'] || flags['desc'] || flags['d']) as string | undefined;
          const updated = await storage.updateProject({ code, name, description });
          if (isJson) {
            console.log(JSON.stringify(updated, null, 2));
          } else {
            console.log(`${colors.green}✔ Updated project "${updated.code}"${colors.reset}`);
            console.log(`  • Name: ${updated.name}`);
            console.log(`  • Description: ${updated.description}`);
          }
          return;
        }

        printDuplicateProjectWarnings(storage, isJson);
        const projects = await storage.getProjects();
        if (isJson) {
          console.log(JSON.stringify(projects, null, 2));
        } else {
          console.log(`${colors.bold}Registered Projects:${colors.reset}`);
          for (const p of projects) {
            console.log(`  • ${colors.bold}${p.code}${colors.reset} (#${p.id}): ${p.name}: ${colors.dim}${p.description}${colors.reset}`);
          }
        }
        return;
      }

      case 'projects': {
        printDuplicateProjectWarnings(storage, isJson);
        const projects = await storage.getProjects();
        if (isJson) {
          console.log(JSON.stringify(projects, null, 2));
        } else {
          console.log(`${colors.bold}Registered Projects:${colors.reset}`);
          for (const p of projects) {
            console.log(`  • ${colors.bold}${p.code}${colors.reset} (#${p.id}): ${p.name}: ${colors.dim}${p.description}${colors.reset}`);
          }
        }
        return;
      }

      case 'list': {
        printDuplicateProjectWarnings(storage, isJson);
        const rawProject = flags['project'] as string;
        const project = rawProject === 'all' ? undefined : (rawProject || discovered.config?.projectCode || undefined);
        const status = (flags['status'] as TicketStatus) || undefined;
        const type = ((flags['type'] as TicketType) || (flags['category'] as TicketType)) || undefined;
        const category = type;
        const rawPriority = flags['priority'] as string;
        let priority: TicketPriority | 'none' | undefined;
        if (rawPriority) {
          const lower = rawPriority.trim().toLowerCase();
          if (lower === 'none' || lower === 'null') {
            priority = 'none';
          } else {
            const norm = normalizePriority(rawPriority);
            if (!norm) {
              console.error(`${colors.red}Error: Invalid priority filter '${rawPriority}'. Valid options: Critical, High, Medium, Low, none${colors.reset}`);
              process.exit(1);
            }
            priority = norm;
          }
        }
        const search = (flags['search'] as string) || undefined;
        const milestone = (flags['milestone'] as string) || (flags['m'] as string) || undefined;
        const isBlocked = flags['blocked'] ? true : undefined;
        const linkedTo = (flags['linked-to'] as string) || (flags['linkedTo'] as string) || undefined;

        const tickets = await storage.listTickets({ project, status, type, category, priority, milestone, search, isBlocked, linkedTo });
        if (isJson) {
          console.log(JSON.stringify(tickets.map((t) => ({
            id: t.meta.id,
            title: normalizeDashesAndMojibake(t.meta.title),
            type: t.meta.type || t.meta.category,
            category: t.meta.type || t.meta.category,
            status: t.meta.status,
            priority: t.meta.priority,
            complexity: normalizeDashesAndMojibake(t.meta.complexity),
            effort: normalizeDashesAndMojibake(t.meta.estimatedEffort),
            milestone: t.meta.milestone,
            featureFlag: t.meta.featureFlag,
            inheritedFeatureFlag: t.meta.inheritedFeatureFlag,
            project: t.projectDescriptor?.code || t.meta.project || 'UNASSIGNED',
            sha1: t.sha1 || t.meta.sha1,
            isBlocked: t.isBlocked,
            links: t.links,
          })), null, 2));
        } else {
          if (tickets.length === 0) {
            console.log(`${colors.dim}No tickets found matching criteria.${colors.reset}`);
            const projects = await storage.getProjects();
            if (discovered.config?.projectCode) {
              console.log(`${colors.dim}Tip: Create your first ticket with 'ese create --title "..." --type Feature'.${colors.reset}`);
            } else if (projects.length > 0) {
              const codes = projects.map((p) => p.code).join(', ');
              console.log(`${colors.dim}Tip: Create a ticket with 'ese create --title "..." --type Feature --project <${codes}>'.${colors.reset}`);
            } else {
              console.log(`${colors.dim}Tip: Run 'ese init' to initialize this repository.${colors.reset}`);
            }
          } else {
            console.log(formatTicketListTable(tickets));
            console.log(`\n${colors.dim}Total: ${tickets.length} tickets${colors.reset}`);
          }
        }
        return;
      }

      case 'get': {
        const idStr = positionals[0];
        if (!idStr) {
          console.error(`${colors.red}Error: Ticket ID is required (e.g. ese get 1 or ese get Profe-1)${colors.reset}`);
          process.exit(1);
        }
        const projectFlag = flags['project'] as string;
        const lookupKey = projectFlag && /^\d+$/.test(idStr) ? `${projectFlag}-${idStr}` : idStr;
        const ticket = await storage.getTicket(lookupKey);
        if (!ticket) {
          console.error(`${colors.red}Error: Ticket #${lookupKey} not found.${colors.reset}`);
          process.exit(1);
        }

        if (isJson) {
          console.log(JSON.stringify(ticket, null, 2));
        } else {
          console.log(formatTicketDetail(ticket));
        }
        return;
      }

      case 'plan': {
        const idStr = positionals[0];
        if (!idStr) {
          console.error(`${colors.red}Error: Ticket ID is required (e.g. ese plan 1 or ese plan Profe-1)${colors.reset}`);
          process.exit(1);
        }
        const projectFlag = flags['project'] as string;
        const id = projectFlag && /^\d+$/.test(idStr) ? `${projectFlag}-${idStr}` : idStr;

        const setPlan = flags['set'] as string;
        const filePath = flags['file'] as string;
        const isForce = Boolean(flags['force']);
        const lastHash = isForce ? undefined : (flags['last-hash'] as string);

        if (setPlan || filePath) {
          let content = setPlan;
          if (filePath) {
            if (!fs.existsSync(filePath)) {
              console.error(`${colors.red}Error: Plan file "${filePath}" not found.${colors.reset}`);
              process.exit(1);
            }
            content = fs.readFileSync(filePath, 'utf-8');
          }
          await storage.savePlan(id, content, lastHash);
          if (isJson) {
            const updated = await storage.getTicket(id);
            console.log(JSON.stringify({
              success: true,
              ticketId: id,
              project: updated?.projectDescriptor?.code || updated?.meta?.project || 'UNASSIGNED',
              planMarkdown: content,
              sha1: updated?.sha1 || updated?.meta?.sha1,
            }, null, 2));
          } else {
            console.log(`${colors.green}✔ Implementation plan saved for Ticket #${id}${colors.reset}`);
          }
          return;
        }

        const plan = await storage.getPlan(id);
        if (!plan) {
          if (isJson) {
            console.log(JSON.stringify({ ticketId: id, planMarkdown: null }, null, 2));
          } else {
            console.log(`${colors.dim}No implementation plan found for Ticket #${id}.${colors.reset}`);
          }
          return;
        }

        if (isJson) {
          console.log(JSON.stringify({ ticketId: id, planMarkdown: plan }, null, 2));
        } else {
          console.log(plan);
        }
        return;
      }

      case 'create': {
        const rawTitle = flags['title'] as string;
        if (!rawTitle) {
          console.error(`${colors.red}Error: --title is required${colors.reset}`);
          process.exit(1);
        }
        const title = normalizeDashesAndMojibake(rawTitle);

        const type = ((flags['type'] as string) || (flags['category'] as string) || 'Feature') as TicketType;
        const category = type;
        const rawPriority = flags['priority'] as string;
        let priority: TicketPriority | undefined;
        if (rawPriority) {
          const norm = normalizePriority(rawPriority);
          if (!norm) {
            console.error(`${colors.red}Error: Invalid priority '${rawPriority}'. Valid options: Critical, High, Medium, Low${colors.reset}`);
            process.exit(1);
          }
          priority = norm;
        }
        const projectCode = (flags['project'] as string) || discovered.config?.projectCode;
        if (!projectCode) {
          console.error(`${colors.red}Error: Project is required to create a ticket (--project <code> or configure projectCode in esedre.json).${colors.reset}`);
          console.error(`${colors.dim}Tip: Run 'ese init' to initialize this repository.${colors.reset}`);
          process.exit(1);
        }
        const complexity = normalizeDashesAndMojibake((flags['complexity'] as string) || 'Medium');
        const estimatedEffort = normalizeDashesAndMojibake((flags['effort'] as string) || '2.0 - 4.0 hours');
        const summary = flags['summary'] ? normalizeDashesAndMojibake(flags['summary'] as string) : undefined;
        const submittedBy = (flags['author'] as string) || 'Developer';

        const val = validateProjectCode(projectCode);
        if (!val.valid) {
          console.error(`${colors.red}Error: ${val.error}${colors.reset}`);
          process.exit(1);
        }

        const detailArg = flags['detail'] as string;
        const fileArg = flags['file'] as string;
        const milestone = (flags['milestone'] as string) || (flags['m'] as string) || undefined;

        let detailMarkdown: string | undefined = detailArg;
        if (fileArg) {
          const filePath = path.resolve(fileArg);
          if (!fs.existsSync(filePath)) {
            if (isJson) {
              console.error(JSON.stringify({ error: `Detail file "${fileArg}" not found` }));
            } else {
              console.error(`${colors.red}Error: Detail file "${fileArg}" not found.${colors.reset}`);
            }
            process.exit(1);
          }
          detailMarkdown = fs.readFileSync(filePath, 'utf-8');
        }

        const created = await storage.createTicket({
          title,
          type,
          category,
          priority,
          projectCode,
          complexity,
          estimatedEffort,
          summary,
          submittedBy,
          detail: detailMarkdown,
          detailMarkdown,
          milestone,
        });

        if (isJson) {
          console.log(JSON.stringify(created, null, 2));
        } else {
          console.log(`${colors.green}✔ Created Ticket #${created.meta.id}: ${created.meta.title}${colors.reset} [${created.projectDescriptor?.code || created.meta.project || 'UNASSIGNED'}]${created.meta.priority ? ` [${created.meta.priority}]` : ''} (SHA-1: ${created.sha1?.slice(0, 8)})`);
        }
        return;
      }

      case 'update': {
        const idStr = positionals[0];
        if (!idStr) {
          console.error(`${colors.red}Error: Ticket ID is required (e.g. ese update 96 --status "Completed" or ese update Profe-96)${colors.reset}`);
          process.exit(1);
        }
        const projectFlag = flags['project'] as string;
        const lookupKey = projectFlag && /^\d+$/.test(idStr) ? `${projectFlag}-${idStr}` : idStr;

        const status = flags['status'] as TicketStatus;
        const title = flags['title'] ? normalizeDashesAndMojibake(flags['title'] as string) : undefined;
        const complexity = flags['complexity'] ? normalizeDashesAndMojibake(flags['complexity'] as string) : undefined;
        const effort = flags['effort'] ? normalizeDashesAndMojibake(flags['effort'] as string) : undefined;
        const inDev = flags['in-dev'] !== undefined ? Boolean(flags['in-dev']) : undefined;
        const flag = flags['flag'] as string;
        const rawMilestone = flags['milestone'] !== undefined ? flags['milestone'] : flags['m'];
        const isForce = Boolean(flags['force']);
        const lastHash = isForce ? undefined : (flags['last-hash'] as string);

        const updates: any = {};
        const type = ((flags['type'] as TicketType) || (flags['category'] as TicketType)) || undefined;
        if (type) { updates.type = type; updates.category = type; }
        if (status) updates.status = status;
        if (flags['priority'] !== undefined) {
          const raw = String(flags['priority']).trim();
          if (raw.toLowerCase() === 'none' || raw.toLowerCase() === 'clear' || raw.toLowerCase() === 'null') {
            updates.priority = 'none';
          } else {
            const norm = normalizePriority(raw);
            if (!norm) {
              console.error(`${colors.red}Error: Invalid priority '${raw}'. Valid options: Critical, High, Medium, Low, none${colors.reset}`);
              process.exit(1);
            }
            updates.priority = norm;
          }
        }
        if (title) updates.title = title;
        if (complexity) updates.complexity = complexity;
        if (effort) updates.estimatedEffort = effort;
        if (inDev !== undefined) updates.isActivePlanning = inDev;
        if (flag) updates.featureFlag = flag;
        if (rawMilestone !== undefined) updates.milestone = rawMilestone as string;

        const detailArg = flags['detail'] as string;
        const fileArg = flags['file'] as string;
        let detailMarkdown: string | undefined = detailArg ? normalizeDashesAndMojibake(detailArg) : undefined;
        if (fileArg) {
          const filePath = path.resolve(fileArg);
          if (!fs.existsSync(filePath)) {
            if (isJson) {
              console.error(JSON.stringify({ error: `Detail file "${fileArg}" not found` }));
            } else {
              console.error(`${colors.red}Error: Detail file "${fileArg}" not found.${colors.reset}`);
            }
            process.exit(1);
          }
          detailMarkdown = normalizeDashesAndMojibake(fs.readFileSync(filePath, 'utf-8'));
        }
        if (detailMarkdown !== undefined) updates.detailMarkdown = detailMarkdown;

        const updated = await storage.updateTicket(lookupKey, updates, lastHash);
        if (isJson) {
          console.log(JSON.stringify(updated, null, 2));
        } else {
          console.log(`${colors.green}✔ Updated Ticket #${lookupKey}: ${updated.meta.title} (Status: ${updated.meta.status}${updated.meta.priority ? `, Priority: ${updated.meta.priority}` : ''}${updated.meta.milestone ? `, Milestone: ${updated.meta.milestone}` : ''}, SHA-1: ${updated.sha1?.slice(0, 8)})${colors.reset}`);
        }
        return;
      }

      case 'milestone':
      case 'milestones': {
        const subAction = positionals[0] || 'list';
        const project = (flags['project'] as string) || (flags['p'] as string) || discovered.config?.projectCode;

        if (subAction === 'list') {
          const milestones = await storage.listMilestones(project);
          const allTickets = await storage.listTickets({ project });
          if (isJson) {
            console.log(JSON.stringify(milestones, null, 2));
          } else {
            console.log(formatMilestoneListTable(milestones, allTickets));
            if (milestones.length > 0) {
              console.log(`\n${colors.dim}Total: ${milestones.length} milestones${colors.reset}`);
            }
          }
          return;
        }

        if (subAction === 'get') {
          const idStr = positionals[1];
          if (!idStr) {
            console.error(`${colors.red}Error: Milestone ID or title is required (e.g. ese milestone get 1 or ese milestone get "v0.2.0")${colors.reset}`);
            process.exit(1);
          }
          const milestone = await storage.getMilestone(idStr, project);
          if (!milestone) {
            console.error(`${colors.red}Error: Milestone "${idStr}" not found.${colors.reset}`);
            process.exit(1);
          }
          const tickets = await storage.listTickets({ project, milestone: String(milestone.id) });
          if (isJson) {
            console.log(JSON.stringify({ ...milestone, tickets }, null, 2));
          } else {
            console.log(`${colors.bold}${colors.cyan}Milestone #${milestone.id}: ${milestone.title}${colors.reset}`);
            console.log(`${colors.dim}${'='.repeat(60)}${colors.reset}`);
            console.log(`${colors.bold}Project:${colors.reset}       ${milestone.project}`);
            console.log(`${colors.bold}Status:${colors.reset}        ${milestone.status}`);
            if (milestone.featureFlag) {
              console.log(`${colors.bold}Umbrella Flag:${colors.reset} ${colors.yellow}${milestone.featureFlag}${colors.reset} ${colors.dim}(inherited by all tickets in milestone)${colors.reset}`);
            }
            if (milestone.targetDate) {
              console.log(`${colors.bold}Target Date:${colors.reset}   ${milestone.targetDate}`);
            }
            if (milestone.description) {
              console.log(`\n${colors.bold}Description:${colors.reset}\n${milestone.description}`);
            }
            const completedCount = tickets.filter((t) => t.meta.status === 'Completed').length;
            const progress = tickets.length > 0 ? Math.round((completedCount / tickets.length) * 100) : 0;
            console.log(`\n${colors.bold}Progress:${colors.reset}      ${completedCount} / ${tickets.length} completed (${progress}%)`);
            if (tickets.length > 0) {
              console.log(`\n${colors.bold}Tickets:${colors.reset}`);
              for (const t of tickets) {
                console.log(`  • #${t.meta.id} [${t.meta.status}] [${t.meta.type}]: ${t.meta.title}${t.meta.priority ? ` (${t.meta.priority})` : ''}`);
              }
            }
          }
          return;
        }

        if (subAction === 'create') {
          const rawTitle = (flags['title'] as string) || positionals.slice(1).join(' ').trim();
          if (!rawTitle) {
            console.error(`${colors.red}Error: --title is required to create a milestone (e.g. ese milestone create --title "v0.2.0")${colors.reset}`);
            process.exit(1);
          }
          const title = normalizeDashesAndMojibake(rawTitle);
          const projectCode = project;
          if (!projectCode) {
            console.error(`${colors.red}Error: Project is required to create a milestone (--project <code> or configure projectCode in esedre.json).${colors.reset}`);
            process.exit(1);
          }
          const description = (flags['desc'] as string) || (flags['description'] as string);
          const featureFlag = (flags['flag'] as string) || (flags['feature-flag'] as string);
          const targetDate = (flags['target-date'] as string) || (flags['date'] as string);
          const status = (flags['status'] as any) || 'Planned';

          const created = await storage.createMilestone({
            projectCode,
            title,
            description,
            featureFlag,
            targetDate,
            status,
          });

          if (isJson) {
            console.log(JSON.stringify(created, null, 2));
          } else {
            console.log(`${colors.green}✔ Created Milestone #${created.id}: ${created.title} [${created.project}]${created.featureFlag ? ` (Umbrella Flag: ${created.featureFlag})` : ''}${colors.reset}`);
          }
          return;
        }

        if (subAction === 'update') {
          const idStr = positionals[1];
          if (!idStr) {
            console.error(`${colors.red}Error: Milestone ID is required (e.g. ese milestone update 1 --status Active)${colors.reset}`);
            process.exit(1);
          }
          const updates: any = {};
          if (flags['title']) updates.title = flags['title'] as string;
          if (flags['desc'] || flags['description']) updates.description = (flags['desc'] || flags['description']) as string;
          if (flags['status']) updates.status = flags['status'];
          if (flags['flag'] !== undefined || flags['feature-flag'] !== undefined) {
            updates.featureFlag = flags['flag'] !== undefined ? flags['flag'] : flags['feature-flag'];
          }
          if (flags['target-date'] !== undefined || flags['date'] !== undefined) {
            updates.targetDate = flags['target-date'] !== undefined ? flags['target-date'] : flags['date'];
          }

          const updated = await storage.updateMilestone(idStr, updates, project);
          if (isJson) {
            console.log(JSON.stringify(updated, null, 2));
          } else {
            console.log(`${colors.green}✔ Updated Milestone #${updated.id}: ${updated.title} (Status: ${updated.status}${updated.featureFlag ? `, Flag: ${updated.featureFlag}` : ''})${colors.reset}`);
          }
          return;
        }

        if (subAction === 'delete') {
          const idStr = positionals[1];
          if (!idStr) {
            console.error(`${colors.red}Error: Milestone ID is required (e.g. ese milestone delete 1)${colors.reset}`);
            process.exit(1);
          }
          const success = await storage.deleteMilestone(idStr, project);
          if (isJson) {
            console.log(JSON.stringify({ success, id: idStr }, null, 2));
          } else {
            if (success) {
              console.log(`${colors.green}✔ Deleted Milestone #${idStr}${colors.reset}`);
            } else {
              console.error(`${colors.red}Error: Milestone "${idStr}" not found.${colors.reset}`);
              process.exit(1);
            }
          }
          return;
        }

        console.error(`${colors.red}Error: Unknown milestone action "${subAction}". Valid actions: list, get, create, update, delete${colors.reset}`);
        process.exit(1);
      }

      case 'comment': {
        const idStr = positionals[0];
        if (!idStr) {
          console.error(`${colors.red}Error: Ticket ID is required (e.g. ese comment 96 --text "..." or ese comment Profe-96)${colors.reset}`);
          process.exit(1);
        }
        const projectFlag = flags['project'] as string;
        const lookupKey = projectFlag && /^\d+$/.test(idStr) ? `${projectFlag}-${idStr}` : idStr;

        const positionalText = positionals.slice(1).join(' ').trim();
        const text = (flags['text'] as string) || (positionalText || undefined);
        if (!text) {
          console.error(`${colors.red}Error: Comment text is required (e.g. ese comment 96 "Verified tests" or --text "...")${colors.reset}`);
          process.exit(1);
        }
        const author = (flags['author'] as string) || 'User';

        const comment = await storage.addComment(lookupKey, { author, text });
        if (isJson) {
          console.log(JSON.stringify(comment, null, 2));
        } else {
          console.log(`${colors.green}✔ Added comment to Ticket #${lookupKey} by ${comment.author}${colors.reset}`);
        }
        return;
      }

      case 'link': {
        let sourceId = positionals[0];
        let relationArg = flags['relation'] as string;
        let targetId = (flags['to'] as string) || positionals[1];

        if (positionals.length >= 3) {
          sourceId = positionals[0];
          relationArg = positionals[1];
          targetId = positionals[2];
        } else if (positionals.length === 2 && !flags['relation']) {
          const normRel = positionals[1].toLowerCase().replace(/_/g, '-');
          if (['blocks', 'blocked-by', 'relates-to', 'parent-of', 'child-of', 'duplicates', 'duplicated-by'].includes(normRel)) {
            relationArg = normRel;
            targetId = (flags['to'] as string) || positionals[2];
          } else {
            targetId = positionals[1];
            relationArg = 'relates-to';
          }
        }

        if (!sourceId || !targetId) {
          console.error(`${colors.red}Error: Both source and target ticket IDs are required.${colors.reset}`);
          console.error(`${colors.dim}Usage: ese link <sourceId> <relation> <targetId> [options]${colors.reset}`);
          console.error(`${colors.dim}Relations: blocks, blocked-by, relates-to, parent-of, child-of, duplicates, duplicated-by${colors.reset}`);
          process.exit(1);
        }

        const relation = (relationArg || 'relates-to').toLowerCase().replace(/_/g, '-') as TicketLinkRelation;
        const project = (flags['project'] as string) || discovered.config?.projectCode;
        const author = (flags['author'] as string) || 'User';

        const result = await storage.addTicketLink(sourceId, relation, targetId, { author, project });
        if (isJson) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`${colors.green}✔ Linked #${result.source.meta.id} (${result.source.meta.project || 'Project'}) -> ${relation} -> #${targetId}${colors.reset}`);
        }
        return;
      }

      case 'unlink': {
        const sourceId = positionals[0];
        const targetId = (flags['to'] as string) || positionals[1];

        if (!sourceId || !targetId) {
          console.error(`${colors.red}Error: Both source and target ticket IDs are required.${colors.reset}`);
          console.error(`${colors.dim}Usage: ese unlink <sourceId> <targetId> [options]${colors.reset}`);
          process.exit(1);
        }

        const project = (flags['project'] as string) || discovered.config?.projectCode;
        const result = await storage.removeTicketLink(sourceId, targetId, { project });
        if (isJson) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`${colors.green}✔ Unlinked #${result.source.meta.id} from #${targetId}${colors.reset}`);
        }
        return;
      }

      default: {
        console.error(`${colors.red}Error: Unknown command "${command}"${colors.reset}`);
        printHelp();
        process.exit(1);
      }
    }
  } catch (err: any) {
    if (err instanceof EsedreConflictError || err.name === 'EsedreConflictError') {
      console.error(`${colors.red}Conflict Error: ${err.message}${colors.reset}`);
      console.error(`${colors.dim}Use --force to override if you are certain.${colors.reset}`);
      process.exit(1);
    }
    if (err instanceof EsedreAuthorizationError || err.name === 'EsedreAuthorizationError') {
      console.error(`${colors.red}Access Denied: ${err.message}${colors.reset}`);
      process.exit(1);
    }
    console.error(`${colors.red}Fatal Error: ${err.message}${colors.reset}`);
    process.exit(1);
  }
}

main();
