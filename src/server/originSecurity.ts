import http from 'node:http';
import os from 'node:os';

const PRIVATE_HOSTNAME_SUFFIXES = [
  '.local',
  '.lan',
  '.internal',
  '.home',
  '.home.arpa',
  '.localdomain',
  '.ts.net',
];

function stripBrackets(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function parseIpv4Octets(hostname: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    return null;
  }
  const parts = hostname.split('.').map(Number);
  if (parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return null;
  }
  return parts;
}

export function isPrivateIpv4(hostname: string): boolean {
  const octets = parseIpv4Octets(hostname);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 RFC1918
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 RFC1918
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT / Tailscale
  return false;
}

export function isPrivateIpv6(rawHost: string): boolean {
  const host = stripBrackets(rawHost.trim().toLowerCase());
  if (!host.includes(':')) return false;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (host.startsWith('::ffff:')) {
    return isPrivateIpv4(host.slice('::ffff:'.length));
  }
  // Unique Local (fc00::/7 -> fc.. or fd..) and Link-Local (fe80::/10)
  if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  return false;
}

/**
 * Returns true if hostname belongs to loopback, RFC1918/Tailscale LAN IP space,
 * single-label LAN hostnames (e.g. 'eris-2003ub313'), or local mDNS/LAN suffixes.
 */
export function isPrivateOrLocalHost(rawHostname: string): boolean {
  const host = stripBrackets(rawHostname.trim().toLowerCase()).replace(/\.$/, '');
  if (!host) return false;

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }

  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    return true;
  }

  // Single-label LAN machine hostnames (no dots, e.g. http://eris-2003ub313:5674 or http://quaoar:3000)
  if (!host.includes('.') && !host.includes(':') && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) {
    return true;
  }

  const localMachine = os.hostname().trim().toLowerCase();
  if (localMachine && host === localMachine) {
    return true;
  }

  return PRIVATE_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function parseHostHeaderAuthority(rawHeader: string | undefined): { host: string; hostname: string; port: string } | null {
  if (!rawHeader) return null;
  const first = rawHeader.split(',')[0].trim().toLowerCase();
  if (!first) return null;
  try {
    const parsed = new URL(`http://${first}`);
    return {
      host: parsed.host.toLowerCase(),
      hostname: stripBrackets(parsed.hostname.toLowerCase()),
      port: parsed.port,
    };
  } catch {
    return null;
  }
}

function matchesConfiguredOrigin(originUrl: URL, configuredOrigins: string[]): boolean {
  const normalizedOrigin = originUrl.origin.toLowerCase();
  const originHost = stripBrackets(originUrl.hostname.toLowerCase());

  for (const rawRule of configuredOrigins) {
    const rule = rawRule.trim().toLowerCase();
    if (!rule) continue;
    if (rule === '*') return true;

    // Exact origin match (e.g. https://docs.example.com or http://example.com:8080)
    if (rule === normalizedOrigin || rule.replace(/\/+$/, '') === normalizedOrigin) {
      return true;
    }

    // Scheme + wildcard subdomain (e.g. https://*.example.com)
    const schemeWildcard = rule.match(/^(https?):\/\/\*\.(.+)$/);
    if (schemeWildcard) {
      const [, scheme, baseDomain] = schemeWildcard;
      if (
        originUrl.protocol === `${scheme}:` &&
        (originHost === baseDomain || originHost.endsWith(`.${baseDomain}`))
      ) {
        return true;
      }
      continue;
    }

    // Bare wildcard domain (e.g. *.example.com)
    if (rule.startsWith('*.')) {
      const baseDomain = rule.slice(2);
      if (originHost === baseDomain || originHost.endsWith(`.${baseDomain}`)) {
        return true;
      }
      continue;
    }

    // Bare hostname match (e.g. docs.example.com)
    if (!rule.includes('://') && originHost === rule) {
      return true;
    }
  }

  return false;
}

export function isTrustedBrowserOrigin(
  rawOrigin: string,
  req: http.IncomingMessage,
  configuredOrigins: string[] = []
): boolean {
  const trimmed = rawOrigin.trim();
  if (!trimmed) return false;

  if (configuredOrigins.some((o) => o.trim() === '*')) {
    return true;
  }

  // Sandboxed iframes and data: URLs send literal 'null' - never trust unless '*' is configured
  if (trimmed.toLowerCase() === 'null') {
    return false;
  }

  let originUrl: URL;
  try {
    originUrl = new URL(trimmed);
  } catch {
    return false;
  }

  if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') {
    return false;
  }

  if (matchesConfiguredOrigin(originUrl, configuredOrigins)) {
    return true;
  }

  const originHostname = stripBrackets(originUrl.hostname.toLowerCase());
  if (isPrivateOrLocalHost(originHostname)) {
    return true;
  }

  // Same-origin behind a reverse proxy (e.g. https://planner.example.com or http://planner.example.com)
  const effectiveAuthority =
    parseHostHeaderAuthority(req.headers['x-forwarded-host'] as string | undefined) ||
    parseHostHeaderAuthority(req.headers.host);

  if (effectiveAuthority && originUrl.host.toLowerCase() === effectiveAuthority.host) {
    const forwardedProto = ((req.headers['x-forwarded-proto'] as string | undefined) || '')
      .split(',')[0]
      .trim()
      .toLowerCase();

    // Guard against DNS rebinding against plaintext HTTP on non-standard ports (e.g. http://evil.com:5674 -> 127.0.0.1:5674)
    const isSuspiciousPlaintextCustomPort =
      originUrl.protocol === 'http:' && originUrl.port !== '' && forwardedProto !== 'https';

    if (!isSuspiciousPlaintextCustomPort) {
      return true;
    }
  }

  return false;
}

