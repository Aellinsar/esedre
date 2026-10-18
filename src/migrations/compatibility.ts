import { ProjectDescriptor, CURRENT_ESEDRE_VERSION } from '../types.js';
import {
  CURRENT_DATA_VERSION,
  MIN_SUPPORTED_DATA_VERSION,
  FEATURE_MIN_SCHEMA_VERSION,
  compareVersions,
  normalizeVersion,
} from './versions.js';

export type VersionIncompatibilityReason =
  | 'BELOW_MIN_SUPPORTED'
  | 'ABOVE_CURRENT_ENGINE'
  | 'FEATURE_REQUIRES_UPGRADE';

export interface EsedreVersionErrorInit {
  projectCode: string;
  currentSchemaVersion: string;
  requiredSchemaVersion: string;
  reason: VersionIncompatibilityReason;
  featureName?: string;
}

/**
 * Thrown when a project's on-disk schemaVersion is incompatible with the requested operation
 * or feature. Provides explicit instructions for both developers and LLM agents on how to
 * upgrade the target project or contact the project owner in multi-owner setups.
 */
export class EsedreVersionError extends Error {
  public readonly projectCode: string;
  public readonly currentSchemaVersion: string;
  public readonly requiredSchemaVersion: string;
  public readonly reason: VersionIncompatibilityReason;
  public readonly featureName?: string;

  constructor(init: EsedreVersionErrorInit) {
    const { projectCode, currentSchemaVersion, requiredSchemaVersion, reason, featureName } = init;
    let message: string;

    if (reason === 'FEATURE_REQUIRES_UPGRADE') {
      const featureLabel = featureName || 'this feature';
      message =
        `Project '${projectCode}' does not yet support ${featureLabel} because its Esedre data is on schema v${currentSchemaVersion} ` +
        `(schema v${requiredSchemaVersion}+ required). Run 'ese upgrade --project ${projectCode}' or speak to the project owner about ` +
        `upgrading Esedre in the '${projectCode}' repository.`;
    } else if (reason === 'BELOW_MIN_SUPPORTED') {
      message =
        `Project '${projectCode}' is on legacy Esedre schema v${currentSchemaVersion}, which is below the minimum supported schema v${requiredSchemaVersion}. ` +
        `Run 'ese upgrade --project ${projectCode}' (or 'ese upgrade' in the '${projectCode}' repository) before modifying this project.`;
    } else {
      message =
        `Project '${projectCode}' is on Esedre schema v${currentSchemaVersion}, which is newer than the locally installed Esedre engine ` +
        `(supports up to schema v${requiredSchemaVersion}, engine v${CURRENT_ESEDRE_VERSION}). Please upgrade your local Esedre CLI installation before modifying '${projectCode}'.`;
    }

    super(message);
    this.name = 'EsedreVersionError';
    this.projectCode = projectCode;
    this.currentSchemaVersion = currentSchemaVersion;
    this.requiredSchemaVersion = requiredSchemaVersion;
    this.reason = reason;
    this.featureName = featureName;
  }
}

/**
 * Resolve the effective schemaVersion of a project descriptor, defaulting to '1.0.0' for legacy projects.
 */
export function getProjectSchemaVersion(project?: Partial<ProjectDescriptor> | null): string {
  return normalizeVersion(project?.schemaVersion, '1.0.0');
}

export interface CompatibilityCheckOptions {
  /**
   * Operation mode: 'read' allows inspecting older/newer schemas non-destructively unless a specific
   * feature requirement is requested; 'write' enforces both the hard floor and forward version guard.
   */
  operation?: 'read' | 'write';
  /**
   * Optional feature key (looked up in FEATURE_MIN_SCHEMA_VERSION) or display label.
   */
  feature?: string;
  /**
   * Optional explicit minimum schemaVersion required for the requested feature/operation.
   */
  minSchemaVersion?: string;
  /**
   * Optional override for MIN_SUPPORTED_DATA_VERSION (used in testing or specialized checks).
   */
  minSupportedVersion?: string;
  /**
   * Optional override for CURRENT_DATA_VERSION (used in testing or specialized checks).
   */
  currentEngineDataVersion?: string;
}

