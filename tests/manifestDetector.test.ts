import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { detectProjectManifest } from '../src/utils/manifestDetector.js';

describe('Multi-Manifest Project Detection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-manifest-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('detects Android/Gradle project from settings.gradle.kts', () => {
    fs.writeFileSync(
      path.join(tempDir, 'settings.gradle.kts'),
      'rootProject.name = "Alce"\ninclude(":app")\n'
    );

    const res = detectProjectManifest(tempDir);
    expect(res.manifestType).toBe('gradle');
    expect(res.candidateName).toBe('Alce');
    expect(res.candidateCode).toBe('Alce');
    expect(res.manifestFile).toBe('settings.gradle.kts');
  });

  it('detects Android/Gradle project from settings.gradle with single quotes', () => {
    fs.writeFileSync(
      path.join(tempDir, 'settings.gradle'),
      "rootProject.name = 'ReaderApp'\n"
    );

    const res = detectProjectManifest(tempDir);
    expect(res.manifestType).toBe('gradle');
    expect(res.candidateName).toBe('ReaderApp');
    expect(res.candidateCode).toBe('ReaderA');
  });

  it('detects Android project from app/build.gradle.kts namespace', () => {
    const appDir = path.join(tempDir, 'app');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, 'build.gradle.kts'),
      'android {\n  namespace = "com.arwam.alce"\n}\n'
    );

    const res = detectProjectManifest(tempDir);
    expect(res.manifestType).toBe('gradle');
    expect(res.candidateName).toBe('Alce');
    expect(res.candidateCode).toBe('Alce');
  });

  it('detects Maven project from pom.xml using <name>', () => {
    fs.writeFileSync(
      path.join(tempDir, 'pom.xml'),
      '<project>\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>com.arwam</groupId>\n  <artifactId>alce-reader</artifactId>\n  <name>Alce Reader</name>\n</project>\n'
    );

    const res = detectProjectManifest(tempDir);
    expect(res.manifestType).toBe('maven');
    expect(res.candidateName).toBe('Alce Reader');
    expect(res.candidateCode).toBe('AlceRea');
    expect(res.manifestFile).toBe('pom.xml');
  });

  it('detects Maven project with <parent> block without confusing parent artifactId', () => {
    fs.writeFileSync(
      path.join(tempDir, 'pom.xml'),
      `<project>
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.0</version>
  </parent>
  <groupId>com.arwam</groupId>
  <artifactId>esedre-service</artifactId>
</project>`
    );

    const res = detectProjectManifest(tempDir);
    expect(res.manifestType).toBe('maven');
    expect(res.candidateName).toBe('esedre-service');
    expect(res.candidateCode).toBe('esedres');
    expect(res.manifestFile).toBe('pom.xml');
  });

  it('detects Node.js project from package.json and strips npm scope', () => {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: '@arwam/sleep-center' })
    );

    const res = detectProjectManifest(tempDir);
    expect(res.manifestType).toBe('node');
    expect(res.candidateName).toBe('sleep-center');
    expect(res.candidateCode).toBe('sleepce');
    expect(res.manifestFile).toBe('package.json');
  });

  it('detects Rust project from Cargo.toml', () => {
    fs.writeFileSync(
      path.join(tempDir, 'Cargo.toml'),
      '[package]\nname = "fastreader"\nversion = "0.1.0"\n'
    );

    const res = detectProjectManifest(tempDir);
    expect(res.manifestType).toBe('rust');
    expect(res.candidateName).toBe('fastreader');
    expect(res.candidateCode).toBe('fastrea');
    expect(res.manifestFile).toBe('Cargo.toml');
  });

  it('detects Python project from pyproject.toml', () => {
    fs.writeFileSync(
      path.join(tempDir, 'pyproject.toml'),
      '[project]\nname = "analytics-engine"\nversion = "1.0.0"\n'
    );

    const res = detectProjectManifest(tempDir);
    expect(res.manifestType).toBe('python');
    expect(res.candidateName).toBe('analytics-engine');
    expect(res.candidateCode).toBe('analyti');
    expect(res.manifestFile).toBe('pyproject.toml');
  });

  it('detects Go project from go.mod', () => {
    fs.writeFileSync(
      path.join(tempDir, 'go.mod'),
      'module github.com/arwam/microservice\n\ngo 1.21\n'
    );

    const res = detectProjectManifest(tempDir);
    expect(res.manifestType).toBe('go');
    expect(res.candidateName).toBe('microservice');
    expect(res.candidateCode).toBe('microse');
    expect(res.manifestFile).toBe('go.mod');
  });

  it('falls back cleanly to directory basename when no manifest exists', () => {
    const target = path.join(tempDir, 'custom-tool');
    fs.mkdirSync(target, { recursive: true });

    const res = detectProjectManifest(target);
    expect(res.manifestType).toBe('directory');
    expect(res.candidateName).toBe('custom-tool');
    expect(res.candidateCode).toBe('customt');
    expect(res.manifestFile).toBeUndefined();
  });

  it('enforces 7-character limit for project codes (e.g. AlceWeb)', () => {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'AlceWeb' })
    );

    const res = detectProjectManifest(tempDir);
    expect(res.candidateCode.length).toBeLessThanOrEqual(7);
    expect(res.candidateCode).toBe('AlceWeb');
  });
});
