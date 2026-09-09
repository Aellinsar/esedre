import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const esedreRoot = path.resolve(__dirname, '..');
const githubRoot = path.resolve(esedreRoot, '..');

const artifactSrc = path.join(esedreRoot, 'dist', 'esedre.mjs');
const webSrc = path.join(esedreRoot, 'dist', 'web');

const pasrcToolsDir = path.join(githubRoot, 'ProfessorArwamSleepCenter', 'tools');
const esedreDestFile = path.join(pasrcToolsDir, 'esedre.mjs');
const webDestDir = path.join(pasrcToolsDir, 'web');

if (!fs.existsSync(artifactSrc)) {
  console.error(`Artifact not found at ${artifactSrc}. Run npm run build first.`);
  process.exit(1);
}

fs.mkdirSync(pasrcToolsDir, { recursive: true });
fs.copyFileSync(artifactSrc, esedreDestFile);
console.log(`Bridge artifact copied:\n  ${artifactSrc} -> ${esedreDestFile}`);

if (fs.existsSync(webSrc)) {
  fs.cpSync(webSrc, webDestDir, { recursive: true });
  console.log(`Web UI bundle copied:\n  ${webSrc} -> ${webDestDir}`);
}
