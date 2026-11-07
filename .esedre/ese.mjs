#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const cwd = process.cwd();
const localWrapper = path.resolve(cwd, '.esedre/ese.mjs');
const localWrapperDir = fs.existsSync(localWrapper) ? path.dirname(localWrapper) : path.join(cwd, '.esedre');
let configuredRepoBundle = '';
try {
  const cfgPaths = [
    path.join(scriptDir, 'config.json'),
    ...(process.env.ESEDRE_GLOBAL_DIR ? [path.join(process.env.ESEDRE_GLOBAL_DIR, 'config.json')] : []),
    path.join(os.homedir(), '.esedre', 'config.json'),
  ];
  for (const cp of cfgPaths) {
    if (fs.existsSync(cp)) {
      const cfg = JSON.parse(fs.readFileSync(cp, 'utf-8'));
      const repo = cfg?.projects?.Esedre || cfg?.projects?.esedre || cfg?.projects?.ESEDRE;
      if (typeof repo === 'string' && repo.trim()) {
        const expanded = repo.startsWith('~/') || repo.startsWith('~\\') ? path.join(os.homedir(), repo.slice(2)) : repo;
        const candidate = path.resolve(expanded, 'dist/esedre.mjs');
        if (fs.existsSync(candidate)) {
          configuredRepoBundle = candidate;
          break;
        }
      }
    }
  }
} catch {}
const candidates = [
  ...(process.env.ESEDRE_BUNDLE_PATH ? [process.env.ESEDRE_BUNDLE_PATH] : []),
  path.resolve(localWrapperDir, '../dist/esedre.mjs'),
  path.resolve(localWrapperDir, '../../esedre/dist/esedre.mjs'),
  path.resolve(localWrapperDir, '../esedre/dist/esedre.mjs'),
  path.resolve(localWrapperDir, '../node_modules/esedre/dist/esedre.mjs'),
  path.resolve(scriptDir, '../dist/esedre.mjs'),
  path.resolve(scriptDir, '../../esedre/dist/esedre.mjs'),
  path.resolve(scriptDir, '../esedre/dist/esedre.mjs'),
  path.resolve(scriptDir, '../node_modules/esedre/dist/esedre.mjs'),
  ...(configuredRepoBundle ? [configuredRepoBundle] : []),
  ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm', 'node_modules', 'esedre', 'dist', 'esedre.mjs')] : []),
  ...(process.env.NPM_CONFIG_PREFIX ? [
    path.join(process.env.NPM_CONFIG_PREFIX, 'lib', 'node_modules', 'esedre', 'dist', 'esedre.mjs'),
    path.join(process.env.NPM_CONFIG_PREFIX, 'node_modules', 'esedre', 'dist', 'esedre.mjs'),
  ] : []),
  path.resolve(path.dirname(process.execPath), '../lib/node_modules/esedre/dist/esedre.mjs'),
  path.resolve(path.dirname(process.execPath), 'node_modules/esedre/dist/esedre.mjs'),
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
