import { CURRENT_ESEDRE_VERSION } from '../types.js';

export { CURRENT_ESEDRE_VERSION };

/**
 * Current on-disk data schema version for Esedre project directories, tickets, and milestones.
 * Decoupled from CURRENT_ESEDRE_VERSION so CLI/UI patch releases do not force data schema bumps.
 */
export const CURRENT_DATA_VERSION = '1.0.0';

/**
 * Minimum on-disk data schema version that this Esedre engine can mutate without running 'ese upgrade'.
 * Projects below this version are hard-blocked from mutation until upgraded.
 */
export const MIN_SUPPORTED_DATA_VERSION = '1.0.0';

export interface FeatureSchemaRequirement {
  minSchemaVersion: string;
  displayName: string;
}

/**
 * Registry mapping feature keys to the minimum project schemaVersion required to use them.
 * Used by checkProjectCompatibility / assertProjectCompatible when working across disparate
 * project repositories that may be on older Esedre data schemas.
 */
export const FEATURE_MIN_SCHEMA_VERSION: Record<string, FeatureSchemaRequirement> = {
  // Baseline 1.0.0 features
  'ticket-linking': {
    minSchemaVersion: '1.0.0',
    displayName: 'cross-project ticket linking',
  },
  'ticket-leases': {
    minSchemaVersion: '1.0.0',
    displayName: 'ephemeral ticket leases',
  },
  'milestones': {
    minSchemaVersion: '1.0.0',
    displayName: 'project milestones',
  },
};

/**
 * Check if a version string is a valid 3-part SemVer string (e.g. '1.0.0' or 'v1.0.0').
 */
export function isValidVersion(version: string | undefined | null): boolean {
  if (!version || typeof version !== 'string') return false;
  return /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version.trim());
}

/**
 * Normalize a version string by stripping any leading 'v' and falling back to '1.0.0' when absent.
 */
export function normalizeVersion(version: string | undefined | null, fallback = '1.0.0'): string {
  if (!version || typeof version !== 'string') return fallback;
  const cleaned = version.trim().replace(/^v/i, '').split('-')[0];
  if (!/^\d+\.\d+\.\d+$/.test(cleaned)) return fallback;
  return cleaned;
}

/**
 * Compare two SemVer version strings (e.g. '1.0.0' vs '1.1.0').
 * Returns:
 *  -1 if v1 < v2
 *   1 if v1 > v2
 *   0 if v1 === v2
 */
export function compareVersions(v1: string, v2: string): number {
  const clean1 = normalizeVersion(v1, '0.0.0');
  const clean2 = normalizeVersion(v2, '0.0.0');
  const parts1 = clean1.split('.').map((n) => parseInt(n, 10) || 0);
  const parts2 = clean2.split('.').map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < 3; i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  return 0;
}
