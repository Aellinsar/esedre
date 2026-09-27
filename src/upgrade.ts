import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ensureGlobalEsedreStore } from './server/daemon.js';
import {
  EsedreConfig,
  migrateEsedreConfig,
  appendSnapshotToGitIgnore,
  DEFAULT_ESEDRE_PORT,
  resolvePorts,
} from './config.js';

import { CURRENT_ESEDRE_VERSION } from './types.js';
export { CURRENT_ESEDRE_VERSION };
export function computeNormalizedHash(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  return crypto.createHash('sha1').update(normalized, 'utf-8').digest('hex');
}

export type ContentStatus = 'LATEST' | 'HISTORIC_DEFAULT' | 'CUSTOMIZED' | 'MISSING';

export function classifyContent(
  currentContent: string | null | undefined,
  latestTemplate: string,
  historicHashes: string[]
): ContentStatus {
  if (!currentContent || currentContent.trim().length === 0) {
    return 'MISSING';
  }
  const currentHash = computeNormalizedHash(currentContent);
  const latestHash = computeNormalizedHash(latestTemplate);

  if (currentHash === latestHash) {
    return 'LATEST';
  }
  if (historicHashes.includes(currentHash)) {
    return 'HISTORIC_DEFAULT';
  }
  return 'CUSTOMIZED';
}

export const WRAPPER_CMD = `@echo off
REM Esedre Autonomous Ticketing & Project Planning Engine Wrapper (Windows CMD)
setlocal

where ese >nul 2>nul
if %ERRORLEVEL% equ 0 goto use_ese

where esedre >nul 2>nul
if %ERRORLEVEL% equ 0 goto use_esedre

if exist "%~dp0..\\..\\esedre\\dist\\esedre.mjs" goto use_sibling_dist
if exist "%~dp0..\\esedre\\dist\\esedre.mjs" goto use_local_dist
if exist "%~dp0..\\node_modules\\.bin\\ese.cmd" goto use_node_modules_ese
if exist "%~dp0..\\node_modules\\.bin\\esedre.cmd" goto use_node_modules_esedre

call npx --yes esedre %*
goto done

:use_ese
call ese %*
goto done

:use_esedre
call esedre %*
goto done

:use_sibling_dist
node "%~dp0..\\..\\esedre\\dist\\esedre.mjs" %*
goto done

:use_local_dist
node "%~dp0..\\esedre\\dist\\esedre.mjs" %*
goto done

:use_node_modules_ese
call "%~dp0..\\node_modules\\.bin\\ese.cmd" %*
goto done

:use_node_modules_esedre
call "%~dp0..\\node_modules\\.bin\\esedre.cmd" %*
goto done

:done
endlocal & exit /b %ERRORLEVEL%
`;

export const WRAPPER_PS1 = `# Esedre Autonomous Ticketing & Project Planning Engine Wrapper (PowerShell)
$ErrorActionPreference = "Stop"

# Ensure UTF-8 console output and pipeline encoding on Windows
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding  = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (Get-Command "ese" -ErrorAction SilentlyContinue) {
    & ese @args
    exit $LASTEXITCODE
}
if (Get-Command "esedre" -ErrorAction SilentlyContinue) {
    & esedre @args
    exit $LASTEXITCODE
}
$siblingEsedre = Join-Path $scriptDir "..\\..\\esedre\\dist\\esedre.mjs"
if (Test-Path $siblingEsedre) {
    & node $siblingEsedre @args
    exit $LASTEXITCODE
}
$distEsedre = Join-Path $scriptDir "..\\esedre\\dist\\esedre.mjs"
if (Test-Path $distEsedre) {
    & node $distEsedre @args
    exit $LASTEXITCODE
}
$localBin = Join-Path $scriptDir "..\\node_modules\\.bin\\ese.cmd"
if (Test-Path $localBin) {
    & $localBin @args
    exit $LASTEXITCODE
}
$localEsedreBin = Join-Path $scriptDir "..\\node_modules\\.bin\\esedre.cmd"
if (Test-Path $localEsedreBin) {
    & $localEsedreBin @args
    exit $LASTEXITCODE
}
& npx --yes esedre @args
exit $LASTEXITCODE
`;