export interface ProjectCompatibilityStatus {
  compatible: boolean;
  projectCode: string;
  schemaVersion: string;
  esedreVersion?: string;
  needsUpgrade: boolean;
  isNewerThanEngine: boolean;
  isBelowHardFloor: boolean;
  reason?: VersionIncompatibilityReason;
  requiredSchemaVersion?: string;
  error?: EsedreVersionError;
}

/**
 * Evaluate compatibility of a project's on-disk data schema against the current Esedre engine
 * and any feature-specific schema version requirement.
 */
export function checkProjectCompatibility(
  project: Pick<ProjectDescriptor, 'code'> & Partial<ProjectDescriptor>,
  options: CompatibilityCheckOptions = {}
): ProjectCompatibilityStatus {
  const operation = options.operation || 'write';
  const minSupported = normalizeVersion(options.minSupportedVersion, MIN_SUPPORTED_DATA_VERSION);
  const currentEngine = normalizeVersion(options.currentEngineDataVersion, CURRENT_DATA_VERSION);
  const schemaVersion = getProjectSchemaVersion(project);
  const projectCode = project.code || 'UNKNOWN';

  const needsUpgrade = compareVersions(schemaVersion, currentEngine) < 0;
  const isNewerThanEngine = compareVersions(schemaVersion, currentEngine) > 0;
  const isBelowHardFloor = compareVersions(schemaVersion, minSupported) < 0;

  if (operation === 'write') {
    if (isNewerThanEngine) {
      const error = new EsedreVersionError({
        projectCode,
        currentSchemaVersion: schemaVersion,
        requiredSchemaVersion: currentEngine,
        reason: 'ABOVE_CURRENT_ENGINE',
      });
      return {
        compatible: false,
        projectCode,
        schemaVersion,
        esedreVersion: project.esedreVersion,
        needsUpgrade,
        isNewerThanEngine,
        isBelowHardFloor,
        reason: 'ABOVE_CURRENT_ENGINE',
        requiredSchemaVersion: currentEngine,
        error,
      };
    }

    if (isBelowHardFloor) {
      const error = new EsedreVersionError({
        projectCode,
        currentSchemaVersion: schemaVersion,
        requiredSchemaVersion: minSupported,
        reason: 'BELOW_MIN_SUPPORTED',
      });
      return {
        compatible: false,
        projectCode,
        schemaVersion,
        esedreVersion: project.esedreVersion,
        needsUpgrade,
        isNewerThanEngine,
        isBelowHardFloor,
        reason: 'BELOW_MIN_SUPPORTED',
        requiredSchemaVersion: minSupported,
        error,
      };
    }
  }

  // Feature capability gate check (applies to both read and write when a feature is requested)
  const registeredFeature = options.feature ? FEATURE_MIN_SCHEMA_VERSION[options.feature] : undefined;
  const requiredFeatureVersion = options.minSchemaVersion || registeredFeature?.minSchemaVersion;
  const featureDisplayName = registeredFeature?.displayName || options.feature;

  if (requiredFeatureVersion && compareVersions(schemaVersion, requiredFeatureVersion) < 0) {
    const cleanReq = normalizeVersion(requiredFeatureVersion, '1.0.0');
    const error = new EsedreVersionError({
      projectCode,
      currentSchemaVersion: schemaVersion,
      requiredSchemaVersion: cleanReq,
      reason: 'FEATURE_REQUIRES_UPGRADE',
      featureName: featureDisplayName,
    });
    return {
      compatible: false,
      projectCode,
      schemaVersion,
      esedreVersion: project.esedreVersion,
      needsUpgrade,
      isNewerThanEngine,
      isBelowHardFloor,
      reason: 'FEATURE_REQUIRES_UPGRADE',
      requiredSchemaVersion: cleanReq,
      error,
    };
  }

  return {
    compatible: true,
    projectCode,
    schemaVersion,
    esedreVersion: project.esedreVersion,
    needsUpgrade,
    isNewerThanEngine,
    isBelowHardFloor,
  };
}

/**
 * Assert that a project's on-disk data schema is compatible with the requested operation/feature,
 * throwing EsedreVersionError if an upgrade is required or if the project is newer than the local CLI.
 */
export function assertProjectCompatible(
  project: Pick<ProjectDescriptor, 'code'> & Partial<ProjectDescriptor>,
  options: CompatibilityCheckOptions = {}
): ProjectCompatibilityStatus {
  const status = checkProjectCompatibility(project, options);
  if (!status.compatible && status.error) {
    throw status.error;
  }
  return status;
}
