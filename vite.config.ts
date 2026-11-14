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
      const serverConfig = { allowedProjects: ['*'] };
      const rawStorage = new FilesystemStorageAdapter(workspaceRoot, serverConfig);
      const storage = new SecurityFilter(rawStorage, serverConfig);
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
import {
  extractListsFromText,
  getIpv6Prefix64,
  isCloudflareWarpIp,
  isIpAllowed,
} from './tools/tunnel/ipMatcher.ts';

function resolveAllowedHosts(): string[] {
  const hosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (process.env.ESEDRE_ALLOWED_HOSTS) {
    process.env.ESEDRE_ALLOWED_HOSTS.split(',').forEach((h) => {
      const trimmed = h.trim().toLowerCase();
      if (trimmed) hosts.add(trimmed);
    });
  }
  const tunnelConfigPath = path.resolve(__dirname, 'tools/tunnel/config.yml');
  if (fs.existsSync(tunnelConfigPath)) {
    try {
      const content = fs.readFileSync(tunnelConfigPath, 'utf-8');
      const matches = content.matchAll(/hostname:\s*([^\s\r\n]+)/g);
      for (const m of matches) {
        if (m[1]) hosts.add(m[1].toLowerCase());
      }
    } catch {}
  }
  return Array.from(hosts);
}

function normalizeUrlPath(rawUrl: string | undefined): string {
  if (!rawUrl) return '/';
  const rawPath = rawUrl.split('?')[0].split('#')[0];
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return rawPath.toLowerCase();
  }
  return path.posix.normalize(decoded.replace(/\\/g, '/')).toLowerCase();
}