export const WRAPPER_BASH = `#!/usr/bin/env bash
# Esedre Autonomous Ticketing & Project Planning Engine Wrapper (POSIX)
set -e
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

if command -v ese >/dev/null 2>&1; then
  exec ese "$@"
fi
if command -v esedre >/dev/null 2>&1; then
  exec esedre "$@"
fi
if [ -f "$DIR/../../esedre/dist/esedre.mjs" ]; then
  exec node "$DIR/../../esedre/dist/esedre.mjs" "$@"
fi
if [ -f "$DIR/../esedre/dist/esedre.mjs" ]; then
  exec node "$DIR/../esedre/dist/esedre.mjs" "$@"
fi
if [ -f "$DIR/../node_modules/.bin/ese" ]; then
  exec "$DIR/../node_modules/.bin/ese" "$@"
fi
if [ -f "$DIR/../node_modules/.bin/esedre" ]; then
  exec "$DIR/../node_modules/.bin/esedre" "$@"
fi
exec npx --yes esedre "$@"
`;

export const ESE_WRAPPER_CMD = `@echo off
REM Ese CLI short alias wrapper for Esedre (Windows CMD)
call "%~dp0esedre.cmd" %*
exit /b %ERRORLEVEL%
`;

export const ESE_WRAPPER_PS1 = `# Ese CLI short alias wrapper for Esedre (PowerShell)
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding  = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $scriptDir "esedre.ps1") @args
exit $LASTEXITCODE
`;

export const ESE_WRAPPER_BASH = `#!/usr/bin/env bash
# Ese CLI short alias wrapper for Esedre (POSIX)
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
exec "$DIR/esedre" "$@"
`;

export const HISTORIC_SKILL_HASHES: string[] = [
  '8611116c276fdfb598b965c716b251ce7c77c7f7',
  '05f129fb6e06a18df00215af105567abcbf0bc67',
  '5d330ecf8fc96f383946e0351adb60378afa70f0',
  '23716c9db561e52e5115dc364fe154d3a7bc1e23',
];

