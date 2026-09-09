import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { DEFAULT_ALLOW_LIST, GAMEDAY_ALLOW_LIST } from './constants.js';

// 1. Parse Mode (npm run net:all passes --all)
const isAllMode = process.argv.includes('--all');

console.log('\nðŸš€ [Professor Arwam] Starting Vite Dev Server & Cloudflare Tunnel (dev.arwam.com)...\n');

// 2. Locate cloudflared binary
function getCloudflaredPath() {
  const candidates = [
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
    'cloudflared',
  ];
  for (const candidate of candidates) {
    if (candidate === 'cloudflared' || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'cloudflared';
}

import https from 'node:https';

// 3. Check if local ISP is actively intercepting Cloudflare Edge with fake certs (matchday block)
function checkIspMatchBlock() {
  return new Promise((resolve) => {
    const req = https.request('https://188.114.96.5', { timeout: 1500 }, () => {
      resolve(false);
    });
    req.on('timeout', () => {
      req.destroy(new Error('ETIMEDOUT'));
    });
    req.on('error', (err) => {
      if (
        err?.message?.includes('self-signed') ||
        err?.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
        err?.code === 'ECONNRESET' ||
        err?.message === 'ETIMEDOUT'
      ) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    req.end();
  });
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(400);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

// 4. Fetch external public IP addresses (IPv4 and IPv6)
async function getDetectedIps() {
  const ips = new Set();

  try {
    const res = await fetch('https://1.1.1.1/cdn-cgi/trace', { signal: AbortSignal.timeout(5674) });
    if (res.ok) {
      const text = await res.text();
      const match = text.match(/^ip=(.+)$/m);
      if (match && match[1]) ips.add(match[1].trim());
    }
  } catch {}

  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5674) });
    if (res.ok) {
      const data = await res.json();
      if (data.ip) ips.add(data.ip.trim());
    }
  } catch {}

  try {
    const res = await fetch('https://api64.ipify.org?format=json', { signal: AbortSignal.timeout(5674) });
    if (res.ok) {
      const data = await res.json();
      if (data.ip) ips.add(data.ip.trim());
    }
  } catch {}

  return Array.from(ips);
}

async function main() {
  const cloudflaredPath = getCloudflaredPath();
  const viteCliPath = path.resolve('node_modules/vite/bin/vite.js');

  let allowedIpsEnv = '';

  if (isAllMode) {
    console.log('ðŸ”“ [Security] PUBLIC MODE ACTIVE: Tunnel is open to ALL external IP addresses.\n');
    allowedIpsEnv = '*';
  } else {
    console.log('ðŸ” [Security] Resolving current external IP addresses for whitelist...');
    const isMatchBlockActive = await checkIspMatchBlock();
    const detectedIps = await getDetectedIps();

    let extraIps = [];
    if (process.env.EXTRA_ALLOWED_IPS) {
      extraIps = process.env.EXTRA_ALLOWED_IPS.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (isMatchBlockActive) {
      console.log('âš½ \x1b[33m[ISP Match-Day Block Detected]\x1b[0m Spanish ISP is actively dropping direct Cloudflare Edge packets.');
      console.log('   ðŸ›¡ï¸  \x1b[32m[Auto-Profile: GAMEDAY_ALLOW_LIST]\x1b[0m Enabled Cloudflare WARP mobile subnet (2a09:bac0::/28).\n');
      extraIps = [...DEFAULT_ALLOW_LIST, ...GAMEDAY_ALLOW_LIST];
    } else {
      console.log('ðŸ  \x1b[32m[Auto-Profile: DEFAULT_ALLOW_LIST]\x1b[0m No ISP match block detected. Enforcing strict Home IP whitelist.\n');
      extraIps = [...DEFAULT_ALLOW_LIST];
    }

    extraIps.forEach((ip) => {
      if (ip && !detectedIps.includes(ip)) detectedIps.push(ip);
    });

    if (detectedIps.length > 0) {
      allowedIpsEnv = detectedIps.join(',');
      console.log('ðŸ”’ [Security] IP WHITELIST ACTIVE:');
      console.log(`   - Allowed IP(s)/Ranges: ${detectedIps.join(', ')}`);
      console.log('   - Direct Connections: Localhost & Local LAN');
      console.log('   - External requests from other IPs will receive HTTP 403 Forbidden.');
      console.log('   (Tip: Run "npm run net:all" to allow all external IPs)\n');
    } else {
      console.warn('âš ï¸ [Security] Could not resolve external IP addresses. Permissive mode enabled.\n');
      allowedIpsEnv = '*';
    }
  }

  // 4. Start Vite with environment variable and host binding
  const vite = spawn(process.execPath, [viteCliPath, '--port=5674', '--host'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      TUNNEL_ALLOWED_IPS: allowedIpsEnv,
    },
  });

  // 5. Start Tunnel with HTTP/2 transport protocol (avoids UDP QUIC hairpin/NAT drops on LAN)
  const tunnel = spawn(cloudflaredPath, ['tunnel', 'run', '--protocol', 'http2', 'arwam-beta'], {
    stdio: 'inherit',
    shell: false,
  });

  // 6. Conditionally Start Esedre Server Daemon (port 5674 gateway, 5675 UI, 5676 API)
  const isEsedreDisabled =
    process.argv.includes('--no-esedre') ||
    process.env.NO_ESEDRE === 'true';

  const esedrePathCandidates = [
    path.resolve(import.meta.dirname, '../../tools/esedre.mjs'),
  ];
  const esedreConfigCandidates = [
    path.resolve(import.meta.dirname, '../../.esedre/esedre.json'),
  ];

  const esedrePath = esedrePathCandidates.find((p) => fs.existsSync(p));
  const esedreConfigPath = esedreConfigCandidates.find((p) => fs.existsSync(p));
  let esedre = null;

  if (isEsedreDisabled) {
    console.log('ðŸ“Œ [Esedre] Daemon skipped (--no-esedre active).\n');
  } else if (!esedrePath || !esedreConfigPath) {
    // Project does not have Esedre configured or built; skip silently
  } else {
    const portBusy = await isPortInUse(5674);
    if (portBusy) {
      console.log('âš¡ [Esedre] Existing server detected on port 5674. Reusing running daemon.\n');
    } else {
      esedre = spawn(process.execPath, [esedrePath, 'serve'], {
        stdio: 'inherit',
        shell: false,
      });
    }
  }

  // 7. Handle Clean Termination
  let isShuttingDown = false;
  const cleanup = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\nðŸ›‘ [Professor Arwam] Shutting down Vite, Esedre, and Cloudflare Tunnel...');
    try {
      if (process.platform === 'win32') {
        if (vite.pid) spawn('taskkill', ['/pid', String(vite.pid), '/f', '/t'], { shell: false });
        if (tunnel.pid) spawn('taskkill', ['/pid', String(tunnel.pid), '/f', '/t'], { shell: false });
        if (esedre && esedre.pid) spawn('taskkill', ['/pid', String(esedre.pid), '/f', '/t'], { shell: false });
      } else {
        vite.kill('SIGINT');
        tunnel.kill('SIGINT');
        if (esedre) esedre.kill('SIGINT');
      }
    } catch (e) {
      // Ignore cleanup error on exit
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGQUIT', cleanup);
}

main().catch((err) => {
  console.error('Fatal error starting dev tunnel:', err);
  process.exit(1);
});
