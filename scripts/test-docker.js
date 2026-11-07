import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const DEFAULT_IMAGES = [
  { id: 'debian-node22', image: 'node:22-slim', label: 'Debian Bookworm (glibc, Node 22, dash, no lsof)' },
  { id: 'alpine-node22', image: 'node:22-alpine', label: 'Alpine Linux (musl, BusyBox ash, Node 22)' },
  { id: 'debian-node20', image: 'node:20-slim', label: 'Debian Bookworm (glibc, Node 20 LTS)' },
  { id: 'ubuntu-2404', image: 'ubuntu:24.04', label: 'Ubuntu 24.04 LTS Noble (apt, glibc 2.39, UID 1000 ubuntu)' },
  { id: 'fedora-41', image: 'fedora:41', label: 'Fedora 41 / RHEL RPM Family (dnf, OpenSSL 3 crypto policy, bash)' },
  { id: 'archlinux', image: 'archlinux:latest', label: 'Arch Linux Rolling (pacman, bleeding-edge glibc/git/bash)' },
];

function isDockerDaemonRunning() {
  const res = spawnSync('docker', ['info'], {
    cwd: repoRoot,
    stdio: 'ignore',
    windowsHide: true,
  });
  return res.status === 0;
}

async function ensureDockerDaemon() {
  if (isDockerDaemonRunning()) return true;

  console.log('[Docker] Daemon is not running. Attempting to start Docker Desktop (`docker desktop start`)...');
  spawnSync('docker', ['desktop', 'start'], {
    cwd: repoRoot,
    stdio: 'inherit',
    windowsHide: true,
  });

  for (let i = 0; i < 30; i++) {
    if (isDockerDaemonRunning()) {
      console.log('[Docker] Daemon is ready.\n');
      return true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.error('[Docker] Error: Docker daemon did not become ready in time. Please start Docker Desktop and retry.');
  return false;
}

function parseTargets(argv) {
  const imageIdx = argv.indexOf('--image');
  if (imageIdx !== -1 && argv[imageIdx + 1]) {
    const customImg = argv[imageIdx + 1];
    return [{ id: customImg.replace(/[^a-zA-Z0-9_-]/g, '-'), image: customImg, label: customImg }];
  }
  if (argv.includes('--alpine')) {
    return [DEFAULT_IMAGES[1]];
  }
  if (argv.includes('--ubuntu')) {
    return [DEFAULT_IMAGES[3]];
  }
  if (argv.includes('--fedora')) {
    return [DEFAULT_IMAGES[4]];
  }
  if (argv.includes('--arch')) {
    return [DEFAULT_IMAGES[5]];
  }
  if (argv.includes('--slim') || argv.includes('--quick')) {
    return [DEFAULT_IMAGES[0]];
  }
  return DEFAULT_IMAGES;
}

async function main() {
  const targets = parseTargets(process.argv.slice(2));
  const results = [];

  console.log(`\n============================================================`);
  console.log(`Esedre Cross-Platform Docker Verification Matrix (${targets.length} image(s))`);
  console.log(`============================================================\n`);

  const daemonReady = await ensureDockerDaemon();
  if (!daemonReady) {
    process.exit(1);
  }

  for (const target of targets) {
    const tag = `esedre-xplat-test:${target.id}`;
    console.log(`\n------------------------------------------------------------`);
    console.log(`[Docker Build] ${target.label} (${target.image})`);
    console.log(`------------------------------------------------------------`);

    const buildStart = Date.now();
    const buildRes = spawnSync(
      'docker',
      [
        'build',
        '-f',
        'tools/docker/Dockerfile.test',
        '--build-arg',
        `BASE_IMAGE=${target.image}`,
        '-t',
        tag,
        '.',
      ],
      {
        cwd: repoRoot,
        stdio: 'inherit',
      }
    );

    if (buildRes.status !== 0) {
      results.push({
        ...target,
        stage: 'build',
        passed: false,
        durationSec: ((Date.now() - buildStart) / 1000).toFixed(1),
      });
      continue;
    }

    console.log(`\n------------------------------------------------------------`);
    console.log(`[Docker Run]   ${target.label} (${target.image})`);
    console.log(`------------------------------------------------------------`);

    const runRes = spawnSync('docker', ['run', '--rm', tag], {
      cwd: repoRoot,
      stdio: 'inherit',
    });

    results.push({
      ...target,
      stage: 'test',
      passed: runRes.status === 0,
      durationSec: ((Date.now() - buildStart) / 1000).toFixed(1),
    });
  }

  console.log(`\n============================================================`);
  console.log(`Docker Multi-Image Summary`);
  console.log(`============================================================`);
  for (const r of results) {
    const badge = r.passed ? 'PASS' : `FAIL (${r.stage})`;
    console.log(`  [${badge}] ${r.image.padEnd(18)} - ${r.label} (${r.durationSec}s)`);
  }
  console.log(`============================================================\n`);

  const anyFailed = results.some((r) => !r.passed);
  process.exit(anyFailed ? 1 : 0);
}

main();
