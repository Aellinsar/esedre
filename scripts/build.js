import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const esedreRoot = path.resolve(__dirname, '..');

fs.mkdirSync(path.join(esedreRoot, 'dist'), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(esedreRoot, 'bin', 'esedre.ts')],
  outfile: path.join(esedreRoot, 'dist', 'esedre.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
});


fs.mkdirSync(path.join(esedreRoot, 'dist', 'web'), { recursive: true });



// Build Web Component embed script
await esbuild.build({
  entryPoints: [path.join(esedreRoot, 'src', 'embed', 'esedre-planner.ts')],
  outfile: path.join(esedreRoot, 'dist', 'web', 'embed.js'),
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  sourcemap: false,
});

console.log('Esedre CLI & Embed build complete -> esedre/dist/esedre.mjs & esedre/dist/web/embed.js');


