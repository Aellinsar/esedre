import fs from 'node:fs';
import path from 'node:path';
import { MAX_PROJECT_CODE_LENGTH } from '../config.js';

export type ManifestType = 'gradle' | 'maven' | 'node' | 'rust' | 'python' | 'go' | 'directory';

export interface DetectedManifest {
  candidateCode: string;
  candidateName: string;
  manifestType: ManifestType;
  manifestFile?: string;
}

function sanitizeCode(input: string): string {
  const clean = input.replace(/[^a-zA-Z0-9]/g, '');
  return clean.slice(0, MAX_PROJECT_CODE_LENGTH) || 'APP';
}

/**
 * Inspects a directory to detect the project name and suggested project code
 * from standard manifests (Gradle, Maven, Node, Rust, Python, Go) without requiring Node.
 */
export function detectProjectManifest(targetDir: string): DetectedManifest {
  const dirBase = path.basename(targetDir);

  // 1. Android / Gradle (settings.gradle.kts or settings.gradle)
  for (const settingsFile of ['settings.gradle.kts', 'settings.gradle']) {
    const fullPath = path.join(targetDir, settingsFile);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const match = content.match(/rootProject\.name\s*=\s*["']([^"']+)["']/);
        if (match && match[1].trim()) {
          const rawName = match[1].trim();
          return {
            candidateCode: sanitizeCode(rawName),
            candidateName: rawName,
            manifestType: 'gradle',
            manifestFile: settingsFile,
          };
        }
      } catch {}
    }
  }

  // 1b. Android build.gradle namespace / applicationId fallback
  for (const buildFile of [
    path.join('app', 'build.gradle.kts'),
    'build.gradle.kts',
    path.join('app', 'build.gradle'),
    'build.gradle',
  ]) {
    const fullPath = path.join(targetDir, buildFile);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const match = content.match(/(?:namespace|applicationId)\s*=\s*["']([^"']+)["']/);
        if (match && match[1].trim()) {
          const ns = match[1].trim();
          const lastSegment = ns.split('.').pop() || dirBase;
          const candidateName = lastSegment.charAt(0).toUpperCase() + lastSegment.slice(1);
          return {
            candidateCode: sanitizeCode(candidateName),
            candidateName,
            manifestType: 'gradle',
            manifestFile: buildFile,
          };
        }
      } catch {}
    }
  }

  // 2. Maven (pom.xml)
  const pomPath = path.join(targetDir, 'pom.xml');
  if (fs.existsSync(pomPath)) {
    try {
      const content = fs.readFileSync(pomPath, 'utf-8');
      const stripped = content.replace(/<!--[\s\S]*?-->/g, '').replace(/<parent>[\s\S]*?<\/parent>/g, '');
      const nameMatch = stripped.match(/<name>\s*([^<]+)\s*<\/name>/);
      const artifactMatch = stripped.match(/<artifactId>\s*([^<]+)\s*<\/artifactId>/) || content.match(/<artifactId>\s*([^<]+)\s*<\/artifactId>/);
      let rawName = nameMatch?.[1]?.trim();
      if (!rawName || rawName.startsWith('${')) {
        rawName = artifactMatch?.[1]?.trim();
      }
      if (rawName) {
        return {
          candidateCode: sanitizeCode(rawName),
          candidateName: rawName,
          manifestType: 'maven',
          manifestFile: 'pom.xml',
        };
      }
    } catch {}
  }

  // 3. Node.js (package.json)
  const pkgPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.name && typeof pkg.name === 'string') {
        const baseName = pkg.name.replace(/^@[\w-]+\//, '');
        return {
          candidateCode: sanitizeCode(baseName),
          candidateName: baseName,
          manifestType: 'node',
          manifestFile: 'package.json',
        };
      }
    } catch {}
  }

  // 3. Rust (Cargo.toml)
  const cargoPath = path.join(targetDir, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    try {
      const content = fs.readFileSync(cargoPath, 'utf-8');
      const match = content.match(/\[package\][\s\S]*?name\s*=\s*["']([^"']+)["']/);
      if (match && match[1].trim()) {
        const rawName = match[1].trim();
        return {
          candidateCode: sanitizeCode(rawName),
          candidateName: rawName,
          manifestType: 'rust',
          manifestFile: 'Cargo.toml',
        };
      }
    } catch {}
  }

  // 4. Python (pyproject.toml, setup.cfg, setup.py)
  const pyprojectPath = path.join(targetDir, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf-8');
      const match = content.match(/name\s*=\s*["']([^"']+)["']/);
      if (match && match[1].trim()) {
        const rawName = match[1].trim();
        return {
          candidateCode: sanitizeCode(rawName),
          candidateName: rawName,
          manifestType: 'python',
          manifestFile: 'pyproject.toml',
        };
      }
    } catch {}
  }

  const setupCfgPath = path.join(targetDir, 'setup.cfg');
  if (fs.existsSync(setupCfgPath)) {
    try {
      const content = fs.readFileSync(setupCfgPath, 'utf-8');
      const match = content.match(/^name\s*=\s*([^\r\n]+)/m);
      if (match && match[1].trim()) {
        const rawName = match[1].trim();
        return {
          candidateCode: sanitizeCode(rawName),
          candidateName: rawName,
          manifestType: 'python',
          manifestFile: 'setup.cfg',
        };
      }
    } catch {}
  }

  const setupPyPath = path.join(targetDir, 'setup.py');
  if (fs.existsSync(setupPyPath)) {
    try {
      const content = fs.readFileSync(setupPyPath, 'utf-8');
      const match = content.match(/name\s*=\s*["']([^"']+)["']/);
      if (match && match[1].trim()) {
        const rawName = match[1].trim();
        return {
          candidateCode: sanitizeCode(rawName),
          candidateName: rawName,
          manifestType: 'python',
          manifestFile: 'setup.py',
        };
      }
    } catch {}
  }

  // 5. Go (go.mod)
  const goModPath = path.join(targetDir, 'go.mod');
  if (fs.existsSync(goModPath)) {
    try {
      const content = fs.readFileSync(goModPath, 'utf-8');
      const match = content.match(/^module\s+([^\r\n\s]+)/m);
      if (match && match[1].trim()) {
        const modPath = match[1].trim();
        const baseName = modPath.split('/').pop() || dirBase;
        return {
          candidateCode: sanitizeCode(baseName),
          candidateName: baseName,
          manifestType: 'go',
          manifestFile: 'go.mod',
        };
      }
    } catch {}
  }

  // 6. Fallback to directory basename
  return {
    candidateCode: sanitizeCode(dirBase),
    candidateName: dirBase,
    manifestType: 'directory',
  };
}
