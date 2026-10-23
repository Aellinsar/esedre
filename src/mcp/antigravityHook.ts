import fs from 'node:fs';
import path from 'node:path';
import {
  EsedreConfig,
  getGlobalConfigDir,
  isProjectAuthorized,
} from '../config.js';

export interface McpActiveWorkspaceContext {
  conversationId?: string;
  workspaceRoot: string;
  workspacePaths: string[];
  projectCode?: string;
  allowedProjects?: string[];
  updatedAt: string;
}

export interface PreToolUseHookInput {
  conversationId?: string;
  workspacePaths?: string[];
  hookEventName?: string;
  toolCall?: {
    name?: string;
    args?: Record<string, any>;
  };
}

export interface PreToolUseHookOutput {
  decision: 'allow' | 'deny';
  reason?: string;
}

export function getActiveMcpContextPath(globalDir = getGlobalConfigDir()): string {
  return path.join(globalDir, 'mcp-active-context.json');
}

export function writeActiveMcpContext(
  ctx: McpActiveWorkspaceContext,
  globalDir = getGlobalConfigDir()
): void {
  if (!fs.existsSync(globalDir)) {
    fs.mkdirSync(globalDir, { recursive: true });
  }
  const targetPath = getActiveMcpContextPath(globalDir);
  const tempPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const serialized = JSON.stringify(ctx, null, 2) + '\n';
  try {
    fs.writeFileSync(tempPath, serialized, 'utf-8');
    fs.renameSync(tempPath, targetPath);
  } catch {
    fs.writeFileSync(targetPath, serialized, 'utf-8');
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {}
    }
  }
}

