/**
 * Storage and Repository Layer for Esedre.
 *
 * Implements a clean Spring-like Repository Pattern:
 * - TicketRepository: The core domain repository interface
 * - FilesystemTicketRepository: Filesystem-backed persistence implementation
 * - SecurityFilter / AuthorizedTicketRepository: Security proxy enforcing the Agent Project Allow-List
 * - createTicketRepository / createAuthorizedRepository: Factory helpers
 */

import { EsedreConfig, findEsedreConfig } from '../config.js';
import { TicketRepository } from './repository.js';
import { FilesystemTicketRepository } from './filesystem.js';
import { AuthorizedTicketRepository } from './securityFilter.js';

export * from './repository.js';
export * from './filesystem.js';
export * from './securityFilter.js';

export interface RepositoryFactoryOptions {
  workspaceRoot?: string;
  config?: EsedreConfig;
  secure?: boolean;
}

/**
 * Creates a TicketRepository instance. By default, wraps the filesystem repository
 * with AuthorizedTicketRepository (SecurityFilter) to enforce project isolation.
 */
export function createTicketRepository(
  workspaceRoot?: string,
  config?: EsedreConfig,
  options: { secure?: boolean } = { secure: true }
): TicketRepository {
  const root = workspaceRoot || process.cwd();
  let effectiveConfig = config;
  if (!effectiveConfig) {
    try {
      effectiveConfig = findEsedreConfig(root).config;
    } catch {
      effectiveConfig = {};
    }
  }
  const rawRepo = new FilesystemTicketRepository(root, effectiveConfig);

  if (options.secure === false) {
    return rawRepo;
  }

  return new AuthorizedTicketRepository(rawRepo, effectiveConfig);
}

/**
 * Creates an authorized TicketRepository decorated with project allow-list checks.
 */
export function createAuthorizedRepository(
  workspaceRoot?: string,
  config?: EsedreConfig
): TicketRepository {
  return createTicketRepository(workspaceRoot, config, { secure: true });
}