export type ApiSecurityDecision =
  | { allowed: true; corsHeaders: Record<string, string> }
  | { allowed: false; status: number; error: string };

/**
 * Multi-layered browser CORS, Sec-Fetch-Site, DNS-rebinding, and Content-Type CSRF gate.
 */
export function evaluateApiRequestSecurity(
  req: http.IncomingMessage,
  configuredOrigins: string[] = []
): ApiSecurityDecision {
  const method = (req.method || 'GET').toUpperCase();
  const isMutation = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
  const wildcardConfigured = configuredOrigins.some((o) => o.trim() === '*');

  const rawOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  const secFetchSite =
    typeof req.headers['sec-fetch-site'] === 'string'
      ? req.headers['sec-fetch-site'].trim().toLowerCase()
      : '';
  const hasSecFetchMetadata = Boolean(
    secFetchSite || req.headers['sec-fetch-mode'] || req.headers['sec-fetch-dest']
  );

  // 1. Unspoofable Browser Sec-Fetch-Site Gate:
  // Modern browsers attach Sec-Fetch-Site to every fetch/form/navigation request, and JS cannot strip or forge it.
  // Even if Origin was omitted via Referrer-Policy: no-referrer, cross-site browser requests are caught here.
  if (!wildcardConfigured && (secFetchSite === 'cross-site' || secFetchSite === 'same-site')) {
    if (!rawOrigin || !isTrustedBrowserOrigin(rawOrigin, req, configuredOrigins)) {
      return {
        allowed: false,
        status: 403,
        error: 'Cross-site browser request blocked by Esedre origin policy.',
      };
    }
  }

  // 2. Explicit Origin Header Gate (covers preflights, XHR/fetch, and Origin: null):
  if (rawOrigin) {
    if (isTrustedBrowserOrigin(rawOrigin, req, configuredOrigins)) {
      const allowOrigin = wildcardConfigured && rawOrigin.toLowerCase() === 'null' ? '*' : rawOrigin;
      return {
        allowed: true,
        corsHeaders: {
          'Access-Control-Allow-Origin': allowOrigin,
          Vary: 'Origin',
        },
      };
    }
    return {
      allowed: false,
      status: 403,
      error: `Origin '${rawOrigin}' is not authorized to access the Esedre API.`,
    };
  }

  // 3. DNS Rebinding Gate for Same-Origin Browser Requests without Origin (e.g. GET fetch on rebound domain:5674):
  if (!wildcardConfigured && hasSecFetchMetadata) {
    const effectiveAuthority =
      parseHostHeaderAuthority(req.headers['x-forwarded-host'] as string | undefined) ||
      parseHostHeaderAuthority(req.headers.host);

    if (effectiveAuthority && !isPrivateOrLocalHost(effectiveAuthority.hostname)) {
      const forwardedProto = ((req.headers['x-forwarded-proto'] as string | undefined) || '')
        .split(',')[0]
        .trim()
        .toLowerCase();
      const syntheticOrigin = `${forwardedProto === 'https' ? 'https' : 'http'}://${effectiveAuthority.host}`;
      if (!isTrustedBrowserOrigin(syntheticOrigin, req, configuredOrigins)) {
        return {
          allowed: false,
          status: 403,
          error: `Host '${effectiveAuthority.host}' is not authorized for direct browser API access.`,
        };
      }
    }
  }

  // 4. Missing-Origin Mutation Gate (blocks <form method="POST"> with Referrer-Policy: no-referrer):
  // Browsers cannot send Content-Type: application/json cross-origin without triggering a CORS preflight (which carries Origin).
  if (isMutation) {
    const contentType = ((req.headers['content-type'] || '') as string).trim().toLowerCase();
    if (!contentType.startsWith('application/json')) {
      return {
        allowed: false,
        status: 415,
        error: 'Unsupported Media Type: state-changing API requests require Content-Type: application/json.',
      };
    }
  }

  return {
    allowed: true,
    corsHeaders: wildcardConfigured ? { 'Access-Control-Allow-Origin': '*' } : {},
  };
}
