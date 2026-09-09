/**
 * IP Matching and Subnet validation utilities for Cloudflare Tunnel dev runner.
 */

export function normalizeIpv6(ip: string): string | null {
  const cleanIp = ip.trim().toLowerCase();
  if (!cleanIp.includes(':')) return null;

  // Cannot have ':::' or multiple '::'
  if (cleanIp.includes(':::') || (cleanIp.match(/::/g) || []).length > 1) {
    return null;
  }

  const halves = cleanIp.split('::');

  let leftParts = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  let rightParts = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];

  if (halves.length === 2) {
    const missing = 8 - (leftParts.length + rightParts.length);
    if (missing < 0) return null;
    const middle = Array(missing).fill('0');
    leftParts = [...leftParts, ...middle, ...rightParts];
  }

  if (leftParts.length !== 8) return null;

  const hexRegex = /^[0-9a-f]{1,4}$/i;
  for (const part of leftParts) {
    if (!hexRegex.test(part)) return null;
  }

  return leftParts.map((p) => p.padStart(4, '0')).join(':');
}

export function getIpv6Prefix64(ip: string): string | null {
  const norm = normalizeIpv6(ip);
  if (!norm) return null;
  return norm.split(':').slice(0, 4).join(':');
}

export function ipv6ToBigInt(ip: string): bigint | null {
  const norm = normalizeIpv6(ip);
  if (!norm) return null;
  const parts = norm.split(':');
  let result = 0n;
  for (const part of parts) {
    result = (result << 16n) | BigInt(parseInt(part, 16));
  }
  return result;
}

export function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return null;
  let result = 0n;
  for (const part of parts) {
    result = (result << 8n) | BigInt(part);
  }
  return result;
}

export function isIpInCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes('/')) return false;
  const [netStr, prefixStr] = cidr.split('/');
  const prefixLen = parseInt(prefixStr, 10);
  if (isNaN(prefixLen)) return false;

  if (ip.includes(':') && netStr.includes(':')) {
    if (prefixLen < 0 || prefixLen > 128) return false;
    const ipInt = ipv6ToBigInt(ip);
    const netInt = ipv6ToBigInt(netStr);
    if (ipInt === null || netInt === null) return false;
    if (prefixLen === 0) return true;
    const shift = 128n - BigInt(prefixLen);
    return (ipInt >> shift) === (netInt >> shift);
  } else if (!ip.includes(':') && !netStr.includes(':')) {
    if (prefixLen < 0 || prefixLen > 32) return false;
    const ipInt = ipv4ToBigInt(ip);
    const netInt = ipv4ToBigInt(netStr);
    if (ipInt === null || netInt === null) return false;
    if (prefixLen === 0) return true;
    const shift = 32n - BigInt(prefixLen);
    return (ipInt >> shift) === (netInt >> shift);
  }

  return false;
}

/**
 * Extracts valid quoted IP address or CIDR strings (IPv4 or IPv6) from source code or config text.
 */
export function extractIpsFromText(content: string): string[] {
  const ips = new Set<string>();
  const matches = content.matchAll(/['"]\s*([0-9a-fA-F:./]+)\s*['"]/g);
  for (const m of matches) {
    const candidate = m[1].trim();
    if (candidate.includes('.') || candidate.includes(':')) {
      ips.add(candidate);
    }
  }
  return Array.from(ips);
}

/**
 * Extracts DEFAULT_ALLOW_LIST and GAMEDAY_ALLOW_LIST arrays from constants.js source text.
 */
export function extractListsFromText(content: string): { defaultAllow: string[]; gamedayAllow: string[] } {
  const defaultAllow: string[] = [];
  const gamedayAllow: string[] = [];

  const defaultMatch = content.match(/export\s+const\s+DEFAULT_ALLOW_LIST\s*=\s*\[([\s\S]*?)\];/);
  if (defaultMatch && defaultMatch[1]) {
    defaultAllow.push(...extractIpsFromText(defaultMatch[1]));
  }

  const gamedayMatch = content.match(/export\s+const\s+GAMEDAY_ALLOW_LIST\s*=\s*\[([\s\S]*?)\];/);
  if (gamedayMatch && gamedayMatch[1]) {
    gamedayAllow.push(...extractIpsFromText(gamedayMatch[1]));
  }

  return { defaultAllow, gamedayAllow };
}

/**
 * Validates whether clientIp is permitted under the allowedIps list.
 */
export function isIpAllowed(clientIp: string | undefined | null, allowedIps: string[]): boolean {
  if (!clientIp) return false;
  const cleanClient = clientIp.trim();
  if (!cleanClient) return false;

  // Always permit loopback / local origin
  if (['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1'].includes(cleanClient.toLowerCase())) {
    return true;
  }

  for (const allowed of allowedIps) {
    const cleanAllowed = allowed.trim();
    if (!cleanAllowed) continue;
    if (cleanAllowed === '*') return true;

    // CIDR range matching (e.g. 2a09:bac0::/28 or 192.168.1.0/24)
    if (cleanAllowed.includes('/')) {
      if (isIpInCidr(cleanClient, cleanAllowed)) {
        return true;
      }
      continue;
    }

    // Exact match (IPv4 and exact IPv6)
    if (cleanClient.toLowerCase() === cleanAllowed.toLowerCase()) {
      return true;
    }

    // IPv6 /64 prefix match
    const clientPrefix = getIpv6Prefix64(cleanClient);
    const allowedPrefix = getIpv6Prefix64(cleanAllowed);
    if (clientPrefix && allowedPrefix && clientPrefix === allowedPrefix) {
      return true;
    }
  }

  return false;
}
