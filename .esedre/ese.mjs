#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  ...(process.env.ESEDRE_BUNDLE_PATH ? [process.env.ESEDRE_BUNDLE_PATH] : []),
  path.resolve(scriptDir, '../dist/esedre.mjs'),
  path.resolve(scriptDir, '../../esedre/dist/esedre.mjs'),
  path.resolve(scriptDir, '../esedre/dist/esedre.mjs'),
  path.resolve(scriptDir, '../node_modules/esedre/dist/esedre.mjs'),
  ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm', 'node_modules', 'esedre', 'dist', 'esedre.mjs')] : []),
  ...(process.env.NPM_CONFIG_PREFIX ? [path.join(process.env.NPM_CONFIG_PREFIX, 'lib', 'node_modules', 'esedre', 'dist', 'esedre.mjs')] : []),
  path.resolve(path.dirname(process.execPath), '../lib/node_modules/esedre/dist/esedre.mjs'),
  '/opt/homebrew/lib/node_modules/esedre/dist/esedre.mjs',
  '/usr/local/lib/node_modules/esedre/dist/esedre.mjs',
];
const resolvedBundle = candidates.find((p) => fs.existsSync(p));
if (resolvedBundle) {
  process.argv[1] = resolvedBundle;
  await import(pathToFileURL(resolvedBundle).href);
} else {
  const args = process.argv.slice(2);
  const child = spawn('npx', ['--yes', 'esedre', ...args], { stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => process.exit(code ?? 1));
  child.on('error', () => process.exit(1));
}
