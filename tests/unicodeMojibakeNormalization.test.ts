import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  normalizeDashesAndMojibake,
  normalizeTicketFields,
  formatTicketListTable,
  formatTicketDetail,
} from '../src/utils/formatter.js';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { EsedreTicket } from '../src/types.js';

describe('Unicode Dash & Mojibake Normalization (Esedre-32)', () => {
  describe('normalizeDashesAndMojibake', () => {
    it('normalizes Windows-1252/ISO-8859-1 en-dash and em-dash mojibake', () => {
      expect(normalizeDashesAndMojibake('1.0 â€“ 2.0 hours')).toBe('1.0 - 2.0 hours');
      expect(normalizeDashesAndMojibake('Part 1 â€” Part 2')).toBe('Part 1 - Part 2');
      expect(normalizeDashesAndMojibake('Value: \u00e2\u20ac\u201c')).toBe('Value: -');
      expect(normalizeDashesAndMojibake('Value: \u00e2\u20ac\u201d')).toBe('Value: -');
      expect(normalizeDashesAndMojibake('Value: \u00e2\u0080\u0093')).toBe('Value: -');
      expect(normalizeDashesAndMojibake('Value: \u00e2\u0080\u0094')).toBe('Value: -');
    });

    it('normalizes double-encoded UTF-8 mojibake', () => {
      expect(normalizeDashesAndMojibake('2.0 Ã¢â‚¬â€œ 4.0 hours')).toBe('2.0 - 4.0 hours');
      expect(normalizeDashesAndMojibake('Scope Ã¢â‚¬â€” Architecture')).toBe('Scope - Architecture');
    });

    it('normalizes Unicode dashes, figure dashes, and minus signs to standard ASCII hyphen', () => {
      // en-dash \u2013
      expect(normalizeDashesAndMojibake('1.0 \u2013 2.5 hours')).toBe('1.0 - 2.5 hours');
      // em-dash \u2014
      expect(normalizeDashesAndMojibake('Overview \u2014 Ticket 32')).toBe('Overview - Ticket 32');
      // figure dash \u2012
      expect(normalizeDashesAndMojibake('555\u20120199')).toBe('555-0199');
      // horizontal bar \u2015
      expect(normalizeDashesAndMojibake('Before \u2015 After')).toBe('Before - After');
      // minus sign \u2212
      expect(normalizeDashesAndMojibake('Delta: \u22125%')).toBe('Delta: -5%');
    });

    it('normalizes mojibake smart quotes and ellipsis', () => {
      expect(normalizeDashesAndMojibake('â€˜singleâ€™')).toBe("'single'");
      expect(normalizeDashesAndMojibake('â€œdoubleâ€\u009d')).toBe('"double"');
      expect(normalizeDashesAndMojibake('Loadingâ€¦')).toBe('Loading...');
    });

    it('preserves clean ASCII strings and standard hyphens unchanged', () => {
      expect(normalizeDashesAndMojibake('Clean title - 1.0 - 2.0 hours')).toBe('Clean title - 1.0 - 2.0 hours');
      expect(normalizeDashesAndMojibake('Simple text with no dashes')).toBe('Simple text with no dashes');
    });

    it('handles non-string and falsy values safely', () => {
      expect(normalizeDashesAndMojibake('')).toBe('');
      expect(normalizeDashesAndMojibake(null as any)).toBe(null);
      expect(normalizeDashesAndMojibake(undefined as any)).toBe(undefined);
      expect(normalizeDashesAndMojibake(42 as any)).toBe(42);
    });
  });

  describe('normalizeTicketFields', () => {
    it('deep-normalizes all string fields within an EsedreTicket', () => {
      const ticket: EsedreTicket = {
        meta: {
          id: 1,
          title: 'Ticket with enâ€“dash',
          type: 'Feature',
          category: 'Feature',
          status: 'Planned',
          complexity: 'Low â€“ Medium',
          estimatedEffort: '1.0 â€“ 2.0 hours',
          project: 'TEST',
          projectId: 1,
          revision: 1,
        },
        detail: {
          title: 'Ticket with enâ€“dash',
          type: 'Feature',
          category: 'Feature',
          complexity: 'Low â€“ Medium',
          estimatedEffort: '1.0 â€“ 2.0 hours',
          summary: 'Summary with em\u2014dash and en\u2013dash',
          breakdown: ['Step 1 â€“ initialize', 'Step 2 \u2014 verify'],
          technicalDetails: ['Detail 1 â€“ spec'],
          openQuestions: ['Question 1 â€“ unresolved'],
          raw: 'Raw markdown with â€“ mojibake',
        },
        planMarkdown: '# Plan \u2014 Architecture\nEffort: 1.0 â€“ 2.0 hours',
        comments: [
          {
            id: 'c1',
            timestamp: '2026-09-26T10:00:00Z',
            author: 'Developer â€“ Lead',
            text: 'Verified â€“ all tests pass.',
          },
        ],
        projectDescriptor: {
          id: 1,
          code: 'TEST',
          name: 'Test Project',
          description: 'Test description',
        },
      };

      const normalized = normalizeTicketFields(ticket);

      expect(normalized.meta.title).toBe('Ticket with en-dash');
      expect(normalized.meta.complexity).toBe('Low - Medium');
      expect(normalized.meta.estimatedEffort).toBe('1.0 - 2.0 hours');
      expect(normalized.detail?.summary).toBe('Summary with em-dash and en-dash');
      expect(normalized.detail?.breakdown).toEqual(['Step 1 - initialize', 'Step 2 - verify']);
      expect(normalized.detail?.technicalDetails).toEqual(['Detail 1 - spec']);
      expect(normalized.detail?.openQuestions).toEqual(['Question 1 - unresolved']);
      expect(normalized.detail?.raw).toBe('Raw markdown with - mojibake');
      expect(normalized.planMarkdown).toBe('# Plan - Architecture\nEffort: 1.0 - 2.0 hours');
      expect(normalized.comments?.[0].author).toBe('Developer - Lead');
      expect(normalized.comments?.[0].text).toBe('Verified - all tests pass.');
    });
  });

  describe('formatTicketDetail and formatTicketListTable', () => {
    it('renders clean standard hyphens in CLI detail output when ticket contains mojibake', () => {
      const ticket: EsedreTicket = {
        meta: {
          id: 83,
          title: 'Fix Tooltip â€“ Anchor',
          type: 'Bug',
          category: 'Bug',
          status: 'Completed',
          complexity: 'Small',
          estimatedEffort: '1.0 â€“ 2.0 hours',
          project: 'Profe',
          projectId: 1,
          revision: 1,
        },
        detail: {
          title: 'Fix Tooltip â€“ Anchor',
          type: 'Bug',
          category: 'Bug',
          complexity: 'Small',
          estimatedEffort: '1.0 â€“ 2.0 hours',
          summary: 'Problem â€“ details to investigate.',
          breakdown: ['Requirement 1 â€“ top-right anchor'],
          technicalDetails: ['Architecture â€“ math formula'],
          openQuestions: ['Decision 1 â€“ keep fallback'],
          raw: 'Raw detail markdown',
        },
        planMarkdown: '## Plan â€“ Implementation\nTarget: 1.0 \u2013 2.0 hours',
        comments: [
          {
            id: 'c1',
            timestamp: '2026-09-26T10:00:00Z',
            author: 'Developer',
            text: 'Result â€“ 827 tests pass.',
          },
        ],
        projectDescriptor: {
          id: 1,
          code: 'Profe',
          name: 'Professor Arwam',
          description: 'Sleep research app',
        },
      };

      const detailOutput = formatTicketDetail(ticket);
      expect(detailOutput).not.toContain('â€“');
      expect(detailOutput).not.toContain('\u2013');
      expect(detailOutput).not.toContain('\u2014');
      expect(detailOutput).toContain('Effort:      1.0 - 2.0 hours');
      expect(detailOutput).toContain('Summary:\nProblem - details to investigate.');
      expect(detailOutput).toContain('• Requirement 1 - top-right anchor');
      expect(detailOutput).toContain('Result - 827 tests pass.');

      const tableOutput = formatTicketListTable([ticket]);
      expect(tableOutput).not.toContain('â€“');
      expect(tableOutput).not.toContain('\u2013');
      expect(tableOutput).toContain('Fix Tooltip - Anchor');
    });
  });

  describe('FilesystemStorageAdapter with mojibake files on disk', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-mojibake-test-'));
      const esedreDir = path.join(tempDir, '.esedre');
      const ticketsDir = path.join(esedreDir, 'tickets', '1');
      fs.mkdirSync(ticketsDir, { recursive: true });

      fs.writeFileSync(
        path.join(esedreDir, 'esedre.json'),
        JSON.stringify({ projectCode: 'MOJI' }, null, 2),
        'utf-8'
      );
      fs.writeFileSync(
        path.join(esedreDir, 'project.json'),
        JSON.stringify({ id: 1, code: 'MOJI', name: 'Mojibake Project' }, null, 2),
        'utf-8'
      );

      // Raw files on disk containing legacy â€“ mojibake
      fs.writeFileSync(
        path.join(ticketsDir, 'meta.json'),
        JSON.stringify(
          {
            id: 1,
            title: 'Test ticket â€“ with mojibake',
            complexity: 'Low â€“ Medium',
            estimatedEffort: '1.0 â€“ 2.5 hours',
            status: 'Planned',
            projectId: 1,
            project: 'MOJI',
            type: 'Feature',
          },
          null,
          2
        ),
        'utf-8'
      );

      fs.writeFileSync(
        path.join(ticketsDir, 'detail.md'),
        '# Ticket #1: Test ticket â€“ with mojibake\n\n### Summary\nElevator pitch â€“ with en-dash.\n\n### Feature Breakdown\n1. Requirement â€“ item\n',
        'utf-8'
      );

      fs.writeFileSync(
        path.join(ticketsDir, 'implementation_plan.md'),
        '# Implementation Plan â€” Ticket #1\nEstimated effort: 1.0 \u2013 2.5 hours\n',
        'utf-8'
      );

      fs.writeFileSync(
        path.join(ticketsDir, 'comments.json'),
        JSON.stringify([
          {
            id: 'c1',
            timestamp: '2026-09-26T10:00:00Z',
            author: 'Lead â€“ Dev',
            text: 'Comment with â€“ mojibake.',
          },
        ]),
        'utf-8'
      );
    });

    afterEach(() => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    });

    it('transparently normalizes mojibake and unicode dashes when reading tickets from disk', async () => {
      const adapter = new FilesystemStorageAdapter(tempDir);
      const ticket = await adapter.getTicket(1);

      expect(ticket).not.toBeNull();
      expect(ticket!.meta.title).toBe('Test ticket - with mojibake');
      expect(ticket!.meta.complexity).toBe('Low - Medium');
      expect(ticket!.meta.estimatedEffort).toBe('1.0 - 2.5 hours');
      expect(ticket!.detail?.summary).toBe('Elevator pitch - with en-dash.');
      expect(ticket!.detail?.breakdown).toEqual(['Requirement - item']);
      expect(ticket!.planMarkdown).toBe('# Implementation Plan - Ticket #1\nEstimated effort: 1.0 - 2.5 hours\n');
      expect(ticket!.comments?.[0].author).toBe('Lead - Dev');
      expect(ticket!.comments?.[0].text).toBe('Comment with - mojibake.');

      const list = await adapter.listTickets();
      expect(list.length).toBe(1);
      expect(list[0].meta.title).toBe('Test ticket - with mojibake');
      expect(list[0].meta.estimatedEffort).toBe('1.0 - 2.5 hours');

      const plan = await adapter.getPlan(1);
      expect(plan).toBe('# Implementation Plan - Ticket #1\nEstimated effort: 1.0 - 2.5 hours\n');
    });

    it('normalizes incoming unicode dashes on createTicket and updateTicket', async () => {
      const adapter = new FilesystemStorageAdapter(tempDir);
      const created = await adapter.createTicket({
        title: 'New Feature â€“ with dash',
        projectCode: 'MOJI',
        complexity: 'Medium',
        estimatedEffort: '2.0 \u2013 4.0 hours',
        summary: 'Feature summary â€” clean',
      });

      expect(created.meta.title).toBe('New Feature - with dash');
      expect(created.meta.estimatedEffort).toBe('2.0 - 4.0 hours');
      expect(created.detail?.summary).toBe('Feature summary - clean');

      // Verify on-disk file was saved with clean hyphen
      const createdMetaRaw = fs.readFileSync(
        path.join(tempDir, '.esedre', 'tickets', String(created.meta.id), 'meta.json'),
        'utf-8'
      );
      expect(createdMetaRaw).not.toContain('â€“');
      expect(createdMetaRaw).not.toContain('\u2013');
      expect(createdMetaRaw).toContain('"estimatedEffort": "2.0 - 4.0 hours"');

      // Update ticket with en-dash
      const updated = await adapter.updateTicket(created.meta.id, {
        title: 'Updated Title â€“ Revision 2',
        estimatedEffort: '3.0 \u2013 5.0 hours',
      });

      expect(updated.meta.title).toBe('Updated Title - Revision 2');
      expect(updated.meta.estimatedEffort).toBe('3.0 - 5.0 hours');

      // Add comment with en-dash
      const comment = await adapter.addComment(created.meta.id, {
        author: 'QA â€“ Tester',
        text: 'Verified â€“ PASS',
      });

      expect(comment.author).toBe('QA - Tester');
      expect(comment.text).toBe('Verified - PASS');

      // Save plan with em-dash
      await adapter.savePlan(created.meta.id, '# Plan \u2014 Architecture Section');
      const retrievedPlan = await adapter.getPlan(created.meta.id);
      expect(retrievedPlan).toBe('# Plan - Architecture Section');
    });
  });
});