function tunnelSecurityPlugin(): Plugin {
  let cachedConstantsProfiles = { defaultAllow: [] as string[], gamedayAllow: [] as string[] };
  let lastConstantsMtime = 0;
  let lastMatchBlockCheckTime = 0;
  let isLiveMatchBlockActive = false;
  let consecutiveProbeFailures = 0;
  let pinnedWarpRule: { rule: string; expiresAt: number } | null = null;
  const WARP_PIN_TTL_MS = 4 * 60 * 60 * 1000;

  function checkIspMatchBlockLive(): void {
    const now = Date.now();
    if (now - lastMatchBlockCheckTime < 60000) return;
    lastMatchBlockCheckTime = now;

    const req = https.request('https://188.114.96.5', { timeout: 1500 }, () => {
      consecutiveProbeFailures = 0;
      if (isLiveMatchBlockActive) {
        console.log(`\x1b[32m[Match-Day Ended] Spanish ISP block lifted. Reverted to DEFAULT_ALLOW_LIST.\x1b[0m`);
      }
      isLiveMatchBlockActive = false;
      pinnedWarpRule = null;
    });
    req.on('timeout', () => {
      req.destroy(new Error('ETIMEDOUT'));
    });
    req.on('error', (err: Error & { code?: string }) => {
      const certIntercepted =
        Boolean(err?.message?.includes('self-signed')) || err?.code === 'DEPTH_ZERO_SELF_SIGNED_CERT';
      const resetOrTimeout = err?.code === 'ECONNRESET' || err?.message === 'ETIMEDOUT';

      if (certIntercepted) {
        consecutiveProbeFailures = 2;
      } else if (resetOrTimeout) {
        consecutiveProbeFailures += 1;
      } else {
        consecutiveProbeFailures = 0;
      }

      const isActive = certIntercepted || consecutiveProbeFailures >= 2;
      if (isActive && !isLiveMatchBlockActive) {
        console.log(`\x1b[33m[ISP Match-Day Block Detected]\x1b[0m Auto-activated adaptive GAMEDAY_ALLOW_LIST.\x1b[0m`);
      }
      if (!isActive) {
        pinnedWarpRule = null;
      }
      isLiveMatchBlockActive = isActive;
    });
    req.end();
  }

  function loadConstantsProfiles(): void {
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
  }

  return {
    name: 'tunnel-security-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const cfIp = ((req.headers['cf-connecting-ip'] || '') as string).trim();
        const isTunnelTraffic = Boolean(cfIp || req.headers['cf-ray']);
        const tunnelAllowedIps = process.env.TUNNEL_ALLOWED_IPS;

        // 0. Enforce Cloudflare Tunnel IP Whitelist (fail-closed if unexpected tunnel headers arrive)
        if (isTunnelTraffic && !tunnelAllowedIps) {
          console.warn(`\x1b[31m[Tunnel Hard-Drop] Unexpected Cloudflare header while tunnel mode is inactive -> Socket Terminated\x1b[0m`);
          req.socket?.destroy();
          return;
        }

        if (tunnelAllowedIps && cfIp) {
          if (tunnelAllowedIps === '*') {
            if (req.url === '/' || (!req.url?.startsWith('/@') && !req.url?.includes('.'))) {
              console.log(`\x1b[32m[Tunnel Ingress - Public] Allowed IP: ${cfIp} (Path: ${req.url})\x1b[0m`);
            }
          } else {
            loadConstantsProfiles();
            const baseAllowedList = tunnelAllowedIps.split(',').map((s) => s.trim()).filter(Boolean);
            const nonGamedayList = Array.from(new Set([...baseAllowedList, ...cachedConstantsProfiles.defaultAllow]));

            let allowed = isIpAllowed(cfIp, nonGamedayList);

            if (!allowed && isLiveMatchBlockActive && isCloudflareWarpIp(cfIp)) {
              const now = Date.now();
              if (pinnedWarpRule && pinnedWarpRule.expiresAt > now) {
                allowed = isIpAllowed(cfIp, [pinnedWarpRule.rule]);
              } else if (isIpAllowed(cfIp, cachedConstantsProfiles.gamedayAllow)) {
                const v6Prefix = getIpv6Prefix64(cfIp);
                const rule = v6Prefix ? `${v6Prefix}::/64` : `${cfIp}/32`;
                pinnedWarpRule = { rule, expiresAt: now + WARP_PIN_TTL_MS };
                allowed = true;
                console.log(`\x1b[36m[WARP Session Pinned]\x1b[0m Locked match-day tunnel session to ${rule} for 4h.`);
              }
            }

            if (!allowed) {
              const userAgent = (req.headers['user-agent'] || 'Unknown-Agent') as string;
              console.warn(`\x1b[31m[Tunnel Hard-Drop] Unauthorized IP: ${cfIp} | Method: ${req.method} | Path: ${req.url} | Agent: "${userAgent}" -> Socket Terminated\x1b[0m`);
              req.socket?.destroy();
              return;
            } else if (req.url === '/' || (!req.url?.startsWith('/@') && !req.url?.includes('.'))) {
              console.log(`\x1b[32m[Tunnel Ingress - Whitelist Match] Allowed IP: ${cfIp} (Path: ${req.url})\x1b[0m`);
            }
          }
        }

        // 1. Block direct HTTP reads of non-UI server/storage/config paths in Vite dev server
        const normPath = normalizeUrlPath(req.url);
        if (
          normPath === '/.esedre' ||
          normPath.startsWith('/.esedre/') ||
          normPath.startsWith('/src/server/') ||
          normPath.startsWith('/src/storage/') ||
          normPath.startsWith('/src/mcp/') ||
          normPath.startsWith('/src/sync/') ||
          normPath.startsWith('/tools/') ||
          normPath.startsWith('/scripts/')
        ) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Forbidden');
          return;
        }

        const configuredAllowedHosts = resolveAllowedHosts();
        const hostHeader = (
          isTunnelTraffic ? req.headers['x-forwarded-host'] || req.headers['host'] : req.headers['host']
        ) as string | undefined;
        const hostname = (hostHeader || '').split(',')[0].split(':')[0].toLowerCase().trim();
        const isDevHost =
          configuredAllowedHosts.includes(hostname) ||
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname === '::1' ||
          !!tunnelAllowedIps;

        if (isDevHost) {
          // Zero-Crawl & Anti-Indexing: enforce X-Robots-Tag on all dev responses
          res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');

          // Virtual robots.txt with strict zero-crawl disallow
          if (req.url === '/robots.txt') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
            res.end('User-agent: *\nDisallow: /\n');
            return;
          }

          // Suppress sitemaps on dev tunnel hosts
          if (req.url === '/sitemap.xml' || req.url?.startsWith('/sitemap')) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
            res.end('Not Found');
            return;
          }
        }

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        next();
      });
    },
    transformIndexHtml(html, ctx) {
      if (ctx.server) {
        return html.replace(
          '</head>',
          '  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex" />\n  </head>'
        );
      }
      return html;
    },
  };
}

export default defineConfig({
  plugins: [tunnelSecurityPlugin(), react(), tailwindcss(), esedreApiPlugin()],
  root: path.resolve(__dirname),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5674,
    allowedHosts: resolveAllowedHosts(),
    fs: {
      strict: true,
      allow: [
        path.resolve(__dirname, 'index.html'),
        path.resolve(__dirname, 'src/ui'),
        path.resolve(__dirname, 'src/embed'),
        path.resolve(__dirname, 'public'),
        path.resolve(__dirname, 'node_modules'),
      ],
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem,key}',
        '**/.git/**',
        '**/.esedre/**',
        '**/src/server/**',
        '**/src/storage/**',
        '**/src/mcp/**',
        '**/src/sync/**',
        '**/tools/**',
        '**/scripts/**',
      ],
    },
  },
});

