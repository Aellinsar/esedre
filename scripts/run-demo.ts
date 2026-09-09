import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMockDataset } from './generate-mock-data.mjs';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { SecurityFilter } from '../src/securityFilter.js';
import { startGatewayCluster } from '../src/server/gateway.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const mockHubDir = path.resolve(os.tmpdir(), 'esedre-demo-mock-hub');

console.log('Generating isolated test dataset in:', mockHubDir);
createMockDataset(mockHubDir);

const rawStorage = new FilesystemStorageAdapter(workspaceRoot, {
  version: '0.1.0',
  dataDir: mockHubDir,
  allowedProjects: ['*'],
});
const storage = new SecurityFilter(rawStorage, {
  allowedProjects: ['*'],
});

const gatewayPort = 5674;
const cluster = startGatewayCluster({
  gatewayPort,
  uiPort: gatewayPort + 1,
  apiPort: gatewayPort + 2,
  storage,
  workspaceRoot,
  webDir: path.resolve(workspaceRoot, 'dist/web'),
});

console.log(`Esedre Demo Gateway running at http://127.0.0.1:${gatewayPort}/app/?project=all`);

process.on('SIGTERM', async () => {
  console.log('Stopping demo cluster...');
  await cluster.close();
  process.exit(0);
});
process.on('SIGINT', async () => {
  console.log('Stopping demo cluster...');
  await cluster.close();
  process.exit(0);
});
