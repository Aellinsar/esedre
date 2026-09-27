import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const esedreRoot = path.resolve(__dirname, '..');
const githubRoot = path.resolve(esedreRoot, '..');

const artifactSrc = path.join(esedreRoot, 'dist', 'esedre.mjs');
const webSrc = path.join(esedreRoot, 'dist', 'web');

const bridgeDestFile = path.resolve(esedreRoot, '.bridge-dest');
let customDestDir = process.env.ESEDRE_BRIDGE_DEST;

if (!customDestDir && fs.existsSync(bridgeDestFile)) {
  try {
    customDestDir = fs.readFileSync(bridgeDestFile, 'utf-8').trim();
  } catch {}
}

if (!customDestDir) {
  console.log('ℹ️  No bridge destination configured.');
  console.log('   To bridge build artifacts to a consuming project, set ESEDRE_BRIDGE_DEST or create a local .bridge-dest file (gitignored).');
  process.exit(0);
}

const targetToolsDir = path.isAbsolute(customDestDir)
  ? customDestDir
  : path.resolve(githubRoot, customDestDir);

const esedreDestFile = path.join(targetToolsDir, 'esedre.mjs');
const webDestDir = path.join(targetToolsDir, 'web');

if (!fs.existsSync(artifactSrc)) {
  console.error(`Artifact not found at ${artifactSrc}. Run npm run build first.`);
  process.exit(1);
}

fs.mkdirSync(targetToolsDir, { recursive: true });
fs.copyFileSync(artifactSrc, esedreDestFile);
console.log(`Bridge artifact copied:\n  ${artifactSrc} -> ${esedreDestFile}`);

if (fs.existsSync(webSrc)) {
  fs.cpSync(webSrc, webDestDir, { recursive: true });
  console.log(`Web UI bundle copied:\n  ${webSrc} -> ${webDestDir}`);
}
