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

// 2. Invoke npm publish (which automatically triggers prepublishOnly tests and build)
console.log('\n🚀 Starting npm publish...\n');
const publishArgs = ['publish', '--access', 'public', ...extraArgs];

const publishResult = spawnSync('npm', publishArgs, {
  stdio: 'inherit',
  shell: true,
});

process.exit(publishResult.status ?? 0);
