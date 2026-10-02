import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  detectIsEmbedded,
  updateProjectUrlSearchParam,
  parseTicketHash,
  resolveFeatureFromHash,
  getFeatureHash,
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

  describe('parseTicketHash', () => {
    it('parses ticket hashes with hyphens, underscores, and multi-part project names', () => {
      expect(parseTicketHash('#ticket-alce-web-1')).toEqual({ project: 'alce-web', number: 1 });
      expect(parseTicketHash('#feature-alce-web-1')).toEqual({ project: 'alce-web', number: 1 });
      expect(parseTicketHash('#alce-web-1')).toEqual({ project: 'alce-web', number: 1 });
      expect(parseTicketHash('#ticket-Esedre-48')).toEqual({ project: 'Esedre', number: 48 });
      expect(parseTicketHash('#Esedre-48')).toEqual({ project: 'Esedre', number: 48 });
      expect(parseTicketHash('#ticket-1')).toEqual({ number: 1 });
      expect(parseTicketHash('#feature-1')).toEqual({ number: 1 });
      expect(parseTicketHash('#1')).toEqual({ number: 1 });
      expect(parseTicketHash('#ticket-10')).toEqual({ number: 10 });
    });

    it('returns undefined for non-ticket hashes or empty hashes', () => {
      expect(parseTicketHash('')).toBeUndefined();
      expect(parseTicketHash('#')).toBeUndefined();
      expect(parseTicketHash('#flags')).toBeUndefined();
      expect(parseTicketHash('#milestones')).toBeUndefined();
      expect(parseTicketHash('#features')).toBeUndefined();
      expect(parseTicketHash('#settings')).toBeUndefined();
    });
  });

  describe('resolveFeatureFromHash & getFeatureHash', () => {
    const sampleFeatures: any[] = [
      {
        id: 'feature-Profe-1',
        number: 1,
        ticketId: '1',
        title: 'Profe First Ticket',
        project: 'Profe',
        projectId: 1,
      },
      {
        id: 'feature-Esedre-1',
        number: 1,
        ticketId: '1',
        title: 'Esedre First Ticket',
        project: 'Esedre',
        projectId: 3,
      },
      {
        id: 'feature-Esedre-48',
        number: 48,
        ticketId: '48',
        title: 'Answers Persistence',
        project: 'Esedre',
        projectId: 3,
      },
      {
        id: 'feature-alce-web-1',
        number: 1,
        ticketId: '1',
        title: 'Alce Web First Ticket',
        project: 'alce-web',
        projectId: 5,
      },
      {
        id: 'feature-Standalone-10',
        number: 10,
        ticketId: '10',
        title: 'Standalone Legacy Ticket',
        project: undefined,
        projectId: undefined,
      },
    ];

    it('resolves project-prefixed hashes in various formats including multi-hyphen projects', () => {
      expect(resolveFeatureFromHash('#ticket-Esedre-48', sampleFeatures)?.id).toBe('feature-Esedre-48');
      expect(resolveFeatureFromHash('#feature-Esedre-48', sampleFeatures)?.id).toBe('feature-Esedre-48');
      expect(resolveFeatureFromHash('#Esedre-48', sampleFeatures)?.id).toBe('feature-Esedre-48');
      expect(resolveFeatureFromHash('#ticket-esedre-48', sampleFeatures)?.id).toBe('feature-Esedre-48');
      expect(resolveFeatureFromHash('#ESEDRE-48', sampleFeatures)?.id).toBe('feature-Esedre-48');
      expect(resolveFeatureFromHash('#ticket-alce-web-1', sampleFeatures)?.id).toBe('feature-alce-web-1');
      expect(resolveFeatureFromHash('#feature-alce-web-1', sampleFeatures)?.id).toBe('feature-alce-web-1');
      expect(resolveFeatureFromHash('#alce-web-1', sampleFeatures)?.id).toBe('feature-alce-web-1');
    });

    it('resolves pure numeric hashes disambiguated by active project filter', () => {
      expect(resolveFeatureFromHash('#ticket-1', sampleFeatures, 'Esedre')?.id).toBe('feature-Esedre-1');
      expect(resolveFeatureFromHash('#1', sampleFeatures, 'Profe')?.id).toBe('feature-Profe-1');
      expect(resolveFeatureFromHash('#feature-1', sampleFeatures, 'Profe')?.id).toBe('feature-Profe-1');
      expect(resolveFeatureFromHash('#ticket-1', sampleFeatures, 'alce-web')?.id).toBe('feature-alce-web-1');
    });

    it('resolves pure numeric hashes when no project prefix is provided', () => {
      expect(resolveFeatureFromHash('#ticket-48', sampleFeatures)?.id).toBe('feature-Esedre-48');
      expect(resolveFeatureFromHash('#48', sampleFeatures)?.id).toBe('feature-Esedre-48');
      expect(resolveFeatureFromHash('#ticket-10', sampleFeatures)?.id).toBe('feature-Standalone-10');
    });

    it('returns undefined for non-ticket hashes or empty hashes', () => {
      expect(resolveFeatureFromHash('', sampleFeatures)).toBeUndefined();
      expect(resolveFeatureFromHash('#', sampleFeatures)).toBeUndefined();
      expect(resolveFeatureFromHash('#flags', sampleFeatures)).toBeUndefined();
      expect(resolveFeatureFromHash('#milestones', sampleFeatures)).toBeUndefined();
      expect(resolveFeatureFromHash('#features', sampleFeatures)).toBeUndefined();
      expect(resolveFeatureFromHash('#settings', sampleFeatures)).toBeUndefined();
    });

    it('generates unambiguous self-describing project hashes', () => {
      const feat = sampleFeatures[2]; // Esedre #48
      expect(getFeatureHash(feat, 'all')).toBe('#ticket-Esedre-48');
      expect(getFeatureHash(feat, undefined)).toBe('#ticket-Esedre-48');
      expect(getFeatureHash(feat, 'Esedre')).toBe('#ticket-Esedre-48');

      const alceFeat = sampleFeatures[3]; // alce-web #1
      expect(getFeatureHash(alceFeat, 'all')).toBe('#ticket-alce-web-1');
      const standaloneFeat = sampleFeatures[4]; // Standalone #10
      expect(getFeatureHash(standaloneFeat, 'all')).toBe('#ticket-10');
    });

    it('generates unambiguous self-describing project hashes even if feature has display name or legacy project', () => {
      const featWithName: any = {
        id: 'feature-Profe-139',
        number: 139,
        ticketId: '139',
        title: 'MobX Store Migration',
        project: 'Professor Arwam',
        projectId: 1,
      };
      expect(getFeatureHash(featWithName)).toBe('#ticket-Profe-139');
    });
  });

  describe('updateProjectUrlSearchParam normalization', () => {
    const originalWindow = globalThis.window;

    afterEach(() => {
      if (originalWindow) {
        globalThis.window = originalWindow;
      } else {
        delete (globalThis as any).window;
      }
      vi.restoreAllMocks();
    });

    it('normalizes project display names to canonical project codes in URL params', () => {
      const replaceStateMock = vi.fn();
      (globalThis as any).window = {
        location: {
          href: 'http://localhost:5674/app',
        },
        history: {
          replaceState: replaceStateMock,
        },
      };

      updateProjectUrlSearchParam('Professor Arwam', false);
      expect(replaceStateMock).toHaveBeenCalledWith({}, '', 'http://localhost:5674/app?project=Profe');

      updateProjectUrlSearchParam('Esedre', false);
      expect(replaceStateMock).toHaveBeenCalledWith({}, '', 'http://localhost:5674/app?project=Esedre');

      updateProjectUrlSearchParam('all', false);
      expect(replaceStateMock).toHaveBeenCalledWith({}, '', 'http://localhost:5674/app');
    });
  });
});