export const ESEDRE_SKILL_TEMPLATE = `---
name: esedre
description: Tooling and workflow reference for interacting with the Esedre developer ticketing and roadmap system. Use this skill whenever inspecting planned work, viewing ticket specs, updating implementation plans, or posting developer notes.
---

# Esedre Planning & Roadmap Workflow

Esedre is the developer ticketing and LLM coding partner coordination platform. The engine codebase resides in the standalone repository \`aellinsar/esedre\` (\`../esedre\`), and operates on decoupled ticket repositories (such as \`aellinsar/esedre-data\` configured in \`.esedre/esedre.json\`). Interact with tickets via in-repo shell wrappers in \`.esedre/\` (\`.esedre/ese\`), or the global \`ese\` CLI.

## 0. Authoritative Ingress Hierarchy & Zero-Latency Context (\`.esedre/snapshot.json\`)

All ticket discovery, inspection, and state management strictly follow this positive ingress hierarchy:

1. **Step 1 (Default for Read-Only Inspection) - Local Snapshot Projection**:
   Always read \`.esedre/snapshot.json\` in the workspace root first. It provides an immediate, zero-latency local projection containing all active and completed tickets, summaries, implementation plans, revision numbers, completion dates (\`completedAt\`), and staleness metrics (\`daysSinceUpdate\`).
2. **Step 2 (Dynamic Queries & State Mutations) - Esedre MCP Tools**:
   Use first-class MCP tools when active in the session (\`esedre_list_tickets\`, \`esedre_get_ticket\`, \`esedre_get_plan\`, \`esedre_save_plan\`, \`esedre_update_ticket\`, \`esedre_add_comment\`).
3. **Step 3 (Terminal & Script Fallback) - In-Repo CLI Wrapper**:
   Use \`.esedre/ese\` (\`.esedre/ese get\`, \`.esedre/ese plan\`, \`.esedre/ese update\`, \`.esedre/ese snapshot\`, \`.esedre/ese refresh\`).
4. **Storage Boundary**:
   Backing ticket hubs (such as \`esedre-data\`) represent data storage managed by the engine. All agent interactions with roadmap tickets flow through the snapshot projection, MCP tools, or CLI wrappers.

## 1. Model Context Protocol (MCP) Tools

When Esedre MCP is active in your agent session (\`.agents/mcp_config.json\`), use these tools directly:

| Tool | Purpose | Key Arguments |
|---|---|---|
| \`esedre_list_tickets\` | List roadmap tickets with filters | \`project\` (e.g. \`Profe\`, \`Esedre\`, \`Alce\`), \`status\`, \`type\`, \`search\` |
| \`esedre_get_ticket\` | Full specification, summary, comments, revision & sha1 | \`ticketId\` (numeric e.g. \`96\` or compound e.g. \`Profe-96\`) |
| \`esedre_get_plan\` | Active implementation plan markdown | \`ticketId\` (numeric or compound) |
| \`esedre_save_plan\` | Save implementation plan markdown with OCC | \`ticketId\`, \`planMarkdown\`, \`lastHash\` |
| \`esedre_create_ticket\` | Mint a new ticket with auto sequential ID | \`title\` (max 48 chars), \`type\`, \`project\`, \`effort\`, \`summary\`, \`detail\` |
| \`esedre_update_ticket\` | Update ticket attributes with OCC | \`ticketId\`, \`status\`, \`type\`, \`title\`, \`complexity\`, \`effort\`, \`inDevelopment\`, \`featureFlag\`, \`lastHash\` |
| \`esedre_add_comment\` | Append developer or agent comment | \`ticketId\`, \`text\`, \`author\` |

## 2. Core CLI Commands (Fallback via \`run_command\`)

Both \`esedre\` and \`ese\` work interchangeably:

### List Tickets
\`\`\`bash
.esedre/ese list [-p|--project <code|all>] [-s|--status <status>] [-t|--type <type>] [-q|--search <q>] [--json]
\`\`\`

### Read Ticket Details
\`\`\`bash
.esedre/ese get <ticketId> [--json]
\`\`\`

### Read or Update Implementation Plans
\`\`\`bash
.esedre/ese plan <ticketId>
.esedre/ese plan <ticketId> --file <planFilePath>
.esedre/ese plan <ticketId> --set "<markdownContent>" [--last-hash <hash>]
\`\`\`

### Create a Ticket
\`\`\`bash
.esedre/ese create --title "..." [-p|--project <code>] [-t|--type Feature] [--complexity Medium] [--effort "2.0 - 4.0 hours"] [--detail "<md>"] [--file <path>] [--json]
\`\`\`

### Update Ticket Status & Attributes
\`\`\`bash
.esedre/ese update <ticketId> --status "In Development"
.esedre/ese update <ticketId> --status "Completed"
.esedre/ese update <ticketId> --type Feature --complexity Medium --effort "2.0 - 4.0 hours"
\`\`\`

### Append Comments or Notes
\`\`\`bash
.esedre/ese comment <ticketId> "Verified implementation." --author "Agent"
.esedre/ese comment <ticketId> --text "Verified implementation." --author "Agent"
\`\`\`

### Regenerate Snapshot
\`\`\`bash
.esedre/ese snapshot
.esedre/ese refresh
\`\`\`

### Server Lifecycle & Daemon Management
\`\`\`bash
# Start background server daemon on port 5674 (default)
.esedre/ese start [--port 5674] [--quiet] [--json]

# Run foreground gateway server directly (Ctrl+C to stop)
.esedre/ese start -f [--port 5674]

# Check daemon health and diagnostics
.esedre/ese status [--port 5674] [--json]

# View recent daemon activity logs
.esedre/ese logs [--port 5674] [--lines <n>]

# Stop background server daemon
.esedre/ese stop [--port 5674] [--quiet] [--json]
\`\`\`

## 3. Embedded View & Theme Token Contract

When embedding \`<PlannedWorkView />\` inside a host app (e.g. \`PlannedWorkModal.tsx\`):

### Zero-Effort Drop-in (Default Fallback)
\`PlannedWorkView\` incorporates an internal CSS fallback bridge (\`.esedre-host-bridge\` / \`.esedre-theme-root\` with \`ESEDRE_THEME_FALLBACK_CSS\`).
If an embedding application supplies **zero CSS variables**, the component automatically falls back to clean, high-contrast light or dark themes matching the user's OS preference (\`prefers-color-scheme: dark\`) or host \`.dark\` / \`[data-theme="night"]\` classes.

### Theme Token Customization
If the host application declares any or all of the 12 core design tokens on \`:root\` or an ancestor container, \`PlannedWorkView\` automatically adopts them:
- **Surface**: \`--bg-surface\`, \`--bg-surface-elevated\`, \`--bg-input\`
- **Borders**: \`--border-subtle\`, \`--border-strong\`, \`--border-accent\`
- **Text**: \`--text-primary\`, \`--text-secondary\`, \`--text-muted\`
- **Accent**: \`--accent-primary\`, \`--accent-bg-subtle\`, \`--accent-border-subtle\`

## 4. Safety & Invariants
- **Always use \`--json\`** for CLI programmatic inspection.
- **Optimistic Concurrency**: Writes support \`--last-hash <hash>\` to prevent overwriting concurrent updates.
- **Universal Type Naming**: Always use \`type\` (\`Feature\`, \`Platform\`, \`Tools\`, \`Idea\`, \`Bug\`). The legacy name \`category\` is deprecated.
- **Compound IDs for Multi-Project Portfolios**: In \`project=all\`, ticket IDs are \`\${projectCode}-\${id}\` (e.g. \`Profe-1\`, \`Esedre-1\`). DOM anchors strictly use \`feature-card-\${projectCode}-\${id}\`.
- **Never delete tickets** directly via filesystem.
- **Workspace Scoping**: An LLM coding partner operates strictly within the authorized project scope declared in the local repository configuration. Central repository linking and system-level configuration are managed separately; focus roadmap work, implementation plans, and verification notes on this project.
- **Secret Developer Hash Route (\`#/planner\`, \`#/plan\`, \`#planner\`, \`#plan\`)**:
  - In web applications embedding Esedre (such as Professor Arwam), \`#/planner\` and \`#/plan\` serve as direct secret developer entry routes.
  - **SEO Invariant**: These developer routes are private and MUST NEVER be exposed in \`sitemap.xml\`, \`robots.txt\`, \`llms.txt\`, or public navigation links.
  - The URL hash is preserved across hard page refreshes (F5) without falling back to \`#/chat\` or other views.
`;

