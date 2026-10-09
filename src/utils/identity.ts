import os from 'node:os';
import { EsedreConfig, readGlobalConfig } from '../config.js';
import { CrewRole } from '../types.js';

export interface WorkerIdentity {
  system: string;
  workerId: string;
  role: CrewRole;
}

/**
 * Resolves the machine-authoritative system identity.
 * System identity cannot be spoofed via CLI flags.
 * Priority:
 * 1. Global config system (~/.esedre/config.json -> system)
 * 2. Passed config system (if explicitly provided in code)
 * 3. Environment variable ESEDRE_SYSTEM (for test suites)
 * 4. os.hostname()
 */
export function resolveSystemIdentity(config?: EsedreConfig): string {
  try {
    const globalCfg = readGlobalConfig();
    if (globalCfg?.system && globalCfg.system.trim()) {
      return globalCfg.system.trim();
    }
  } catch {}

  if (config?.system && config.system.trim()) {
    return config.system.trim();
  }

  if (process.env.ESEDRE_SYSTEM && process.env.ESEDRE_SYSTEM.trim()) {
    return process.env.ESEDRE_SYSTEM.trim();
  }

  return os.hostname() || 'localhost';
}

/**
 * Resolves the process-bound worker identity.
 * Reads process.env.ESEDRE_WORKER_ID, defaulting to 'lead'.
 * Role is derived from process.env.ESEDRE_WORKER_ROLE, requested role, or default.
 */
export function resolveWorkerIdentity(
  config?: EsedreConfig,
  overrides?: { role?: CrewRole; workerId?: string }
): WorkerIdentity {
  const system = resolveSystemIdentity(config);

  const envWorkerId = process.env.ESEDRE_WORKER_ID?.trim();
  const envRole = process.env.ESEDRE_WORKER_ROLE?.trim().toLowerCase();

  // If running inside a designated worker process, workerId cannot be spoofed to another identity
  let workerId: string;
  if (envWorkerId) {
    if (overrides?.workerId && overrides.workerId.trim().toLowerCase() !== envWorkerId.toLowerCase()) {
      if (envRole === 'thug' || envRole === 'anchor') {
        throw new Error(
          `Access Denied: Worker process is bound to '${envWorkerId}' and cannot impersonate '${overrides.workerId}'.`
        );
      }
    }
    workerId = overrides?.workerId?.trim() || envWorkerId;
  } else {
    workerId = overrides?.workerId?.trim() || 'lead';
  }

  // Role resolution & escalation guard:
  if (envRole === 'thug' && overrides?.role && overrides.role !== 'thug') {
    throw new Error(
      `Access Denied: Process role is bound to 'thug' and cannot escalate role to '${overrides.role}'.`
    );
  }
  if (envRole === 'anchor' && overrides?.role && overrides.role === 'lead') {
    throw new Error(
      `Access Denied: Process role is bound to 'anchor' and cannot escalate role to 'lead'.`
    );
  }

  let role: CrewRole;
  if (overrides?.role) {
    role = overrides.role;
  } else if (envRole === 'anchor' || envRole === 'thug' || envRole === 'lead') {
    role = envRole as CrewRole;
  } else {
    role = workerId.toLowerCase() === 'lead' ? 'lead' : 'thug';
  }

  return { system, workerId, role };
}
