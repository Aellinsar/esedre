import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  findViteConfig,
  getRecommendedViteProxySnippet,
  detectLineEnding,
  injectViteProxy,
  configureViteProxy,
  configureWorkspace,
} from '../src/upgrade.js';

describe('Vite Config Detection & Proxy Injection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-vite-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('findViteConfig', () => {
    it('detects vite.config.ts with highest priority', () => {
      fs.writeFileSync(path.join(tempDir, 'vite.config.ts'), 'export default {}');
      fs.writeFileSync(path.join(tempDir, 'vite.config.js'), 'export default {}');

      const found = findViteConfig(tempDir);
      expect(found).toBe(path.join(tempDir, 'vite.config.ts'));
    });

    it('detects vite.config.js when ts is absent', () => {
      fs.writeFileSync(path.join(tempDir, 'vite.config.js'), 'export default {}');

      const found = findViteConfig(tempDir);
      expect(found).toBe(path.join(tempDir, 'vite.config.js'));
    });

    it('returns null when no Vite config exists', () => {
      expect(findViteConfig(tempDir)).toBeNull();
    });
  });

  describe('getRecommendedViteProxySnippet', () => {
    it('generates proxy snippet targeting given port', () => {
      const snippet = getRecommendedViteProxySnippet(5674);
      expect(snippet).toContain("'/esedre': {");
      expect(snippet).toContain("target: 'http://127.0.0.1:5674'");
      expect(snippet).toContain("rewrite: (path) => path.replace(/^\\/esedre/, '')");
    });
  });

  describe('detectLineEnding', () => {
    it('detects CRLF and LF correctly', () => {
      expect(detectLineEnding('line1\r\nline2')).toBe('\r\n');
      expect(detectLineEnding('line1\nline2')).toBe('\n');
    });
  });

  describe('injectViteProxy', () => {
    it('returns original content if /esedre is already configured', () => {
      const original = `export default { server: { proxy: { '/esedre': { target: 'http://127.0.0.1:5674' } } } };`;
      expect(injectViteProxy(original, 5674)).toBe(original);
    });

    it('injects into existing proxy block', () => {
      const input = `export default defineConfig({
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000' },
    },
  },
});`;
      const result = injectViteProxy(input, 5674);
      expect(result).not.toBeNull();
      expect(result).toContain("'/esedre': {");
      expect(result).toContain("target: 'http://127.0.0.1:5674'");
      expect(result).toContain("'/api': { target: 'http://localhost:8000' }");
    });

    it('injects into existing server block without proxy', () => {
      const input = `export default defineConfig({
  server: {
    port: 3000,
  },
});`;
      const result = injectViteProxy(input, 5674);
      expect(result).not.toBeNull();
      expect(result).toContain('proxy: {');
      expect(result).toContain("'/esedre': {");
      expect(result).toContain("target: 'http://127.0.0.1:5674'");
    });

    it('injects into return object inside defineConfig function', () => {
      const input = `export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';
  return {
    plugins: [react()],
  };
});`;
      const result = injectViteProxy(input, 5674);
      expect(result).not.toBeNull();
      expect(result).toContain('server: {');
      expect(result).toContain('proxy: {');
      expect(result).toContain("'/esedre': {");
    });

    it('injects into bare defineConfig object', () => {
      const input = `export default defineConfig({
  plugins: [react()],
});`;
      const result = injectViteProxy(input, 5674);
      expect(result).not.toBeNull();
      expect(result).toContain('server: {');
      expect(result).toContain("'/esedre': {");
    });

    it('preserves Windows CRLF line endings', () => {
      const input = `export default defineConfig({\r\n  server: {\r\n    port: 3000,\r\n  },\r\n});`;
      const result = injectViteProxy(input, 5674);
      expect(result).not.toBeNull();
      expect(result).toContain('\r\n');
      expect(result).not.toMatch(/[^\r]\n/);
    });
  });

  describe('configureViteProxy', () => {
    it('returns NOT_APPLICABLE if no vite config exists in targetDir', () => {
      const res = configureViteProxy(tempDir, 5674, true);
      expect(res.status).toBe('NOT_APPLICABLE');
      expect(res.recommendedProxySnippet).toContain("'/esedre'");
    });

    it('returns ALREADY_CONFIGURED if /esedre is present in vite.config.ts', () => {
      fs.writeFileSync(
        path.join(tempDir, 'vite.config.ts'),
        `export default { server: { proxy: { '/esedre': { target: 'http://127.0.0.1:5674' } } } };`
      );

      const res = configureViteProxy(tempDir, 5674, true);
      expect(res.status).toBe('ALREADY_CONFIGURED');
      expect(res.configFile).toBe('vite.config.ts');
    });

    it('returns SKIPPED when setupProxy is false', () => {
      fs.writeFileSync(
        path.join(tempDir, 'vite.config.ts'),
        `export default defineConfig({ plugins: [] });`
      );

      const res = configureViteProxy(tempDir, 5674, false);
      expect(res.status).toBe('SKIPPED');
      expect(res.configFile).toBe('vite.config.ts');
      expect(res.recommendedProxySnippet).toContain("'/esedre'");

      // Verify file was NOT modified
      const content = fs.readFileSync(path.join(tempDir, 'vite.config.ts'), 'utf-8');
      expect(content).not.toContain("'/esedre'");
    });

    it('returns CONFIGURED and writes proxy when setupProxy is true', () => {
      fs.writeFileSync(
        path.join(tempDir, 'vite.config.ts'),
        `export default defineConfig({ plugins: [] });`
      );

      const res = configureViteProxy(tempDir, 5674, true);
      expect(res.status).toBe('CONFIGURED');
      expect(res.configFile).toBe('vite.config.ts');

      const content = fs.readFileSync(path.join(tempDir, 'vite.config.ts'), 'utf-8');
      expect(content).toContain("'/esedre': {");
      expect(content).toContain("target: 'http://127.0.0.1:5674'");
    });
  });

  describe('configureWorkspace integration', () => {
    it('includes viteProxyStatus in configureWorkspace result', () => {
      fs.writeFileSync(
        path.join(tempDir, 'vite.config.ts'),
        `export default defineConfig({ server: { port: 3000 } });`
      );

      const res = configureWorkspace(tempDir, { setupProxy: true, port: 5674 });
      expect(res.viteProxyStatus).toBe('CONFIGURED');
      expect(res.viteConfigFile).toBe('vite.config.ts');

      // Second run reports ALREADY_CONFIGURED
      const res2 = configureWorkspace(tempDir, { setupProxy: true, port: 5674 });
      expect(res2.viteProxyStatus).toBe('ALREADY_CONFIGURED');
    });

    it('reports NOT_APPLICABLE when workspace has no Vite config', () => {
      const res = configureWorkspace(tempDir, { setupProxy: true });
      expect(res.viteProxyStatus).toBe('NOT_APPLICABLE');
      expect(res.recommendedProxySnippet).toBeDefined();
    });
  });
});
