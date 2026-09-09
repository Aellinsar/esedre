/**
 * Development Cloudflare Tunnel Whitelist Constants
 *
 * This file defines the two dynamic whitelist profiles:
 * 1. DEFAULT_ALLOW_LIST: Active during normal conditions (strictly Home IP + static dev IPs).
 * 2. GAMEDAY_ALLOW_LIST: Active automatically ONLY when an ISP match-day block is detected.
 *
 * Note: Vite dev server automatically hot-reloads changes to this file on incoming
 * requests without requiring a server restart.
 */

/**
 * Standard Default Allow List
 * Active when NO ISP match-day block is detected.
 */
export const DEFAULT_ALLOW_LIST = [
  // Static developer IPs (if any) can be placed here
];

/**
 * Game-Day Allow List
 * Activated automatically when an ISP match-day block is actively intercepting Cloudflare Edge.
 * Whitelists Cloudflare 1.1.1.1 (WARP) mobile egress range across Europe.
 */
export const GAMEDAY_ALLOW_LIST = [
  '2a09:bac0::/28', // Cloudflare WARP mobile IPv6 subnet
];