export function readActiveMcpContext(
  maxAgeMs = 15 * 60 * 1000,
  globalDir = getGlobalConfigDir()
): McpActiveWorkspaceContext | null {
  const targetPath = getActiveMcpContextPath(globalDir);
  if (!fs.existsSync(targetPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(targetPath, 'utf-8');
    const parsed = JSON.parse(raw) as McpActiveWorkspaceContext;
    if (!parsed || typeof parsed !== 'object' || !parsed.workspaceRoot) {
      return null;
    }
    if (maxAgeMs > 0 && parsed.updatedAt) {
      const updatedTime = new Date(parsed.updatedAt).getTime();
      if (!Number.isNaN(updatedTime) && Date.now() - updatedTime > maxAgeMs) {
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

function findLocalWorkspaceConfig(startDir: string): { config: EsedreConfig; workspaceRoot: string } | null {
  if (!startDir || typeof startDir !== 'string' || !startDir.trim()) {
    return null;
  }
  let current = path.resolve(startDir.trim());
  const candidates = [
    ['.esedre', 'esedre.json'],
    ['esedre.json'],
  ];

  while (true) {
    for (const segs of candidates) {
      const candidatePath = path.join(current, ...segs);
      if (fs.existsSync(candidatePath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(candidatePath, 'utf-8')) as EsedreConfig;
          if (parsed && typeof parsed === 'object') {
            return { config: parsed, workspaceRoot: current };
          }
        } catch {}
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

export function resolveActiveContextFromWorkspaces(
  workspacePaths?: string[],
  conversationId?: string
): McpActiveWorkspaceContext | null {
  if (!Array.isArray(workspacePaths) || workspacePaths.length === 0) {
    return null;
  }

  let primaryWorkspaceRoot: string | undefined;
  let primaryProjectCode: string | undefined;
  const allowedSet = new Map<string, string>();
  let hasWildcard = false;

  for (const rawWsPath of workspacePaths) {
    if (!rawWsPath || typeof rawWsPath !== 'string') continue;
    const discovered = findLocalWorkspaceConfig(rawWsPath);
    if (!discovered) continue;

    const { config, workspaceRoot } = discovered;
    if (!primaryWorkspaceRoot) {
      primaryWorkspaceRoot = workspaceRoot;
    }
    if (!primaryProjectCode && config.projectCode && config.projectCode.trim()) {
      primaryProjectCode = config.projectCode.trim();
      primaryWorkspaceRoot = workspaceRoot;
    }

    const effectiveAllowed =
      Array.isArray(config.allowedProjects) && config.allowedProjects.length > 0
        ? config.allowedProjects
        : config.projectCode && config.projectCode.trim()
          ? [config.projectCode.trim()]
          : [];

    for (const code of effectiveAllowed) {
      if (!code || typeof code !== 'string') continue;
      const trimmed = code.trim();
      if (!trimmed) continue;
      if (trimmed === '*') {
        hasWildcard = true;
      } else if (!allowedSet.has(trimmed.toLowerCase())) {
        allowedSet.set(trimmed.toLowerCase(), trimmed);
      }
    }
  }

  if (!primaryWorkspaceRoot && !primaryProjectCode && allowedSet.size === 0 && !hasWildcard) {
    return null;
  }

  const allowedProjects = hasWildcard
    ? ['*']
    : allowedSet.size > 0
      ? Array.from(allowedSet.values())
      : undefined;

  return {
    ...(conversationId ? { conversationId } : {}),
    workspaceRoot: primaryWorkspaceRoot || path.resolve(workspacePaths[0]),
    workspacePaths: workspacePaths.map((p) => path.resolve(p)),
    ...(primaryProjectCode ? { projectCode: primaryProjectCode } : {}),
    ...(allowedProjects ? { allowedProjects } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export function extractEsedreToolInvocation(toolCall?: {
  name?: string;
  args?: Record<string, any>;
}): {
  isEsedre: boolean;
  toolName: string;
  args: Record<string, any>;
} {
  if (!toolCall || typeof toolCall.name !== 'string') {
    return { isEsedre: false, toolName: '', args: {} };
  }
  const rawName = toolCall.name.trim();
  const rawArgs = toolCall.args && typeof toolCall.args === 'object' ? toolCall.args : {};

  if (rawName === 'call_mcp_tool') {
    const serverName = String(rawArgs.ServerName || rawArgs.serverName || '').trim().toLowerCase();
    const innerToolName = String(rawArgs.ToolName || rawArgs.toolName || '').trim();
    const innerArgs =
      rawArgs.Arguments && typeof rawArgs.Arguments === 'object'
        ? rawArgs.Arguments
        : rawArgs.arguments && typeof rawArgs.arguments === 'object'
          ? rawArgs.arguments
          : {};
    if (serverName === 'esedre' || /^esedre_/i.test(innerToolName)) {
      return {
        isEsedre: true,
        toolName: innerToolName,
        args: innerArgs,
      };
    }
    return { isEsedre: false, toolName: '', args: {} };
  }

  if (rawName === 'list_resources' || rawName === 'read_resource') {
    const serverName = String(rawArgs.ServerName || rawArgs.serverName || '').trim().toLowerCase();
    if (serverName === 'esedre') {
      return {
        isEsedre: true,
        toolName: rawName,
        args: rawArgs,
      };
    }
    return { isEsedre: false, toolName: '', args: {} };
  }

  if (/^(?:mcp_esedre_)?esedre_/i.test(rawName)) {
    return {
      isEsedre: true,
      toolName: rawName.replace(/^mcp_esedre_/i, ''),
      args: rawArgs,
    };
  }

  return { isEsedre: false, toolName: '', args: {} };
}

export function evaluateAntigravityPreToolHook(
  input: PreToolUseHookInput,
  options?: { persistContext?: boolean; globalDir?: string }
): PreToolUseHookOutput {
  const persistContext = options?.persistContext !== false;
  const activeContext = resolveActiveContextFromWorkspaces(
    input?.workspacePaths,
    input?.conversationId
  );

  const invocation = extractEsedreToolInvocation(input?.toolCall);
  if (!invocation.isEsedre) {
    return { decision: 'allow' };
  }

  if (activeContext) {
    const allowed = activeContext.allowedProjects;
    if (allowed && allowed.length > 0 && !allowed.includes('*')) {
      const explicitProject = invocation.args.project ?? invocation.args.projectCode;
      if (
        typeof explicitProject === 'string' &&
        explicitProject.trim() &&
        explicitProject.trim().toLowerCase() !== 'all'
      ) {
        if (!isProjectAuthorized(explicitProject.trim(), allowed)) {
          return {
            decision: 'deny',
            reason: `Access Denied: Project '${explicitProject.trim()}' is outside this workspace's authorized scope.`,
          };
        }
      }

      const idFields = [
        invocation.args.ticketId,
        invocation.args.id,
        invocation.args.sourceTicketId,
        invocation.args.sourceId,
      ];
      for (const rawId of idFields) {
        if (typeof rawId === 'string' && rawId.trim()) {
          const match = rawId.trim().match(/^#?([a-zA-Z0-9]{1,8})[-_:](\d+)$/);
          if (match) {
            const prefix = match[1];
            if (!isProjectAuthorized(prefix, allowed)) {
              return {
                decision: 'deny',
                reason: `Access Denied: Project '${prefix}' is outside this workspace's authorized scope.`,
              };
            }
          }
        }
      }
    }

    if (persistContext) {
      try {
        writeActiveMcpContext(activeContext, options?.globalDir);
      } catch {}
    }
  }

  return { decision: 'allow' };
}

export async function handleAntigravityPreToolHookCli(rawStdin?: string): Promise<PreToolUseHookOutput> {
  try {
    const inputText =
      rawStdin !== undefined
        ? rawStdin
        : fs.readFileSync(0, 'utf-8');
    if (!inputText || !inputText.trim()) {
      return { decision: 'allow' };
    }
    const parsed = JSON.parse(inputText) as PreToolUseHookInput;
    return evaluateAntigravityPreToolHook(parsed);
  } catch {
    return { decision: 'allow' };
  }
}

export function renderStandaloneAntigravityPreToolHookScript(): string {
  return `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function getGlobalDir() {
  if (process.env.ESEDRE_GLOBAL_DIR) return process.env.ESEDRE_GLOBAL_DIR;
  return path.join(os.homedir(), '.esedre');
}

function isProjectAuthorized(projectCode, allowedProjects) {
  if (!allowedProjects || allowedProjects.length === 0) return true;
  const list = allowedProjects.map((p) => String(p).trim().toUpperCase());
  if (list.includes('*')) return true;
  return list.includes(String(projectCode).trim().toUpperCase());
}

function findLocalWorkspaceConfig(startDir) {
  if (!startDir || typeof startDir !== 'string' || !startDir.trim()) return null;
  let current = path.resolve(startDir.trim());
  const candidates = [['.esedre', 'esedre.json'], ['esedre.json']];
  while (true) {
    for (const segs of candidates) {
      const candidatePath = path.join(current, ...segs);
      if (fs.existsSync(candidatePath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(candidatePath, 'utf-8'));
          if (parsed && typeof parsed === 'object') {
            return { config: parsed, workspaceRoot: current };
          }
        } catch {}
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function resolveActiveContextFromWorkspaces(workspacePaths, conversationId) {
  if (!Array.isArray(workspacePaths) || workspacePaths.length === 0) return null;
  let primaryWorkspaceRoot;
  let primaryProjectCode;
  const allowedSet = new Map();
  let hasWildcard = false;

  for (const rawWsPath of workspacePaths) {
    if (!rawWsPath || typeof rawWsPath !== 'string') continue;
    const discovered = findLocalWorkspaceConfig(rawWsPath);
    if (!discovered) continue;
    const { config, workspaceRoot } = discovered;
    if (!primaryWorkspaceRoot) primaryWorkspaceRoot = workspaceRoot;
    if (!primaryProjectCode && config.projectCode && String(config.projectCode).trim()) {
      primaryProjectCode = String(config.projectCode).trim();
      primaryWorkspaceRoot = workspaceRoot;
    }
    const effectiveAllowed =
      Array.isArray(config.allowedProjects) && config.allowedProjects.length > 0
        ? config.allowedProjects
        : config.projectCode && String(config.projectCode).trim()
          ? [String(config.projectCode).trim()]
          : [];
    for (const code of effectiveAllowed) {
      if (!code || typeof code !== 'string') continue;
      const trimmed = code.trim();
      if (!trimmed) continue;
      if (trimmed === '*') hasWildcard = true;
      else if (!allowedSet.has(trimmed.toLowerCase())) allowedSet.set(trimmed.toLowerCase(), trimmed);
    }
  }

  if (!primaryWorkspaceRoot && !primaryProjectCode && allowedSet.size === 0 && !hasWildcard) return null;
  const allowedProjects = hasWildcard ? ['*'] : allowedSet.size > 0 ? Array.from(allowedSet.values()) : undefined;
  return {
    ...(conversationId ? { conversationId } : {}),
    workspaceRoot: primaryWorkspaceRoot || path.resolve(workspacePaths[0]),
    workspacePaths: workspacePaths.map((p) => path.resolve(p)),
    ...(primaryProjectCode ? { projectCode: primaryProjectCode } : {}),
    ...(allowedProjects ? { allowedProjects } : {}),
    updatedAt: new Date().toISOString(),
  };
}

function extractEsedreToolInvocation(toolCall) {
  if (!toolCall || typeof toolCall.name !== 'string') return { isEsedre: false, toolName: '', args: {} };
  const rawName = toolCall.name.trim();
  const rawArgs = toolCall.args && typeof toolCall.args === 'object' ? toolCall.args : {};
  if (rawName === 'call_mcp_tool') {
    const serverName = String(rawArgs.ServerName || rawArgs.serverName || '').trim().toLowerCase();
    const innerToolName = String(rawArgs.ToolName || rawArgs.toolName || '').trim();
    const innerArgs =
      rawArgs.Arguments && typeof rawArgs.Arguments === 'object'
        ? rawArgs.Arguments
        : rawArgs.arguments && typeof rawArgs.arguments === 'object'
          ? rawArgs.arguments
          : {};
    if (serverName === 'esedre' || /^esedre_/i.test(innerToolName)) {
      return { isEsedre: true, toolName: innerToolName, args: innerArgs };
    }
    return { isEsedre: false, toolName: '', args: {} };
  }
  if (rawName === 'list_resources' || rawName === 'read_resource') {
    const serverName = String(rawArgs.ServerName || rawArgs.serverName || '').trim().toLowerCase();
    if (serverName === 'esedre') return { isEsedre: true, toolName: rawName, args: rawArgs };
    return { isEsedre: false, toolName: '', args: {} };
  }
  if (/^(?:mcp_esedre_)?esedre_/i.test(rawName)) {
    return { isEsedre: true, toolName: rawName.replace(/^mcp_esedre_/i, ''), args: rawArgs };
  }
  return { isEsedre: false, toolName: '', args: {} };
}

try {
  const inputText = fs.readFileSync(0, 'utf-8');
  const parsed = inputText && inputText.trim() ? JSON.parse(inputText) : {};
  const invocation = extractEsedreToolInvocation(parsed.toolCall);
  if (!invocation.isEsedre) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\\n');
    process.exit(0);
  }
  const activeContext = resolveActiveContextFromWorkspaces(parsed.workspacePaths, parsed.conversationId);
  if (activeContext) {
    const allowed = activeContext.allowedProjects;
    if (allowed && allowed.length > 0 && !allowed.includes('*')) {
      const explicitProject = invocation.args.project ?? invocation.args.projectCode;
      if (typeof explicitProject === 'string' && explicitProject.trim() && explicitProject.trim().toLowerCase() !== 'all') {
        if (!isProjectAuthorized(explicitProject.trim(), allowed)) {
          process.stdout.write(JSON.stringify({
            decision: 'deny',
            reason: "Access Denied: Project '" + explicitProject.trim() + "' is outside this workspace's authorized scope."
          }) + '\\n');
          process.exit(0);
        }
      }
      const idFields = [invocation.args.ticketId, invocation.args.id, invocation.args.sourceTicketId, invocation.args.sourceId];
      for (const rawId of idFields) {
        if (typeof rawId === 'string' && rawId.trim()) {
          const match = rawId.trim().match(/^#?([a-zA-Z0-9]{1,8})[-_:](\\d+)$/);
          if (match && !isProjectAuthorized(match[1], allowed)) {
            process.stdout.write(JSON.stringify({
              decision: 'deny',
              reason: "Access Denied: Project '" + match[1] + "' is outside this workspace's authorized scope."
            }) + '\\n');
            process.exit(0);
          }
        }
      }
    }
    const globalDir = getGlobalDir();
    if (!fs.existsSync(globalDir)) fs.mkdirSync(globalDir, { recursive: true });
    const targetPath = path.join(globalDir, 'mcp-active-context.json');
    const tempPath = targetPath + '.tmp.' + process.pid + '.' + Date.now();
    const serialized = JSON.stringify(activeContext, null, 2) + '\\n';
    try {
      fs.writeFileSync(tempPath, serialized, 'utf-8');
      fs.renameSync(tempPath, targetPath);
    } catch {
      fs.writeFileSync(targetPath, serialized, 'utf-8');
    }
  }
  process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\\n');
} catch {
  process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\\n');
}
`;
}

export function ensureAntigravityPreToolHookScript(globalDir = getGlobalConfigDir()): string {
  if (!fs.existsSync(globalDir)) {
    fs.mkdirSync(globalDir, { recursive: true });
  }
  const scriptPath = path.join(globalDir, 'agy-pre-tool-hook.mjs');
  fs.writeFileSync(scriptPath, renderStandaloneAntigravityPreToolHookScript(), 'utf-8');
  return scriptPath;
}