export type ViteProxyStatus = 'CONFIGURED' | 'ALREADY_CONFIGURED' | 'SKIPPED' | 'MANUAL_REQUIRED' | 'NOT_APPLICABLE';

export interface ConfigureOptions {
  projectCode?: string;
  projectName?: string;
  allowedProjects?: string[];
  dataDir?: string | string[];
  port?: number;
  setupMcp?: boolean;
  setupProxy?: boolean;
  force?: boolean;
}

export interface ConfigureResult {
  esedreJsonCreatedOrUpdated: boolean;
  projectRegistered?: boolean;
  projectName?: string;
  wrappersPlanted: boolean;
  gitignoreUpdated: boolean;
  mcpConfigured: boolean;
  skillConfigured: boolean;
  skillStatus: ContentStatus;
  viteProxyStatus: ViteProxyStatus;
  viteConfigFile?: string;
  recommendedProxySnippet?: string;
  globalStoreStatus: 'ready' | 'warning';
  globalStorePath: string;
  globalStoreError?: string;
}

export function plantWrappers(targetDir: string): void {
  const esedreDir = path.join(targetDir, '.esedre');
  fs.mkdirSync(esedreDir, { recursive: true });

  const wrappers = [
    { name: 'esedre.cmd', content: WRAPPER_CMD, exec: false },
    { name: 'esedre.ps1', content: WRAPPER_PS1, exec: false },
    { name: 'esedre', content: WRAPPER_BASH, exec: true },
    { name: 'ese.cmd', content: ESE_WRAPPER_CMD, exec: false },
    { name: 'ese.ps1', content: ESE_WRAPPER_PS1, exec: false },
    { name: 'ese', content: ESE_WRAPPER_BASH, exec: true },
  ];

  for (const w of wrappers) {
    const fullPath = path.join(esedreDir, w.name);
    fs.writeFileSync(fullPath, w.content, 'utf-8');
    if (w.exec) {
      try {
        fs.chmodSync(fullPath, 0o755);
      } catch {}
    }
  }
}

