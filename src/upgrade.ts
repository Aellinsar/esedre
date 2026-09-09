import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ensureGlobalEsedreStore } from './server/daemon.js';
import {
  EsedreConfig,
  migrateEsedreConfig,
  appendSnapshotToGitIgnore,
  DEFAULT_ESEDRE_PORT,
} from './config.js';

export const CURRENT_ESEDRE_VERSION = '0.1.0';
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
if %ERRORLEVEL% equ 0 (
  ese %*
  goto :done
)
where esedre >nul 2>nul
if %ERRORLEVEL% equ 0 (
  esedre %*
  goto :done
)
if exist "%~dp0..\\..\\esedre\\dist\\esedre.mjs" (
  node "%~dp0..\\..\\esedre\\dist\\esedre.mjs" %*
  goto :done
)
if exist "%~dp0..\\esedre\\dist\\esedre.mjs" (
  node "%~dp0..\\esedre\\dist\\esedre.mjs" %*
  goto :done
)
if exist "%~dp0..\\node_modules\\.bin\\ese.cmd" (
  call "%~dp0..\\node_modules\\.bin\\ese.cmd" %*
  goto :done
)
if exist "%~dp0..\\node_modules\\.bin\\esedre.cmd" (
  call "%~dp0..\\node_modules\\.bin\\esedre.cmd" %*
  goto :done
)
npx --yes esedre %*

