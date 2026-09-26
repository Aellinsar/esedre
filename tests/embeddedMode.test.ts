import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  detectIsEmbedded,
  updateProjectUrlSearchParam,
} from '../src/ui/PlannedWorkView.js';

describe('Embedded Mode Detection & URL Query Protection', () => {
  describe('detectIsEmbedded', () => {
    it('honors explicit isEmbeddedProp when true or false', () => {
      expect(detectIsEmbedded({ isEmbeddedProp: true, showHeader: true })).toBe(true);
      expect(
        detectIsEmbedded({
          isEmbeddedProp: false,
          isIframe: true,
          showHeader: false,
          allowedProjects: ['Profe'],
        })
      ).toBe(false);
    });

    it('detects embedded context when running inside an iframe', () => {
      expect(detectIsEmbedded({ isIframe: true })).toBe(true);
      expect(detectIsEmbedded({ isIframe: false })).toBe(false);
    });

    it('detects embedded context when embedded=true search parameter is present', () => {
      expect(detectIsEmbedded({ search: '?embedded=true' })).toBe(true);
      expect(detectIsEmbedded({ search: '?embedded=false' })).toBe(false);
      expect(detectIsEmbedded({ search: '?project=Profe' })).toBe(false);
      expect(detectIsEmbedded({ search: '' })).toBe(false);
    });

    it('detects embedded context when top navigation header is hidden', () => {
      expect(detectIsEmbedded({ showHeader: false })).toBe(true);
      expect(detectIsEmbedded({ showHeader: true })).toBe(false);
    });

    it('detects embedded context when allowedProjects is restricted', () => {
      expect(detectIsEmbedded({ allowedProjects: ['Profe'] })).toBe(true);
      expect(detectIsEmbedded({ allowedProjects: ['Profe', 'Alce'] })).toBe(true);
      expect(detectIsEmbedded({ allowedProjects: ['*'] })).toBe(false);
      expect(detectIsEmbedded({ allowedProjects: [] })).toBe(false);
      expect(detectIsEmbedded({ allowedProjects: undefined })).toBe(false);
    });

    it('defaults to standalone mode when no embedded indicators are present', () => {
      expect(
        detectIsEmbedded({
          showHeader: true,
          isIframe: false,
          search: '',
          allowedProjects: undefined,
        })
      ).toBe(false);
    });
  });

  describe('updateProjectUrlSearchParam', () => {
    const originalWindow = globalThis.window;

    afterEach(() => {
      if (originalWindow) {
        globalThis.window = originalWindow;
      } else {
        delete (globalThis as any).window;
      }
      vi.restoreAllMocks();
    });

    it('does nothing in SSR or environments without window', () => {
      delete (globalThis as any).window;
      expect(() => updateProjectUrlSearchParam('Profe', false)).not.toThrow();
      expect(() => updateProjectUrlSearchParam('Profe', true)).not.toThrow();
    });

    it('strictly avoids mutating history.replaceState or URL search parameters when isEmbedded is true', () => {
      const replaceStateMock = vi.fn();
      (globalThis as any).window = {
        location: {
          href: 'http://localhost:3000/?foo=bar#/planner',
        },
        history: {
          replaceState: replaceStateMock,
        },
      };

      updateProjectUrlSearchParam('Personal', true);
      expect(replaceStateMock).not.toHaveBeenCalled();

      updateProjectUrlSearchParam('all', true);
      expect(replaceStateMock).not.toHaveBeenCalled();
    });

    it('updates URL search parameters via history.replaceState in standalone mode', () => {
      const replaceStateMock = vi.fn();
      (globalThis as any).window = {
        location: {
          href: 'http://localhost:5674/app?foo=bar',
        },
        history: {
          replaceState: replaceStateMock,
        },
      };

      updateProjectUrlSearchParam('Profe', false);
      expect(replaceStateMock).toHaveBeenCalledTimes(1);
      expect(replaceStateMock).toHaveBeenCalledWith(
        {},
        '',
        'http://localhost:5674/app?foo=bar&project=Profe'
      );
    });

    it('removes project search parameter when filter is set to all in standalone mode', () => {
      const replaceStateMock = vi.fn();
      (globalThis as any).window = {
        location: {
          href: 'http://localhost:5674/app?project=Profe&tab=features',
        },
        history: {
          replaceState: replaceStateMock,
        },
      };

      updateProjectUrlSearchParam('all', false);
      expect(replaceStateMock).toHaveBeenCalledTimes(1);
      expect(replaceStateMock).toHaveBeenCalledWith(
        {},
        '',
        'http://localhost:5674/app?tab=features'
      );
    });
  });
});
