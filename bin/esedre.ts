#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { SecurityFilter } from '../src/securityFilter.js';
import { formatTicketListTable, formatTicketDetail, colors } from '../src/utils/formatter.js';
import { EsedreMcpServer } from '../src/mcp/server.js';
import { TicketType, TicketCategory, TicketStatus, ProjectDescriptor, EsedreConflictError } from '../src/types.js';
import { findEsedreConfig, EsedreAuthorizationError, validateProjectCode } from '../src/config.js';
import { generateProjectSnapshot } from '../src/snapshot.js';
import { configureWorkspace, CURRENT_ESEDRE_VERSION, findViteConfig } from '../src/upgrade.js';
import { startGatewayCluster } from '../src/server/gateway.js';
import { startDaemon, stopDaemon, getDaemonStatus, printDaemonLogs } from '../src/server/daemon.js';

function printHelp(): void {
  console.log(`
${colors.bold}${colors.cyan}Esedre CLI (/eh-seh-dreh/)${colors.reset}: Developer Roadmap & Companion LLM Coordination Engine

${colors.bold}USAGE:${colors.reset}
  .esedre/esedre <command> [options]
  .esedre/ese <command> [options]
  esedre <command> [options]
  ese <command> [options]
  node tools/esedre.mjs <command> [options]

${colors.bold}COMMANDS:${colors.reset}
  ${colors.bold}list${colors.reset}        [-p|--project <code|all>] [-s|--status <status>] [-t|--type <type>] [-q|--search <q>] [--json]
               List roadmap tickets with optional filters (defaults to active project).
               • Status values: 'Planned', 'In Development', 'Completed', 'Rejected'
               • Type values:   'Feature', 'Platform', 'Tools', 'Idea', 'Bug'

  ${colors.bold}get${colors.reset}         <id> [--json]
               Inspect full ticket specification, feature breakdown, and comments.

  ${colors.bold}plan${colors.reset}        <id> [--file <path> | --set "<markdown>"] [--last-hash <sha1>] [--json]
               View or update implementation plan with optimistic concurrency control.

  ${colors.bold}create${colors.reset}      --title "..." [-p|--project <code>] [-t|--type <type>] [--complexity <c>] [--effort "<e>"] [--summary "<s>"] [--json]
               Mint a new roadmap ticket with sequential numeric ID.

  ${colors.bold}update${colors.reset}      <id> [-s|--status <status>] [--title "..."] [--flag] [--no-flag] [--last-hash <sha1>] [--force] [--json]
               Mutate ticket status, title, active state, or feature flag with OCC protection.

  ${colors.bold}comment${colors.reset}     <id> --text "..." [--author "..."] [--json]
               Append a research finding, test verification, or note to ticket history.

  ${colors.bold}snapshot${colors.reset}    [--project <code>] [--json]
               Generate lean read-only projection snapshot (.esedre/snapshot.json) for zero-latency agent context.

  ${colors.bold}configure${colors.reset}   [--project <code>] [-n|--name <name>] [--allow <c1,c2>] [--port <n>] [--no-mcp] [--proxy] [--no-proxy] [-y|--yes] [--json]
               Initialize or update .esedre footprint, register project code & display name in Esedre,
               plant wrappers (.esedre/esedre.cmd, .esedre/ese.cmd, etc.), configure .gitignore,
               MCP server config, agent skill templates, and display guided next steps.

  ${colors.bold}upgrade${colors.reset}     [--json]
               Upgrade workspace configuration schema, wrappers, and agent skills. Refreshes snapshot.

  ${colors.bold}projects${colors.reset}    [--json]
               List registered workspace projects, project codes (e.g. 'CORE', 'WEB', 'DOCS'), and descriptions.

  ${colors.bold}daemon${colors.reset}      [start|stop|status|logs] [--port <n>] [--quiet] [--json]
               Manage background daemon process (start, stop, check status, or view logs).

  ${colors.bold}serve${colors.reset}       [--port <n>]
               Run the unified gateway & web server in foreground (default 5674).

  ${colors.bold}start${colors.reset}       [--port <n>] [--quiet] [--json]
               Alias for 'daemon start'. Start Esedre background daemon process.

  ${colors.bold}stop${colors.reset}        [--port <n>] [--quiet] [--json]
               Alias for 'daemon stop'. Stop the running Esedre background daemon process.

  ${colors.bold}status${colors.reset}      [--port <n>] [--json]
               Alias for 'daemon status'. Check health and diagnostics of the daemon process.

  ${colors.bold}logs${colors.reset}        [--port <n>] [--lines <n>]
               Tail recent output logs from the Esedre daemon process.

  ${colors.bold}mcp${colors.reset}         Start the Model Context Protocol (MCP) JSON-RPC 2.0 stdio server for autonomous LLM coding agents.

${colors.bold}OPTIONS:${colors.reset}
  -p, --project <code> Project code (e.g. CORE, ALCE, DOCS).
  -n, --name <name>    Project display name (e.g. "Alce Web Reader").
  -t, --type <type>    Ticket type ('Feature', 'Platform', 'Tools', 'Idea', 'Bug').
  -s, --status <stat>  Ticket status ('Planned', 'In Development', 'Completed', 'Rejected').
  -q, --search <query> Case-insensitive substring search query.
  --json              Output raw machine-readable JSON (strongly recommended for autonomous LLM coding agents).
  --last-hash <hash>  Optimistic concurrency control: last known sha1 hash of the ticket from 'get'.
  --force             Bypass optimistic concurrency last-hash conflict checks on writes.
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
      } else if (key === 't' || key === 'p' || key === 's' || key === 'q' || key === 'n') {
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
  if (flags['n'] && !flags['name']) flags['name'] = flags['n'];
  if (flags['s'] && !flags['status']) flags['status'] = flags['s'];
  if (flags['q'] && !flags['search']) flags['search'] = flags['q'];

  return { command, positionals, flags };
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const { command, positionals, flags } = parseArgs(rawArgs);

  if (!command || flags['help'] || flags['h']) {
    printHelp();
    return;
  }

  const isJson = Boolean(flags['json']);
  const discovered = findEsedreConfig(process.cwd());

  // SecurityFilter wraps raw FilesystemStorageAdapter
  const rawStorage = new FilesystemStorageAdapter(discovered.workspaceRoot, discovered.config);
  const storage = new SecurityFilter(rawStorage, discovered.config);

  try {
    switch (command) {
      case 'configure': {
        let projectCode = (flags['project'] as string) || (flags['p'] as string) || discovered.config?.projectCode;
        let projectName = (flags['name'] as string) || (flags['n'] as string) || discovered.config?.projectName;
        const allowArg = flags['allow'] as string;
        const port = flags['port'] ? parseInt(String(flags['port']), 10) : (discovered.config?.port || 5674);
        const setupMcp = flags['no-mcp'] ? false : true;
        const isYes = Boolean(flags['yes'] || flags['y']);

        if (process.stdin.isTTY && (!projectCode || !projectName) && !isJson) {
          const readline = await import('node:readline/promises');
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          try {
            if (!projectCode) {
              const codeAnswer = await rl.question(
                `${colors.cyan}?${colors.reset} Project code (1-6 alphanumeric characters, e.g. ALCE, DOCS): `
              );
              projectCode = codeAnswer.trim();
            }
            if (!projectName && projectCode) {
              const nameAnswer = await rl.question(
                `${colors.cyan}?${colors.reset} Project display name (e.g. ${projectCode} App) [${projectCode}]: `
              );
              projectName = nameAnswer.trim() || projectCode;
            }
          } finally {
            rl.close();
          }
        }

        if (!projectCode) {
          console.error(`${colors.red}Error: Project code is required (--project <code>, -p <code>, or configure projectCode in esedre.json).${colors.reset}`);
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

        // Register project in Esedre if not already registered (or update display name)
        const existingProjects = await storage.getProjects();
        const existing = existingProjects.find(
          (p) => p.code.toLowerCase() === projectCode!.toLowerCase()
        );
        let projectNewlyRegistered = false;
        let registeredProj: ProjectDescriptor;
        if (!existing) {
          registeredProj = await rawStorage.registerProject({
            code: projectCode!,
            name: projectName,
          });
          projectNewlyRegistered = true;
        } else {
          registeredProj = existing;
          if (flags['name'] || flags['n']) {
            registeredProj = await rawStorage.registerProject({
              code: projectCode!,
              name: projectName,
            });
          }
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

        const viteConfigPath = findViteConfig(discovered.workspaceRoot);
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

        const res = configureWorkspace(discovered.workspaceRoot, {
          projectCode,
          projectName: registeredProj.name,
          allowedProjects,
          port,
          setupMcp,
          setupProxy,
        });

        // Generate initial projection snapshot (.esedre/snapshot.json) for zero-latency context
        let snapshotTickets = 0;
        try {
          const snapshot = await generateProjectSnapshot(storage, projectCode, discovered.workspaceRoot);
          snapshotTickets = snapshot.totalTickets;
        } catch {}

        if (isJson) {
          console.log(JSON.stringify({
            ...res,
            project: registeredProj,
            projectNewlyRegistered,
            snapshotTickets,
            urls: {
              ui: `http://localhost:${port}/app?project=${projectCode}`,
              portfolio: `http://localhost:${port}/app?project=all`,
              api: `http://localhost:${port}/api`,
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
          console.log(`${colors.bold}${colors.green}✔ Esedre workspace configured successfully!${colors.reset}`);
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
          if (res.globalStoreStatus === 'ready') {
            console.log(`  • Global Store: ${res.globalStorePath} (verified write permissions)`);
          } else if (res.globalStoreStatus === 'warning') {
            console.log(`  • ${colors.yellow}Global Store: Fallback to ${res.globalStorePath} (${res.globalStoreError})${colors.reset}`);
          }

          if (res.viteProxyStatus === 'CONFIGURED') {
            console.log(`  • ${colors.green}Vite Proxy: Added /esedre proxy to ${res.viteConfigFile} targeting http://127.0.0.1:${port}${colors.reset}`);
          } else if (res.viteProxyStatus === 'ALREADY_CONFIGURED') {
            console.log(`  • Vite Proxy: /esedre is already configured in ${res.viteConfigFile}`);
          } else if (res.viteProxyStatus === 'SKIPPED') {
            console.log(`  • Vite Proxy: Skipped configuring ${res.viteConfigFile}`);
            console.log(`\n${colors.bold}Recommendation:${colors.reset} To embed the dev planner within your UI, add this proxy to ${res.viteConfigFile}:`);
            console.log(colors.dim + (res.recommendedProxySnippet?.split('\n').map((l: string) => '    ' + l).join('\n') || '') + colors.reset);
          } else if (res.viteProxyStatus === 'NOT_APPLICABLE') {
            console.log(`\n${colors.bold}Recommendation:${colors.reset} If you wish to embed the dev planner within your project's UI, configure a reverse proxy for '/esedre' targeting http://127.0.0.1:${port}:`);
            console.log(colors.dim + (res.recommendedProxySnippet?.split('\n').map((l: string) => '    ' + l).join('\n') || '') + colors.reset);
          } else if (res.viteProxyStatus === 'MANUAL_REQUIRED') {
            console.log(`  • ${colors.yellow}Vite Proxy: Could not automatically inject proxy into ${res.viteConfigFile}.${colors.reset}`);
            console.log(`\n${colors.bold}Recommendation:${colors.reset} Please manually add this proxy to your dev server configuration:`);
            console.log(colors.dim + (res.recommendedProxySnippet?.split('\n').map((l: string) => '    ' + l).join('\n') || '') + colors.reset);
          }

          console.log(`\n${colors.bold}Next Steps:${colors.reset}`);
          console.log(`  1. ${colors.bold}Start the background daemon:${colors.reset}`);
          console.log(`     ${colors.cyan}ese start${colors.reset}   (or: ${colors.dim}.esedre/ese start${colors.reset})`);
          console.log(`\n  2. ${colors.bold}Open the visual Web UI:${colors.reset}`);
          console.log(`     ${colors.cyan}http://localhost:${port}/app?project=${projectCode}${colors.reset}`);
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

      case 'upgrade': {
        const res = configureWorkspace(discovered.workspaceRoot, {
          projectCode: discovered.config?.projectCode,
          allowedProjects: discovered.config?.allowedProjects,
          port: discovered.config?.port,
        });

        // Also refresh snapshot
        const projectCode = discovered.config?.projectCode;
        if (!projectCode) {
          console.error(`${colors.red}Error: "projectCode" is required in esedre.json configuration (no default fallback).${colors.reset}`);
          process.exit(1);
        }
        const snapshot = await generateProjectSnapshot(storage, projectCode, discovered.workspaceRoot);

        if (isJson) {
          console.log(JSON.stringify({ upgrade: res, snapshot: { totalTickets: snapshot.totalTickets } }, null, 2));
        } else {
          console.log(`${colors.bold}${colors.green}✔ Esedre upgrade completed!${colors.reset}`);
          console.log(`  • Esedre Engine Version: ${CURRENT_ESEDRE_VERSION}`);
          console.log(`  • Wrappers updated in .esedre/`);
          console.log(`  • Refreshed .esedre/snapshot.json (${snapshot.totalTickets} tickets projected)`);
          if (res.skillStatus === 'CUSTOMIZED') {
            console.log(`  • ${colors.yellow}Notice: .agents/skills/esedre/SKILL.md is customized; preserved user modifications.${colors.reset}`);
          }
        }
        return;
      }

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
        const port = flags['port'] ? parseInt(String(flags['port']), 10) : (discovered.config?.port || 5674);
        const quiet = Boolean(flags['quiet'] || isJson);
        const state = await startDaemon({ port, quiet, workspaceRoot: discovered.workspaceRoot });
        if (isJson) {
          console.log(JSON.stringify(state, null, 2));
        }
        return;
      }

      case 'stop': {
        const port = flags['port'] ? parseInt(String(flags['port']), 10) : (discovered.config?.port || 5674);
        const quiet = Boolean(flags['quiet'] || isJson);
        const stopped = await stopDaemon({ port, quiet, workspaceRoot: discovered.workspaceRoot });
        if (isJson) {
          console.log(JSON.stringify({ port, stopped }, null, 2));
        }
        return;
      }

      case 'status': {
        const port = flags['port'] ? parseInt(String(flags['port']), 10) : (discovered.config?.port || 5674);
        const status = await getDaemonStatus({ port, workspaceRoot: discovered.workspaceRoot });
        if (isJson) {
          console.log(JSON.stringify(status, null, 2));
        } else {
          if (status.running) {
            console.log(`${colors.bold}${colors.green}● Esedre daemon is RUNNING${colors.reset}`);
            console.log(`  • Port:        ${status.port}`);
            if (status.pid) console.log(`  • PID:         ${status.pid}`);
            if (status.uptimeSeconds !== undefined) console.log(`  • Uptime:      ${status.uptimeSeconds}s`);
            if (status.startedAt) console.log(`  • Started:     ${status.startedAt}`);
            if (status.projects?.length) console.log(`  • Projects:    ${status.projects.join(', ')}`);
            if (status.logFile) console.log(`  • Logs:        ${status.logFile}`);
          } else {
            console.log(`${colors.yellow}○ Esedre daemon is STOPPED (port ${status.port})${colors.reset}`);
            if (status.logFile && fs.existsSync(status.logFile)) {
              console.log(`  • Recent Logs: ${status.logFile}`);
            }
          }
        }
        return;
      }

      case 'logs': {
        const port = flags['port'] ? parseInt(String(flags['port']), 10) : (discovered.config?.port || 5674);
        const lines = flags['lines'] ? parseInt(String(flags['lines']), 10) : 40;
        printDaemonLogs({ port, lines, workspaceRoot: discovered.workspaceRoot });
        return;
      }

      case 'serve': {
        const gatewayPort = flags['port'] ? parseInt(String(flags['port']), 10) : (discovered.config?.port || 5674);
        const cluster = startGatewayCluster({
          gatewayPort,
          uiPort: gatewayPort + 1,
          apiPort: gatewayPort + 2,
          storage,
          workspaceRoot: discovered.workspaceRoot,
        });

        console.log(`${colors.bold}${colors.green}✔ Esedre Server active on http://localhost:${gatewayPort}${colors.reset}`);
        console.log(`  • Web UI:      http://localhost:${gatewayPort}/app (internal: ${gatewayPort + 1})`);
        console.log(`  • REST API:    http://localhost:${gatewayPort}/api (internal: ${gatewayPort + 2})`);
        console.log(`  • Rewrite /:   http://localhost:${gatewayPort}/ -> http://localhost:${gatewayPort}/app/`);
        console.log(`  • Portfolio:   http://localhost:${gatewayPort}/app?project=all`);
        console.log(`  • Press Ctrl+C to stop.`);

        process.on('SIGINT', async () => {
          console.log(`\n${colors.dim}Shutting down Esedre cluster...${colors.reset}`);
          await cluster.close();
          process.exit(0);
        });
        return;
      }

      case 'daemon': {
        const sub = positionals[0] || 'status';
        const port = flags['port'] ? parseInt(String(flags['port']), 10) : (discovered.config?.port || 5674);
        const quiet = Boolean(flags['quiet'] || isJson);

        if (sub === 'start') {
          const state = await startDaemon({ port, quiet, workspaceRoot: discovered.workspaceRoot });
          if (isJson) console.log(JSON.stringify(state, null, 2));
          return;
        } else if (sub === 'stop') {
          const stopped = await stopDaemon({ port, quiet, workspaceRoot: discovered.workspaceRoot });
          if (isJson) console.log(JSON.stringify({ port, stopped }, null, 2));
          return;
        } else if (sub === 'status') {
          const status = await getDaemonStatus({ port, workspaceRoot: discovered.workspaceRoot });
          if (isJson) {
            console.log(JSON.stringify(status, null, 2));
          } else {
            if (status.running) {
              console.log(`${colors.bold}${colors.green}● Esedre daemon is RUNNING${colors.reset}`);
              console.log(`  • Port:        ${status.port}`);
              if (status.pid) console.log(`  • PID:         ${status.pid}`);
              if (status.uptimeSeconds !== undefined) console.log(`  • Uptime:      ${status.uptimeSeconds}s`);
              if (status.startedAt) console.log(`  • Started:     ${status.startedAt}`);
              if (status.projects?.length) console.log(`  • Projects:    ${status.projects.join(', ')}`);
              if (status.logFile) console.log(`  • Logs:        ${status.logFile}`);
            } else {
              console.log(`${colors.yellow}○ Esedre daemon is STOPPED (port ${status.port})${colors.reset}`);
              if (status.logFile && fs.existsSync(status.logFile)) {
                console.log(`  • Recent Logs: ${status.logFile}`);
              }
            }
          }
          return;
        } else if (sub === 'logs') {
          const logFile = path.resolve(discovered.workspaceRoot || process.cwd(), '.esedre', 'daemon.log');
          if (fs.existsSync(logFile)) {
            console.log(fs.readFileSync(logFile, 'utf-8'));
          } else {
            console.log(`${colors.dim}No daemon log file found at ${logFile}${colors.reset}`);
          }
          return;
        } else {
          console.error(`${colors.red}Unknown daemon subcommand: '${sub}'. Expected 'start', 'stop', 'status', or 'logs'.${colors.reset}`);
          process.exit(1);
        }
      }

      case 'projects': {
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
        const rawProject = flags['project'] as string;
        const project = rawProject === 'all' ? undefined : (rawProject || discovered.config?.projectCode || undefined);
        const status = (flags['status'] as TicketStatus) || undefined;
        const type = ((flags['type'] as TicketType) || (flags['category'] as TicketType)) || undefined;
        const category = type;
        const search = (flags['search'] as string) || undefined;

        const tickets = await storage.listTickets({ project, status, type, category, search });
        if (isJson) {
          console.log(JSON.stringify(tickets.map((t) => ({
            id: t.meta.id,
            title: t.meta.title,
            type: t.meta.type || t.meta.category,
            category: t.meta.type || t.meta.category,
            status: t.meta.status,
            complexity: t.meta.complexity,
            effort: t.meta.estimatedEffort,
            project: t.projectDescriptor?.code || t.meta.project || 'UNASSIGNED',
            sha1: t.sha1 || t.meta.sha1,
          })), null, 2));
        } else {
          console.log(formatTicketListTable(tickets));
          console.log(`\n${colors.dim}Total: ${tickets.length} tickets${colors.reset}`);
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
          console.log(`${colors.green}✔ Implementation plan saved for Ticket #${id}${colors.reset}`);
          return;
        }

        const plan = await storage.getPlan(id);
        if (!plan) {
          console.log(`${colors.dim}No implementation plan found for Ticket #${id}.${colors.reset}`);
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
        const title = flags['title'] as string;
        if (!title) {
          console.error(`${colors.red}Error: --title is required${colors.reset}`);
          process.exit(1);
        }

        const type = ((flags['type'] as string) || (flags['category'] as string) || 'Feature') as TicketType;
        const category = type;
        const projectCode = (flags['project'] as string) || discovered.config?.projectCode;
        if (!projectCode) {
          console.error(`${colors.red}Error: Project is required to create a ticket (--project <code> or configure projectCode in esedre.json).${colors.reset}`);
          process.exit(1);
        }
        const complexity = (flags['complexity'] as string) || 'Medium';
        const estimatedEffort = (flags['effort'] as string) || '2.0 – 4.0 hours';
        const summary = (flags['summary'] as string) || undefined;
        const submittedBy = (flags['author'] as string) || 'Developer';

        const val = validateProjectCode(projectCode);
        if (!val.valid) {
          console.error(`${colors.red}Error: ${val.error}${colors.reset}`);
          process.exit(1);
        }

        const created = await storage.createTicket({
          title,
          type,
          category,
          projectCode,
          complexity,
          estimatedEffort,
          summary,
          submittedBy,
        });

        if (isJson) {
          console.log(JSON.stringify(created, null, 2));
        } else {
          console.log(`${colors.green}✔ Created Ticket #${created.meta.id}: ${created.meta.title}${colors.reset} [${created.projectDescriptor?.code || created.meta.project || 'UNASSIGNED'}] (SHA-1: ${created.sha1?.slice(0, 8)})`);
        }
        return;
      }

      case 'update': {
        const idStr = positionals[0];
        if (!idStr) {
          console.error(`${colors.red}Error: Ticket ID is required (e.g. ese update 96 --status "Completed")${colors.reset}`);
          process.exit(1);
        }
        const id = parseInt(idStr, 10);
        if (isNaN(id)) {
          console.error(`${colors.red}Error: Invalid Ticket ID "${idStr}"${colors.reset}`);
          process.exit(1);
        }

        const status = flags['status'] as TicketStatus;
        const title = flags['title'] as string;
        const complexity = flags['complexity'] as string;
        const effort = flags['effort'] as string;
        const inDev = flags['in-dev'] !== undefined ? Boolean(flags['in-dev']) : undefined;
        const flag = flags['flag'] as string;
        const isForce = Boolean(flags['force']);
        const lastHash = isForce ? undefined : (flags['last-hash'] as string);

        const updates: any = {};
        const type = ((flags['type'] as TicketType) || (flags['category'] as TicketType)) || undefined;
        if (type) { updates.type = type; updates.category = type; }
        if (status) updates.status = status;
        if (title) updates.title = title;
        if (complexity) updates.complexity = complexity;
        if (effort) updates.estimatedEffort = effort;
        if (inDev !== undefined) updates.isActivePlanning = inDev;
        if (flag) updates.featureFlag = flag;

        const updated = await storage.updateTicket(id, updates, lastHash);
        if (isJson) {
          console.log(JSON.stringify(updated, null, 2));
        } else {
          console.log(`${colors.green}✔ Updated Ticket #${id}: ${updated.meta.title} (Status: ${updated.meta.status}, SHA-1: ${updated.sha1?.slice(0, 8)})${colors.reset}`);
        }
        return;
      }

      case 'comment': {
        const idStr = positionals[0];
        if (!idStr) {
          console.error(`${colors.red}Error: Ticket ID is required (e.g. ese comment 96 --text "...")`);
          process.exit(1);
        }
        const id = parseInt(idStr, 10);
        if (isNaN(id)) {
          console.error(`${colors.red}Error: Invalid Ticket ID "${idStr}"`);
          process.exit(1);
        }

        const text = flags['text'] as string;
        if (!text) {
          console.error(`${colors.red}Error: --text is required`);
          process.exit(1);
        }
        const author = (flags['author'] as string) || 'User';

        const comment = await storage.addComment(id, { author, text });
        if (isJson) {
          console.log(JSON.stringify(comment, null, 2));
        } else {
          console.log(`${colors.green}✔ Added comment to Ticket #${id} by ${comment.author}${colors.reset}`);
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