export function setupMcpConfig(targetDir: string): boolean {
  const agentsDir = path.join(targetDir, '.agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  const mcpConfigPath = path.join(agentsDir, 'mcp_config.json');

  let configObj: any = { mcpServers: {} };
  if (fs.existsSync(mcpConfigPath)) {
    try {
      configObj = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
      if (!configObj.mcpServers) configObj.mcpServers = {};
    } catch {}
  }

  if (process.platform === 'win32') {
    configObj.mcpServers.esedre = {
      command: 'cmd.exe',
      args: ['/c', '.esedre\\esedre.cmd', 'mcp'],
    };
  } else {
    configObj.mcpServers.esedre = {
      command: '.esedre/esedre',
      args: ['mcp'],
    };
  }

  try {
    fs.writeFileSync(mcpConfigPath, JSON.stringify(configObj, null, 2) + '\n', 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export function setupSkill(targetDir: string, options: { force?: boolean } = {}): { status: ContentStatus; updated: boolean } {
  const skillDir = path.join(targetDir, '.agents', 'skills', 'esedre');
  fs.mkdirSync(skillDir, { recursive: true });
  const skillFile = path.join(skillDir, 'SKILL.md');

  if (!fs.existsSync(skillFile)) {
    fs.writeFileSync(skillFile, ESEDRE_SKILL_TEMPLATE, 'utf-8');
    return { status: 'MISSING', updated: true };
  }

  const currentContent = fs.readFileSync(skillFile, 'utf-8');
  const status = classifyContent(currentContent, ESEDRE_SKILL_TEMPLATE, HISTORIC_SKILL_HASHES);

  if (status === 'LATEST' && !options.force) {
    return { status, updated: false };
  }

  const hasBannedOrDeprecatedTerms =
    currentContent.includes('companion agent') ||
    currentContent.includes('companion LLM') ||
    currentContent.includes('tools/esedre.mjs');

  if (options.force || status === 'HISTORIC_DEFAULT' || status === 'MISSING' || hasBannedOrDeprecatedTerms) {
    fs.writeFileSync(skillFile, ESEDRE_SKILL_TEMPLATE, 'utf-8');
    return { status: 'LATEST', updated: true };
  }

  return { status, updated: false };
}

export const VITE_CONFIG_FILES = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.mts',
  'vite.config.cjs',
];

export function findViteConfig(targetDir: string): string | null {
  for (const name of VITE_CONFIG_FILES) {
    const fullPath = path.join(targetDir, name);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

export function getRecommendedViteProxySnippet(port: number = DEFAULT_ESEDRE_PORT): string {
  return `proxy: {
  '/esedre': {
    target: 'http://127.0.0.1:${port}',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\\/esedre/, ''),
  },
}`;
}

export function detectLineEnding(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

export function injectViteProxy(content: string, port: number = DEFAULT_ESEDRE_PORT): string | null {
  if (content.includes("'/esedre'") || content.includes('"/esedre"')) {
    return content;
  }

  const eol = detectLineEnding(content);

  // Case 1: Inside existing proxy: { ... }
  const proxyMatch = content.match(/(proxy\s*:\s*\{)/);
  if (proxyMatch && proxyMatch.index !== undefined) {
    const insertIdx = proxyMatch.index + proxyMatch[0].length;
    const snippet = `${eol}      '/esedre': {${eol}        target: 'http://127.0.0.1:${port}',${eol}        changeOrigin: true,${eol}        rewrite: (path) => path.replace(/^\\/esedre/, ''),${eol}      },`;
    return content.slice(0, insertIdx) + snippet + content.slice(insertIdx);
  }

  // Case 2: Inside existing server: { ... }
  const serverMatch = content.match(/(server\s*:\s*\{)/);
  if (serverMatch && serverMatch.index !== undefined) {
    const insertIdx = serverMatch.index + serverMatch[0].length;
    const snippet = `${eol}    proxy: {${eol}      '/esedre': {${eol}        target: 'http://127.0.0.1:${port}',${eol}        changeOrigin: true,${eol}        rewrite: (path) => path.replace(/^\\/esedre/, ''),${eol}      },${eol}    },`;
    return content.slice(0, insertIdx) + snippet + content.slice(insertIdx);
  }

  // Case 3: Inside returned config object (return { ... })
  const returnMatch = content.match(/(return\s*\{)/);
  if (returnMatch && returnMatch.index !== undefined) {
    const insertIdx = returnMatch.index + returnMatch[0].length;
    const snippet = `${eol}    server: {${eol}      proxy: {${eol}        '/esedre': {${eol}          target: 'http://127.0.0.1:${port}',${eol}          changeOrigin: true,${eol}          rewrite: (path) => path.replace(/^\\/esedre/, ''),${eol}        },${eol}      },${eol}    },`;
    return content.slice(0, insertIdx) + snippet + content.slice(insertIdx);
  }

  // Case 4: Inside defineConfig({ ... })
  const defineMatch = content.match(/(defineConfig\s*\(\s*\{)/);
  if (defineMatch && defineMatch.index !== undefined) {
    const insertIdx = defineMatch.index + defineMatch[0].length;
    const snippet = `${eol}  server: {${eol}    proxy: {${eol}      '/esedre': {${eol}        target: 'http://127.0.0.1:${port}',${eol}        changeOrigin: true,${eol}        rewrite: (path) => path.replace(/^\\/esedre/, ''),${eol}      },${eol}    },${eol}  },`;
    return content.slice(0, insertIdx) + snippet + content.slice(insertIdx);
  }

  // Case 5: Inside export default { ... }
  const exportMatch = content.match(/(export\s+default\s*\{)/);
  if (exportMatch && exportMatch.index !== undefined) {
    const insertIdx = exportMatch.index + exportMatch[0].length;
    const snippet = `${eol}  server: {${eol}    proxy: {${eol}      '/esedre': {${eol}        target: 'http://127.0.0.1:${port}',${eol}        changeOrigin: true,${eol}        rewrite: (path) => path.replace(/^\\/esedre/, ''),${eol}      },${eol}    },${eol}  },`;
    return content.slice(0, insertIdx) + snippet + content.slice(insertIdx);
  }

  return null;
}

export function configureViteProxy(
  targetDir: string,
  port: number = DEFAULT_ESEDRE_PORT,
  setupProxy?: boolean
): {
  status: ViteProxyStatus;
  configFile?: string;
  recommendedProxySnippet?: string;
} {
  const configPath = findViteConfig(targetDir);
  const snippet = getRecommendedViteProxySnippet(port);

  if (!configPath) {
    return {
      status: 'NOT_APPLICABLE',
      recommendedProxySnippet: snippet,
    };
  }

  const relativeName = path.basename(configPath);
  let content = '';
  try {
    content = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return {
      status: 'MANUAL_REQUIRED',
      configFile: relativeName,
      recommendedProxySnippet: snippet,
    };
  }

  if (content.includes("'/esedre'") || content.includes('"/esedre"') ) {
    return {
      status: 'ALREADY_CONFIGURED',
      configFile: relativeName,
      recommendedProxySnippet: snippet,
    };
  }

  if (setupProxy !== true) {
    return {
      status: 'SKIPPED',
      configFile: relativeName,
      recommendedProxySnippet: snippet,
    };
  }

  const injected = injectViteProxy(content, port);
  if (!injected) {
    return {
      status: 'MANUAL_REQUIRED',
      configFile: relativeName,
      recommendedProxySnippet: snippet,
    };
  }

  try {
    fs.writeFileSync(configPath, injected, 'utf-8');
    return {
      status: 'CONFIGURED',
      configFile: relativeName,
      recommendedProxySnippet: snippet,
    };
  } catch {
    return {
      status: 'MANUAL_REQUIRED',
      configFile: relativeName,
      recommendedProxySnippet: snippet,
    };
  }
}

export function configureWorkspace(targetDir: string, options: ConfigureOptions = {}): ConfigureResult {
  const esedreDir = path.join(targetDir, '.esedre');
  if (!fs.existsSync(esedreDir)) {
    fs.mkdirSync(esedreDir, { recursive: true });
  }

  // 1. .esedre/esedre.json
  const esedreJsonPath = path.join(esedreDir, 'esedre.json');
    
  let existingRaw: any = null;
  if (fs.existsSync(esedreJsonPath)) {
    try {
      existingRaw = JSON.parse(fs.readFileSync(esedreJsonPath, 'utf-8'));
    } catch {}
  }

  let config: EsedreConfig;
  let projectCode = options.projectCode || existingRaw?.projectCode;
  if (existingRaw?.projectCode && options.projectCode && existingRaw.projectCode.toLowerCase() === options.projectCode.toLowerCase()) {
    projectCode = existingRaw.projectCode;
  }
  const projectName = options.projectName || existingRaw?.projectName || (projectCode ? projectCode : undefined);
  const dataDir = options.dataDir !== undefined ? options.dataDir : existingRaw?.dataDir;

  if (existingRaw) {
    config = migrateEsedreConfig(existingRaw, CURRENT_ESEDRE_VERSION);
    if (projectCode) config.projectCode = projectCode;
    if (projectName) config.projectName = projectName;
    if (dataDir) config.dataDir = dataDir;
    if (options.allowedProjects) {
      config.allowedProjects = options.allowedProjects;
    } else if (projectCode) {
      if (!config.allowedProjects) {
        config.allowedProjects = [projectCode];
      } else if (!config.allowedProjects.some((p) => p.toUpperCase() === projectCode.toUpperCase())) {
        config.allowedProjects.push(projectCode);
      }
    }
    if (options.port) config.port = options.port;
  } else {
    config = {
      version: CURRENT_ESEDRE_VERSION,
      projectCode: projectCode || undefined,
      projectName: projectName || undefined,
      allowedProjects: options.allowedProjects || (projectCode ? [projectCode] : undefined),
      dataDir: dataDir || undefined,
      port: options.port || undefined,
    };
  }

  fs.writeFileSync(esedreJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  // Ensure in-repo tickets directory and project descriptor if projectCode is present and no hub exists
  let projectRegistered = false;
  if (projectCode) {
    const hasExistingTicketsDir =
      fs.existsSync(path.join(targetDir, 'tickets')) ||
      fs.existsSync(path.join(targetDir, 'src', 'data', 'planning', 'tickets'));

    const ticketsDir = path.join(esedreDir, 'tickets');
    if (!hasExistingTicketsDir && !fs.existsSync(ticketsDir)) {
      fs.mkdirSync(ticketsDir, { recursive: true });
    }
    const inRepoPJson = path.join(esedreDir, 'project.json');
    if (!fs.existsSync(inRepoPJson)) {
      const projDesc = {
        id: 1,
        code: projectCode.toUpperCase(),
        name: projectName || projectCode.toUpperCase(),
        description: `${projectName || projectCode.toUpperCase()} project`,
        colors: {
          badge: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
          dot: 'bg-cyan-400',
          border: 'border-cyan-500/40',
        },
      };
      fs.writeFileSync(inRepoPJson, JSON.stringify(projDesc, null, 2) + '\n', 'utf-8');
      projectRegistered = true;
    } else if (projectName) {
      try {
        const existing = JSON.parse(fs.readFileSync(inRepoPJson, 'utf-8'));
        if (existing.name !== projectName) {
          existing.name = projectName;
          fs.writeFileSync(inRepoPJson, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
        }
      } catch {}
    }
  }

  // 2. Wrappers (.esedre/esedre.* and .esedre/ese.*)
  plantWrappers(targetDir);

  // 3. Gitignore check & update (.esedre/snapshot.json)
  const gitignoreUpdated = appendSnapshotToGitIgnore(targetDir);

  // 4. MCP setup
  let mcpConfigured = false;
  if (options.setupMcp !== false) {
    mcpConfigured = setupMcpConfig(targetDir);
  }

  // 5. Skill setup (.agents/skills/esedre/SKILL.md)
  const skillRes = setupSkill(targetDir, { force: options.force });

  // 6. Vite proxy check & setup
  const targetPort = resolvePorts(config).gateway;
  const proxyRes = configureViteProxy(targetDir, targetPort, options.setupProxy);

  // 7. Global store check & pre-creation (resilient, never crashes configure)
  const globalStoreRes = ensureGlobalEsedreStore();
  if (!globalStoreRes.ok) {
    console.warn(`\x1b[33m⚠️ Warning: Could not initialize global store at ${globalStoreRes.path}: ${globalStoreRes.error}\x1b[0m`);
  }

  return {
    esedreJsonCreatedOrUpdated: true,
    projectRegistered,
    projectName: config.projectName || config.projectCode,
    wrappersPlanted: true,
    gitignoreUpdated,
    mcpConfigured,
    skillConfigured: skillRes.updated,
    skillStatus: skillRes.status,
    viteProxyStatus: proxyRes.status,
    viteConfigFile: proxyRes.configFile,
    recommendedProxySnippet: proxyRes.recommendedProxySnippet,
    globalStoreStatus: globalStoreRes.ok ? 'ready' : 'warning',
    globalStorePath: globalStoreRes.path,
    globalStoreError: globalStoreRes.error,
  };
}

export const initWorkspace = configureWorkspace;

export const ESEDRE_HUB_AGENTS_TEMPLATE = `# Agent Guidelines: esedre-data

## 1. Role & Storage Boundary
- **Backing Storage Repository**: \`esedre-data\` is a dedicated, decoupled data hub storing raw tickets, metadata manifests, and implementation plans managed by the Esedre engine.
- **Authorized Ingress Channels**: Ticket discovery, read-only inspection, status updates, and plan authoring strictly ingress through the Esedre application layer in consuming project workspaces:
  1. **Local Workspace Snapshot**: Check the consuming workspace's \`.esedre/snapshot.json\` first for instant, zero-latency read access to ticket summaries, plans, and statuses.
  2. **Esedre MCP Tools**: Use \`esedre_get_ticket\`, \`esedre_list_tickets\`, \`esedre_get_plan\`, \`esedre_save_plan\`, and \`esedre_update_ticket\`.
  3. **Esedre CLI**: Execute \`.esedre/ese get <id>\`, \`.esedre/ese list\`, or \`.esedre/ese plan\` from within the relevant project workspace.

## 2. Ingress Redirection Protocol
When inspecting or managing tickets for any project (such as \`Profe\`, \`Esedre\`, or \`Alce\`), navigate to that project's workspace and utilize its local \`.esedre/snapshot.json\`, Esedre MCP tools, or \`.esedre/ese\` CLI wrapper.
`;

export interface InitHubResult {
  projectsJsonCreated: boolean;
  projectsDirCreated: boolean;
  agentsMdCreated: boolean;
  hubDir: string;
}

export function initHub(targetDir: string): InitHubResult {
  const resolved = path.resolve(targetDir);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }

  const projectsDir = path.join(resolved, 'projects');
  let projectsDirCreated = false;
  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
    projectsDirCreated = true;
  }

  const projectsJsonPath = path.join(resolved, 'projects.json');
  let projectsJsonCreated = false;
  if (!fs.existsSync(projectsJsonPath)) {
    fs.writeFileSync(projectsJsonPath, '[]\n', 'utf-8');
    projectsJsonCreated = true;
  }

  const agentsMdPath = path.join(resolved, 'AGENTS.md');
  let agentsMdCreated = false;
  if (!fs.existsSync(agentsMdPath)) {
    fs.writeFileSync(agentsMdPath, ESEDRE_HUB_AGENTS_TEMPLATE, 'utf-8');
    agentsMdCreated = true;
  }

  return {
    projectsJsonCreated,
    projectsDirCreated,
    agentsMdCreated,
    hubDir: resolved.replace(/\\/g, '/'),
  };
}