:done
endlocal
exit /b %ERRORLEVEL%
`;

export const WRAPPER_PS1 = `# Esedre Autonomous Ticketing & Project Planning Engine Wrapper (PowerShell)
$ErrorActionPreference = "Stop"
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
`;

export const ESE_WRAPPER_PS1 = `# Ese CLI short alias wrapper for Esedre (PowerShell)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $scriptDir "esedre.ps1") @args
exit $LASTEXITCODE
`;

export const ESE_WRAPPER_BASH = `#!/usr/bin/env bash
# Ese CLI short alias wrapper for Esedre (POSIX)
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
exec "$DIR/esedre" "$@"
`;

export const ESEDRE_SKILL_TEMPLATE = "---\nname: esedre\ndescription: Tooling and workflow reference for interacting with the Esedre developer ticketing and roadmap system. Use this skill whenever inspecting planned work, viewing ticket specs, updating implementation plans, or posting developer notes.\n---\n\n# Esedre Planning & Roadmap Workflow\n\nEsedre is the developer ticketing and companion agent coordination platform. The engine codebase resides in the standalone repository `aellinsar/esedre` (`../esedre`), and operates on decoupled ticket repositories (such as `aellinsar/esedre-data` configured in `.esedre/esedre.json`). In `ProfessorArwamSleepCenter`, interact with tickets via the compiled bridge artifact `tools/esedre.mjs` (`node tools/esedre.mjs <command>`), in-repo shell wrappers in `.esedre/` (`.esedre/ese`), or the global `ese` CLI.\n\n## 0. Instant Zero-Latency Context (`.esedre/snapshot.json`)\n\nBefore querying tickets over the network or CLI, check `.esedre/snapshot.json` in the workspace root. It provides a local read-only projection containing all active and completed tickets, summaries, implementation plans, revision numbers, completion dates (`completedAt`), and staleness metrics (`daysSinceUpdate`).\n\n## 1. Model Context Protocol (MCP) Tools\n\nWhen Esedre MCP is active in your agent session (`.agents/mcp_config.json`), use these tools directly:\n\n| Tool | Purpose | Key Arguments |\n|---|---|---|\n| `esedre_list_tickets` | List roadmap tickets with filters | `project` (e.g. `Profe`, `Esedre`, `Alce`), `status`, `type`, `search` |\n| `esedre_get_ticket` | Full specification, summary, comments, revision & sha1 | `ticketId` (numeric or compound e.g. `Profe-35`) |\n| `esedre_get_plan` | Active implementation plan markdown | `ticketId` (numeric or compound) |\n| `esedre_save_plan` | Save implementation plan markdown with OCC | `ticketId`, `planMarkdown`, `lastHash` |\n| `esedre_create_ticket` | Mint a new ticket with auto sequential ID | `title` (max 48 chars), `type`, `project`, `effort`, `summary` |\n| `esedre_update_ticket` | Update ticket attributes with OCC | `ticketId`, `status`, `title`, `inDevelopment`, `featureFlag`, `lastHash` |\n\n## 2. Core CLI Commands (Fallback via `run_command`)\n\nBoth `esedre` and `ese` work interchangeably:\n\n### List Tickets\n```bash\n.esedre/ese list [-p|--project <code|all>] [-s|--status <status>] [-t|--type <type>] [-q|--search <q>] [--json]\n```\n\n### Read Ticket Details\n```bash\n.esedre/ese get <ticketId> [--json]\n```\n\n### Read or Update Implementation Plans\n```bash\n.esedre/ese plan <ticketId>\n.esedre/ese plan <ticketId> --file <planFilePath>\n.esedre/ese plan <ticketId> --set \"<markdownContent>\" [--last-hash <hash>]\n```\n\n### Create a Ticket\n```bash\n.esedre/ese create --title \"...\" [-p|--project Profe] [-t|--type Feature] [--complexity Medium] [--effort \"2.0 – 4.0 hours\"] [--json]\n```\n\n### Update Ticket Status\n```bash\n.esedre/ese update <ticketId> --status \"In Development\"\n.esedre/ese update <ticketId> --status \"Completed\"\n```\n\n### Append Comments or Notes\n```bash\n.esedre/ese comment <ticketId> --text \"Verified implementation.\" --author \"Antigravity\"\n```\n\n### Regenerate Snapshot\n```bash\n.esedre/ese snapshot\n```\n\n### Background Daemon Management\n```bash\n# Start background daemon on port 5674 (idempotent)\n.esedre/ese daemon start [--port 5674] [--quiet] [--json]\n\n# Check daemon health and diagnostics\n.esedre/ese daemon status [--port 5674] [--json]\n\n# View recent daemon activity logs\n.esedre/ese daemon logs\n\n# Stop background daemon\n.esedre/ese daemon stop [--port 5674] [--quiet] [--json]\n```\n\n### Foreground Gateway Server\n```bash\n.esedre/ese serve [--port 5674]\n```\n- Starts the unified gateway on port 5674, routing `/app` to Esedre UI (port 5675) and `/api` to Esedre REST API (port 5676).\n- Transparently rewrites `/` to `/app/`.\n\n### Workspace Configuration & Vite Proxy Setup\n```bash\n.esedre/ese configure [--project <code>] [--port <n>] [--proxy] [--no-proxy] [-y]\n```\n- Automatically detects `vite.config.ts`/`vite.config.js`. In interactive mode or with `--proxy`, configures a reverse proxy for `/esedre` targeting port 5674 (`http://127.0.0.1:5674`).\n- If Vite is absent or declined, displays the recommended reverse proxy block for embedding the planner UI in the host app.\n\n## 3. Embedded View & Theme Token Contract\n\nWhen embedding `<PlannedWorkView />` inside a host app (e.g. `PlannedWorkModal.tsx`):\n\n### Zero-Effort Drop-in (Default Fallback)\n`PlannedWorkView` incorporates an internal CSS fallback bridge (`.esedre-host-bridge` / `.esedre-theme-root` with `ESEDRE_THEME_FALLBACK_CSS`).\nIf an embedding application supplies **zero CSS variables**, the component automatically falls back to clean, high-contrast light or dark themes matching the user's OS preference (`prefers-color-scheme: dark`) or host `.dark` / `[data-theme=\"night\"]` classes.\n\n### Theme Token Customization\nIf the host application declares any or all of the 12 core design tokens on `:root` or an ancestor container, `PlannedWorkView` automatically adopts them:\n- **Surface**: `--bg-surface`, `--bg-surface-elevated`, `--bg-input`\n- **Borders**: `--border-subtle`, `--border-strong`, `--border-accent`\n- **Text**: `--text-primary`, `--text-secondary`, `--text-muted`\n- **Accent**: `--accent-primary`, `--accent-bg-subtle`, `--accent-border-subtle`\n\n## 4. Safety & Invariants\n- **Always use `--json`** for CLI programmatic inspection.\n- **Optimistic Concurrency**: Writes support `--last-hash <hash>` to prevent overwriting concurrent updates.\n- **Universal Type Naming**: Always use `type` (`Feature`, `Platform`, `Tools`, `Idea`, `Bug`). The legacy name `category` is deprecated.\n- **Compound IDs for Multi-Project Portfolios**: In `project=all`, ticket IDs are `${projectCode}-${id}` (e.g. `Profe-1`, `Esedre-1`). DOM anchors strictly use `feature-card-${projectCode}-${id}`.\n- **Never delete tickets** directly via filesystem.\n- **Security Firewall**: A repository only accesses projects declared in its `.esedre/esedre.json` (`allowedProjects`). Unauthorized cross-project access is strictly blocked.\n- **Secret Developer Hash Route (`#/planner`, `#/plan`, `#planner`, `#plan`)**:\n  - In web applications embedding Esedre (such as Professor Arwam), `#/planner` and `#/plan` serve as direct secret developer entry routes.\n  - **SEO Invariant**: These developer routes are private and MUST NEVER be exposed in `sitemap.xml`, `robots.txt`, `llms.txt`, or public navigation links.\n  - The URL hash is preserved across hard page refreshes (F5) without falling back to `#/chat` or other views.\n";

