import fs from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';

const isInteractive = Boolean(process.stdin.isTTY && !process.env.CI);
const extraArgs = process.argv.slice(2);

// 1. Check current npm authentication status upfront
let authenticated = false;
let npmUser = '';

try {
  npmUser = execSync('npm whoami', {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  authenticated = Boolean(npmUser);
} catch {
  authenticated = false;
}

if (authenticated) {
  console.log(`\n✔ Authenticated with npm as: ${npmUser}`);
} else if (isInteractive) {
  console.log('\n⚠️  Not authenticated with npm. Launching interactive npm login...\n');
  const loginResult = spawnSync('npm', ['login'], {
    stdio: 'inherit',
    shell: true,
  });

  if (loginResult.status !== 0) {
    console.error('\n✖ npm login was cancelled or failed.');
    process.exit(loginResult.status || 1);
  }
} else {
  console.warn('\n⚠️  npm whoami failed, but running in non-interactive / CI environment. Proceeding to npm publish directly...');
}

// 2. Pre-check npm registry to prevent duplicate version collision (E403)
try {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
  const publishedVersion = execSync(`npm view ${pkg.name}@${pkg.version} version`, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (publishedVersion === pkg.version) {
    console.error(`\n✖ Version Collision Error: Version ${pkg.version} of ${pkg.name} is already published on npm.`);
    console.error(`  Please bump "version" in package.json (and src/types.ts) before publishing.\n`);
    process.exit(1);
  }
} catch {
  // Not published yet on registry or network offline: proceed
}

// 3. Invoke npm publish (which automatically triggers prepublishOnly tests and build)
console.log('\n🚀 Starting npm publish...\n');
const publishArgs = ['publish', '--access', 'public', ...extraArgs];

const publishResult = spawnSync('npm', publishArgs, {
  stdio: 'inherit',
  shell: true,
});

process.exit(publishResult.status ?? 0);
