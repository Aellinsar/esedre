import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FilesystemStorageAdapter } from './src/storage/filesystem.js';
import { SecurityFilter } from './src/securityFilter.js';
import { createApiHandler } from './src/server/apiServer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function esedreApiPlugin(): Plugin {
  return {
    name: 'esedre-api-middleware',
    configureServer(server) {
      const workspaceRoot = path.resolve(__dirname);
      const rawStorage = new FilesystemStorageAdapter(workspaceRoot);
      const storage = new SecurityFilter(rawStorage);
      const apiHandler = createApiHandler(storage, workspaceRoot);

      server.middlewares.use(async (req, res, next) => {
        try {
          const handled = await apiHandler(req, res);
          if (!handled) {
            next();
          }
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

import fs from 'node:fs';
import https from 'node:https';
import { extractListsFromText, isIpAllowed } from './tools/tunnel/ipMatcher.ts';

function tunnelSecurityPlugin(): Plugin {
  let cachedConstantsProfiles = { defaultAllow: [] as string[], gamedayAllow: [] as string[] };
  let lastConstantsMtime = 0;
  let lastMatchBlockCheckTime = 0;
  let isLiveMatchBlockActive = false;

  function checkIspMatchBlockLive(): void {
    const now = Date.now();
    if (now - lastMatchBlockCheckTime < 60000) return;
    lastMatchBlockCheckTime = now;

    const req = https.request('https://188.114.96.5', { timeout: 1500 }, () => {
      if (isLiveMatchBlockActive) {
        console.log(`\x1b[32m[Match-Day Ended] Spanish ISP block lifted. Reverted to DEFAULT_ALLOW_LIST.\x1b[0m`);
      }
      isLiveMatchBlockActive = false;
    });
    req.on('timeout', () => {
      req.destroy(new Error('ETIMEDOUT'));
    });
    req.on('error', (err: Error & { code?: string }) => {
      const isActive =
        err?.message?.includes('self-signed') ||
        err?.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
        err?.code === 'ECONNRESET' ||
        err?.message === 'ETIMEDOUT';
      if (isActive && !isLiveMatchBlockActive) {
        console.log(`\x1b[33m[ISP Match-Day Block Detected]\x1b[0m Auto-activated GAMEDAY_ALLOW_LIST (WARP Subnet).\x1b[0m`);
      }
      isLiveMatchBlockActive = isActive;
    });
    req.end();
  }

  function getDynamicExtraIps(): string[] {
    try {
      checkIspMatchBlockLive();
      const constantsPath = path.resolve(__dirname, 'tools/tunnel/constants.js');
      if (fs.existsSync(constantsPath)) {
        const stat = fs.statSync(constantsPath);
        if (stat.mtimeMs !== lastConstantsMtime) {
          lastConstantsMtime = stat.mtimeMs;
          const content = fs.readFileSync(constantsPath, 'utf-8');
          cachedConstantsProfiles = extractListsFromText(content);
          console.log(`\x1b[36m[Tunnel Whitelist Hot-Reload] Loaded profiles from constants.js\x1b[0m`);
        }
      }
    } catch {}

    return isLiveMatchBlockActive
      ? [...cachedConstantsProfiles.defaultAllow, ...cachedConstantsProfiles.gamedayAllow]
      : [...cachedConstantsProfiles.defaultAllow];
  }

  return {
    name: 'tunnel-security-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // 0. Enforce Cloudflare Tunnel IP Whitelist if active
        const tunnelAllowedIps = process.env.TUNNEL_ALLOWED_IPS;
        if (tunnelAllowedIps) {
          const cfIp = (req.headers['cf-connecting-ip'] || '') as string;
          if (cfIp) {
            if (tunnelAllowedIps === '*') {
              if (req.url === '/' || (!req.url?.startsWith('/@') && !req.url?.includes('.'))) {
                console.log(`\x1b[32m[Tunnel Ingress - Public] Allowed IP: ${cfIp} (Path: ${req.url})\x1b[0m`);
              }
            } else {
              const baseAllowedList = tunnelAllowedIps.split(',').map((s) => s.trim()).filter(Boolean);
              const dynamicExtraIps = getDynamicExtraIps();
              const combinedAllowedList = Array.from(new Set([...baseAllowedList, ...dynamicExtraIps]));

              const allowed = isIpAllowed(cfIp, combinedAllowedList);
              if (!allowed) {
                const userAgent = (req.headers['user-agent'] || 'Unknown-Agent') as string;
                console.warn(`\x1b[31m[Tunnel Hard-Drop] Unauthorized IP: ${cfIp} | Method: ${req.method} | Path: ${req.url} | Agent: "${userAgent}" -> Socket Terminated\x1b[0m`);
                req.socket?.destroy();
                return;
              } else {
                if (req.url === '/' || (!req.url?.startsWith('/@') && !req.url?.includes('.'))) {
                  console.log(`\x1b[32m[Tunnel Ingress - Whitelist Match] Allowed IP: ${cfIp} (Path: ${req.url})\x1b[0m`);
                }
              }
            }
          }
        }

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), esedreApiPlugin(), tunnelSecurityPlugin()],
  root: path.resolve(__dirname),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
  },
  server: {
    allowedHosts: ['esedre.aroomwithamoose.com', 'planner.arwam.com', 'localhost', '127.0.0.1'],
  },
});