export type ViteProxyStatus = 'CONFIGURED' | 'ALREADY_CONFIGURED' | 'SKIPPED' | 'MANUAL_REQUIRED' | 'NOT_APPLICABLE';

export interface ConfigureOptions {
  projectCode?: string;
  allowedProjects?: string[];
  port?: number;
  setupMcp?: boolean;
  setupProxy?: boolean;
}

export interface ConfigureResult {
  esedreJsonCreatedOrUpdated: boolean;
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

export function setupSkill(targetDir: string): { status: ContentStatus; updated: boolean } {
  const skillDir = path.join(targetDir, '.agents', 'skills', 'esedre');
  fs.mkdirSync(skillDir, { recursive: true });
  const skillFile = path.join(skillDir, 'SKILL.md');

  if (!fs.existsSync(skillFile)) {
    fs.writeFileSync(skillFile, ESEDRE_SKILL_TEMPLATE, 'utf-8');
    return { status: 'MISSING', updated: true };
  }

  const currentContent = fs.readFileSync(skillFile, 'utf-8');
  const status = classifyContent(currentContent, ESEDRE_SKILL_TEMPLATE, []);

  if (status === 'LATEST') {
    return { status, updated: false };
  }

  if (status === 'HISTORIC_DEFAULT' || status === 'MISSING') {
    fs.writeFileSync(skillFile, ESEDRE_SKILL_TEMPLATE, 'utf-8');
    return { status, updated: true };
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
  if (existingRaw) {
    config = migrateEsedreConfig(existingRaw, CURRENT_ESEDRE_VERSION);
    if (options.projectCode) config.projectCode = options.projectCode;
    if (options.allowedProjects) config.allowedProjects = options.allowedProjects;
    if (options.port) config.port = options.port;
  } else {
    config = {
      version: CURRENT_ESEDRE_VERSION,
      projectCode: options.projectCode || undefined,
      allowedProjects: options.allowedProjects || (options.projectCode ? [options.projectCode] : undefined),
      port: options.port || DEFAULT_ESEDRE_PORT,
    };
  }

  fs.writeFileSync(esedreJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

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
  const skillRes = setupSkill(targetDir);

  // 6. Vite proxy check & setup
  const proxyRes = configureViteProxy(targetDir, config.port || DEFAULT_ESEDRE_PORT, options.setupProxy);

  // 7. Global store check & pre-creation (resilient, never crashes configure)
  const globalStoreRes = ensureGlobalEsedreStore();
  if (!globalStoreRes.ok) {
    console.warn(`\x1b[33m⚠️ Warning: Could not initialize global store at ${globalStoreRes.path}: ${globalStoreRes.error}\x1b[0m`);
  }

  return {
    esedreJsonCreatedOrUpdated: true,
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
