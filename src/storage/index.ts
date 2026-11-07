import { StorageAdapter } from './adapter.js';
import { FilesystemStorageAdapter } from './filesystem.js';
import { HttpStorageAdapter } from './http.js';
import { SecurityFilter } from '../securityFilter.js';
import { DiscoveredConfig, resolveRemoteHost } from '../config.js';

export interface CreateStorageAdapterOptions {
  hostFlag?: string;
  projectCode?: string;
}

export interface ResolvedStorageAdapter {
  rawStorage: StorageAdapter;
  storage: SecurityFilter;
  remoteHost?: string;
}

export function createStorageAdapter(
  discovered: DiscoveredConfig,
  options?: CreateStorageAdapterOptions
): ResolvedStorageAdapter {
  const remoteHost = resolveRemoteHost(discovered, options);
  const rawStorage: StorageAdapter = remoteHost
    ? new HttpStorageAdapter({
        host: remoteHost,
        workspaceRoot: discovered.workspaceRoot,
        config: discovered.config,
      })
    : new FilesystemStorageAdapter(discovered.workspaceRoot, discovered.config);

  const storage = new SecurityFilter(rawStorage, discovered.config);
  return { rawStorage, storage, remoteHost };
}

export { StorageAdapter, FilesystemStorageAdapter, HttpStorageAdapter };
