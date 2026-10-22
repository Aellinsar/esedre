import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';

describe('FilesystemStorageAdapter', () => {
  let tempDir: string;
  let adapter: FilesystemStorageAdapter;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-test-'));
    const ticketsDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets');
    fs.mkdirSync(ticketsDir, { recursive: true });

    // Seed projects.json
    const projects = [
      { id: 1, code: 'Core', name: 'Core Application', description: 'Main App' },
      { id: 2, code: 'Web', name: 'Web Client', description: 'Web Client' },
      { id: 3, code: 'Docs', name: 'Documentation', description: 'Docs' },
    ];
    fs.writeFileSync(
      path.join(tempDir, 'src', 'data', 'planning', 'projects.json'),
      JSON.stringify(projects, null, 2)
    );

    adapter = new FilesystemStorageAdapter(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads projects correctly', async () => {
    const projects = await adapter.getProjects();
    expect(projects).toHaveLength(3);
    expect(projects[0].code).toBe('Core');
    expect(projects[1].code).toBe('Web');
    expect(projects[2].code).toBe('Docs');
  });

  it('creates and retrieves a new ticket with correct sequential ID and files', async () => {
    const created = await adapter.createTicket({
      title: 'Test Ticket Alpha',
      category: 'Feature',
      projectCode: 'Web',
      complexity: 'Low',
      effort: '1.0 hour',
      summary: 'A test ticket for verification.',
      submittedBy: 'TestUser',
    });

    expect(created.meta.id).toBe(1);
    expect(created.meta.title).toBe('Test Ticket Alpha');
    expect(created.meta.category).toBe('Feature');
    expect(created.meta.projectId).toBe(2);
    expect(created.projectDescriptor?.code).toBe('Web');

    // Retrieve by ID
    const retrieved = await adapter.getTicket(1);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.meta.title).toBe('Test Ticket Alpha');
    expect(retrieved?.detail?.summary).toBe('A test ticket for verification.');
  });

  it('lists tickets with status and project filtering', async () => {
    await adapter.createTicket({ title: 'Ticket 1', category: 'Feature', projectCode: 'Core' });
    await adapter.createTicket({ title: 'Ticket 2', category: 'Bug', projectCode: 'Web' });
    await adapter.createTicket({ title: 'Ticket 3', category: 'Tools', projectCode: 'Core' });

    // Filter by project
    const coreTickets = await adapter.listTickets({ project: 'Core' });
    expect(coreTickets).toHaveLength(2);

    const webTickets = await adapter.listTickets({ project: 'Web' });
    expect(webTickets).toHaveLength(1);
    expect(webTickets[0].meta.title).toBe('Ticket 2');

    // Filter by category
    const bugTickets = await adapter.listTickets({ category: 'Bug' });
    expect(bugTickets).toHaveLength(1);
  });

  it('updates ticket status and title cleanly', async () => {
    const created = await adapter.createTicket({ title: 'Original Title', category: 'Feature', projectCode: 'Core' });
    const updated = await adapter.updateTicket(created.meta.id, {
      title: 'Updated Title',
      status: 'In Development',
    });

    expect(updated.meta.title).toBe('Updated Title');
    expect(updated.meta.status).toBe('In Development');

    // Verify detail.md header was updated
    const retrieved = await adapter.getTicket(created.meta.id);
    expect(retrieved?.detail?.title).toBe('Updated Title');
  });

  it('saves and retrieves implementation plan markdown', async () => {
    const created = await adapter.createTicket({ title: 'Plan Target', category: 'Feature', projectCode: 'Core' });
    expect(await adapter.getPlan(created.meta.id)).toBeNull();

    const planContent = '# Implementation Plan\n\n1. Step One\n2. Step Two';
    await adapter.savePlan(created.meta.id, planContent);

    const retrievedPlan = await adapter.getPlan(created.meta.id);
    expect(retrievedPlan).toBe(planContent);

    // Validation checks (Ticket #81)
    await expect(adapter.savePlan(created.meta.id, undefined as any)).rejects.toThrow(
      'Plan markdown content is required and must be a string'
    );
    await expect(adapter.savePlan(created.meta.id, null as any)).rejects.toThrow(
      'Plan markdown content is required and must be a string'
    );
  });

  it('appends and lists comments with timestamps and authors', async () => {
    const created = await adapter.createTicket({ title: 'Comment Target', category: 'Feature', projectCode: 'Core' });
    const c1 = await adapter.addComment(created.meta.id, { author: 'Alice', text: 'First comment' });
    const c2 = await adapter.addComment(created.meta.id, { author: 'Bob', text: 'Second comment' });

    expect(c1.author).toBe('Alice');
    expect(c2.author).toBe('Bob');

    const retrieved = await adapter.getTicket(created.meta.id);
    expect(retrieved?.comments).toHaveLength(2);
    expect(retrieved?.comments[0].text).toBe('First comment');
    expect(retrieved?.comments[1].text).toBe('Second comment');
  });

  it('throws an error when creating a ticket without specifying a project (zero fallback)', async () => {
    await expect(
      adapter.createTicket({ title: 'Orphan Ticket', category: 'Feature' })
    ).rejects.toThrow(/Project is required to create a ticket/);
  });

  it('throws an error when creating a ticket with an unregistered project', async () => {
    await expect(
      adapter.createTicket({ title: 'Bad Project Ticket', category: 'Feature', projectCode: 'UNKNOWN' })
    ).rejects.toThrow(/Project 'UNKNOWN' is invalid or not registered/);
  });

  it('returns empty array when projects.json does not exist (zero hardcoded fallback)', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-empty-test-'));
    try {
      const emptyAdapter = new FilesystemStorageAdapter(emptyDir);
      const projects = await emptyAdapter.getProjects();
      expect(projects).toEqual([]);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('loads tickets and projects from configured dataDir', async () => {
    const customDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-data-test-'));
    const ticketsDir = path.join(customDataDir, 'tickets');
    fs.mkdirSync(ticketsDir, { recursive: true });

    const projects = [
      { id: 10, code: 'DataP', name: 'Data Project', description: 'Data' },
    ];
    fs.writeFileSync(
      path.join(customDataDir, 'projects.json'),
      JSON.stringify(projects, null, 2)
    );

    try {
      const dataDirAdapter = new FilesystemStorageAdapter(tempDir, { dataDir: customDataDir });
      const loadedProjects = await dataDirAdapter.getProjects();
      expect(loadedProjects).toHaveLength(1);
      expect(loadedProjects[0].code).toBe('DataP');

      const ticket = await dataDirAdapter.createTicket({
        title: 'External Data Ticket',
        category: 'Feature',
        projectCode: 'DataP',
      });
      expect(ticket).toBeDefined();
      expect(ticket?.meta.id).toBe(1);
      expect(fs.existsSync(path.join(ticketsDir, '1', 'meta.json'))).toBe(true);
    } finally {
      fs.rmSync(customDataDir, { recursive: true, force: true });
    }
  });

  it('persists and retrieves open question answers via saveAnswer and getAnswers', async () => {
    const ticket = await adapter.createTicket({
      title: 'Ticket with Open Questions',
      category: 'Feature',
      projectCode: 'Core',
    });

    // Initially answers are empty
    const initialAnswers = await adapter.getAnswers(ticket.meta.id);
    expect(initialAnswers).toEqual({});

    // Save answer to question 0
    const updated0 = await adapter.saveAnswer(ticket.meta.id, 0, 'Use Redis for caching');
    expect(updated0['0']).toBe('Use Redis for caching');

    // Save answer to question 1
    const updated1 = await adapter.saveAnswer(ticket.meta.id, 1, 'Deploy via Docker');
    expect(updated1['0']).toBe('Use Redis for caching');
    expect(updated1['1']).toBe('Deploy via Docker');

    // Verify on disk in ticket dir
    const diskAnswers = await adapter.getAnswers(ticket.meta.id);
    expect(diskAnswers).toEqual({
      '0': 'Use Redis for caching',
      '1': 'Deploy via Docker',
    });

    // Verify ticket retrieval includes answers
    const fetched = await adapter.getTicket(ticket.meta.id);
    expect(fetched?.answers).toEqual({
      '0': 'Use Redis for caching',
      '1': 'Deploy via Docker',
    });

    // Verify listTickets includes answers
    const list = await adapter.listTickets({ project: 'Core' });
    const found = list.find((t) => t.meta.id === ticket.meta.id);
    expect(found?.answers).toEqual({
      '0': 'Use Redis for caching',
      '1': 'Deploy via Docker',
    });
  });

  it('saves and updates detail.md via saveDetail', async () => {
    const ticket = await adapter.createTicket({
      title: 'Original Ticket',
      category: 'Feature',
      projectCode: 'Core',
    });

    const newDetailMd = '# Ticket #1: Original Ticket\n\n### Summary\nCustom updated summary.\n\n### Rationale\nCustom rationale.';
    const result = await adapter.saveDetail(ticket.meta.id, newDetailMd, {
      title: 'Updated Ticket Title',
    });

    expect(result.success).toBe(true);
    expect(result.detail).toBe(newDetailMd);
    expect(result.meta?.title).toBe('Updated Ticket Title');

    // Verify persisted on disk
    const fetched = await adapter.getTicket(ticket.meta.id);
    expect(fetched?.detail?.raw).toBe(newDetailMd);
    expect(fetched?.meta.title).toBe('Updated Ticket Title');
  });

  it('persists and retrieves inline comments', async () => {
    const ticket = await adapter.createTicket({
      title: 'Ticket for Annotations',
      category: 'Feature',
      projectCode: 'Core',
    });

    const inlines = await adapter.saveInlineComment(
      ticket.meta.id,
      'selected code snippet',
      'This needs refactoring',
      'Architect'
    );

    expect(inlines).toHaveLength(1);
    expect(inlines[0].selectedText).toBe('selected code snippet');
    expect(inlines[0].comment).toBe('This needs refactoring');
    expect(inlines[0].author).toBe('Architect');

    const fetchedInlines = await adapter.getInlineComments(ticket.meta.id);
    expect(fetchedInlines).toHaveLength(1);

    const fetchedTicket = await adapter.getTicket(ticket.meta.id);
    expect(fetchedTicket?.inlineComments).toHaveLength(1);
  });

  it('saves and retrieves attachments', async () => {
    const ticket = await adapter.createTicket({
      title: 'Ticket for Attachments',
      category: 'Feature',
      projectCode: 'Core',
    });

    const sampleBuffer = Buffer.from('fake image binary data', 'utf-8');
    const saved = await adapter.saveAttachment(ticket.meta.id, 'screenshot.png', sampleBuffer);
    expect(saved.filename).toBe('screenshot.png');

    const filePath = adapter.getAttachmentPath(ticket.meta.id, 'screenshot.png');
    expect(filePath).not.toBeNull();
    expect(fs.readFileSync(filePath!)).toEqual(sampleBuffer);
  });

  it('uses in-memory cache for repeated listTickets and getTicket calls when stats are unchanged', async () => {
    const ticket = await adapter.createTicket({
      title: 'Cache Validation Ticket',
      category: 'Feature',
      projectCode: 'Core',
    });

    // First retrieval populates the in-memory cache
    const firstList = await adapter.listTickets({ project: 'Core' });
    const firstTicket = firstList.find((t) => t.meta.id === ticket.meta.id);
    expect(firstTicket).toBeDefined();

    // Second retrieval should return cached ticket
    const secondList = await adapter.listTickets({ project: 'Core' });
    const secondTicket = secondList.find((t) => t.meta.id === ticket.meta.id);
    expect(secondTicket).toBeDefined();
    expect(secondTicket?.meta.title).toBe('Cache Validation Ticket');

    // getTicket should also read from cache
    const fetched = await adapter.getTicket(ticket.meta.id);
    expect(fetched?.meta.title).toBe('Cache Validation Ticket');
  });

  it('invalidates and reloads ticket when underlying files change on disk', async () => {
    const ticket = await adapter.createTicket({
      title: 'Original Title Before Disk Change',
      category: 'Feature',
      projectCode: 'Core',
    });

    // Populate cache
    await adapter.listTickets({ project: 'Core' });

    // Modify meta.json on disk directly
    const ticketDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets', String(ticket.meta.id));
    const metaPath = path.join(ticketDir, 'meta.json');
    const metaContent = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    metaContent.title = 'Externally Modified Title On Disk';
    fs.writeFileSync(metaPath, JSON.stringify(metaContent, null, 2) + '\n');
    // Ensure mtime or size changed
    const futureTime = new Date(Date.now() + 5000);
    fs.utimesSync(metaPath, futureTime, futureTime);

    // listTickets should detect mtime/size change and return updated data
    const updatedList = await adapter.listTickets({ project: 'Core' });
    const updatedTicket = updatedList.find((t) => t.meta.id === ticket.meta.id);
    expect(updatedTicket?.meta.title).toBe('Externally Modified Title On Disk');

    // Modify detail.md on disk directly
    const detailPath = path.join(ticketDir, 'detail.md');
    fs.writeFileSync(detailPath, '# Ticket #1: External Detail Modification\n\n### Summary\nBrand new summary from external git sync.\n');
    fs.utimesSync(detailPath, futureTime, futureTime);

    const reloaded = await adapter.getTicket(ticket.meta.id);
    expect(reloaded?.detail?.summary).toBe('Brand new summary from external git sync.');
  });

  it('prunes deleted ticket directories from in-memory cache without affecting other projects', async () => {
    const coreTicket = await adapter.createTicket({ title: 'Core Item', category: 'Feature', projectCode: 'Core' });
    const webTicket = await adapter.createTicket({ title: 'Web Item', category: 'Feature', projectCode: 'Web' });

    // Warm cache
    const initialList = await adapter.listTickets();
    expect(initialList.length).toBe(2);

    // Delete core ticket from disk directly
    const coreDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets', String(coreTicket.meta.id));
    fs.rmSync(coreDir, { recursive: true, force: true });

    // listTickets should prune the tombstone
    const afterDeleteList = await adapter.listTickets();
    expect(afterDeleteList.some((t) => t.meta.id === coreTicket.meta.id && t.meta.project === 'Core')).toBe(false);
    expect(afterDeleteList.some((t) => t.meta.id === webTicket.meta.id && t.meta.project === 'Web')).toBe(true);
  });

  it('rejects oversized attachments exceeding the 10MB file limit', async () => {
    const ticket = await adapter.createTicket({ title: 'Upload Item', category: 'Feature', projectCode: 'Core' });
    const hugeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
    await expect(
      adapter.saveAttachment(ticket.meta.id, 'large-dump.bin', hugeBuffer)
    ).rejects.toThrow(/Attachment exceeds maximum allowable size of 10MB/);
  });

  it('updateTicket updates detail.md with detailMarkdown and reconciles metadata headers (Ticket #49)', async () => {
    const ticket = await adapter.createTicket({
      title: 'Original Title',
      category: 'Feature',
      projectCode: 'Core',
    });

    const updated = await adapter.updateTicket(ticket.meta.id, {
      title: 'Updated Title',
      priority: 'High',
      complexity: 'Low',
      detailMarkdown: '### Summary\nRefined ticket specification.\n\n### Feature Breakdown\n1. First detail requirement\n2. Second detail requirement',
    });

    expect(updated.meta.title).toBe('Updated Title');
    expect(updated.meta.priority).toBe('High');
    expect(updated.meta.complexity).toBe('Low');
    expect(updated.detail?.summary).toBe('Refined ticket specification.');
    expect(updated.detail?.breakdown).toContain('First detail requirement');
    expect(updated.detail?.breakdown).toContain('Second detail requirement');

    // Read detail.md directly from disk to ensure metadata headers are reconciled
    const ticketDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets', String(ticket.meta.id));
    const detailContent = fs.readFileSync(path.join(ticketDir, 'detail.md'), 'utf-8');
    expect(detailContent).toContain(`# Ticket #${ticket.meta.id}: Updated Title`);
    expect(detailContent).toContain('**Priority**: High');
    expect(detailContent).toContain('**Complexity**: Low');
  });

  it('updateTicket normalizes top-level markdown heading to canonical ticket header (Ticket #49)', async () => {
    const ticket = await adapter.createTicket({
      title: 'Header Test Item',
      category: 'Tools',
      projectCode: 'Core',
    });

    const updated = await adapter.updateTicket(ticket.meta.id, {
      detailMarkdown: '# Arbitrary Header from External Source\n### Summary\nOverridden specification summary.\n',
    });

    expect(updated.detail?.summary).toBe('Overridden specification summary.');
    const ticketDir = path.join(tempDir, 'src', 'data', 'planning', 'tickets', String(ticket.meta.id));
    const detailContent = fs.readFileSync(path.join(ticketDir, 'detail.md'), 'utf-8');
    expect(detailContent).toContain(`# Ticket #${ticket.meta.id}: Header Test Item`);
    expect(detailContent).not.toContain('Arbitrary Header');
  });

  it('updateTicket rejects update when lastHash conflicts with optimistic concurrency control', async () => {
    const ticket = await adapter.createTicket({
      title: 'OCC Ticket',
      category: 'Feature',
      projectCode: 'Core',
    });

    await expect(
      adapter.updateTicket(
        ticket.meta.id,
        { title: 'Conflict Update', detailMarkdown: 'New details' },
        'invalid-stale-hash-12345678'
      )
    ).rejects.toThrow();
  });

  it('routes bold-keyed bullets in combined and standalone Technical Details vs Open Questions accurately (Ticket #70)', async () => {
    // 1. Combined "### Technical Detail & Open Questions" with only Technical Detail bullets (Sleep-191 repro)
    const t1 = await adapter.createTicket({
      title: 'Combined Tech Detail Only',
      category: 'Bug',
      projectCode: 'Core',
      detailMarkdown: [
        '### Summary',
        'Fix combined section bullet routing.',
        '',
        '### Technical Detail & Open Questions',
        '- **Technical Detail**: First architectural detail.',
        '- **Root Cause**: Parser previously routed all combined bullets to openQuestions.',
        '- **Open Questions**: None',
      ].join('\n'),
    });

    expect(t1.detail?.technicalDetails).toEqual([
      'First architectural detail.',
      '**Root Cause**: Parser previously routed all combined bullets to openQuestions.',
    ]);
    expect(t1.detail?.openQuestions).toEqual([]);

    // 2. Combined "### Technical Details & Open Questions" with both technical details and an actual open question
    const t2 = await adapter.createTicket({
      title: 'Combined With Open Question',
      category: 'Feature',
      projectCode: 'Core',
      detailMarkdown: [
        '### Summary',
        'Combined section with an actual open question.',
        '',
        '### Technical Details & Open Questions',
        '- **Architecture**: Event-driven pipeline.',
        '- **Open Question**: Should we batch events every 100ms?',
      ].join('\n'),
    });

    expect(t2.detail?.technicalDetails).toEqual(['**Architecture**: Event-driven pipeline.']);
    expect(t2.detail?.openQuestions).toEqual(['Should we batch events every 100ms?']);

    // 3. Standalone "### Technical Details & Architecture" and "### Open Questions & Decisions" (Sleep-190 repro)
    const t3 = await adapter.createTicket({
      title: 'Standalone Headings With Suffixes',
      category: 'Feature',
      projectCode: 'Core',
      detailMarkdown: [
        '### Summary',
        'Standalone sections with & Architecture and & Decisions suffixes.',
        '',
        '### Technical Details & Architecture',
        '- **Root Cause**: Strict newline regex missed & Architecture suffix.',
        '- **Key Modules**: `src/storage/filesystem.ts`, `src/ui/planParser.ts`',
        '',
        '### Open Questions & Decisions',
        '- None recorded at initialization.',
      ].join('\n'),
    });

    expect(t3.detail?.technicalDetails).toEqual([
      '**Root Cause**: Strict newline regex missed & Architecture suffix.',
      '**Key Modules**: `src/storage/filesystem.ts`, `src/ui/planParser.ts`',
    ]);
    expect(t3.detail?.openQuestions).toEqual([]);
  });

  it('recognizes Task Breakdown, Fix Breakdown, and Implementation Breakdown aliases and groups indented sub-bullets (Ticket #71)', async () => {
    const bugTicket = await adapter.createTicket({
      title: 'Bug With Fix Breakdown',
      category: 'Bug',
      projectCode: 'Core',
      detailMarkdown: [
        '### Summary',
        'Verify Fix Breakdown alias and sub-bullet grouping.',
        '',
        '### Fix Breakdown',
        '1. **Update Parser Regex**:',
        '   - Support `Task Breakdown` and `Fix Breakdown` headings.',
        '   - Preserve indented sub-bullets under parent step.',
        '2. **Add Regression Tests**:',
        '   - Verify snapshot compilation.',
      ].join('\n'),
    });

    expect(bugTicket.detail?.breakdown).toHaveLength(2);
    expect(bugTicket.detail?.breakdown[0]).toContain('**Update Parser Regex**:');
    expect(bugTicket.detail?.breakdown[0]).toContain('- Support `Task Breakdown` and `Fix Breakdown` headings.');
    expect(bugTicket.detail?.breakdown[1]).toContain('**Add Regression Tests**:');

    // Ensure formatTicketDetailMarkdown did not append a duplicate "### Feature Breakdown" section
    expect(bugTicket.detail?.raw).toContain('### Fix Breakdown');
    expect(bugTicket.detail?.raw).not.toContain('### Feature Breakdown');

    const taskTicket = await adapter.createTicket({
      title: 'Tools With Task Breakdown',
      category: 'Tools',
      projectCode: 'Core',
      detailMarkdown: [
        '### Summary',
        'Verify Task Breakdown alias.',
        '',
        '### Task Breakdown',
        '1. First task item',
        '2. Second task item',
      ].join('\n'),
    });

    expect(taskTicket.detail?.breakdown).toEqual(['First task item', 'Second task item']);
    expect(taskTicket.detail?.raw).toContain('### Task Breakdown');
    expect(taskTicket.detail?.raw).not.toContain('### Feature Breakdown');
  });

  it('reconciles bulleted and unbulleted metadata headers (Status, Complexity, Effort) on partial updates without duplicating blocks (Ticket #74)', async () => {
    const ticket = await adapter.createTicket({
      title: 'Metadata Sync Target',
      category: 'Tools',
      projectCode: 'Core',
      priority: 'Medium',
      complexity: 'Low',
      estimatedEffort: '1.0 - 2.0 hours',
      detailMarkdown: [
        '# Ticket #1: Metadata Sync Target',
        '- **Status**: Planned',
        '- **Priority**: Medium',
        '- **Complexity**: Low',
        '- **Effort**: 1.0 - 2.0 hours',
        '',
        '### Summary',
        'Verify preamble metadata synchronization.',
      ].join('\n'),
    });

    // Ensure formatTicketDetailMarkdown did not duplicate Complexity/Effort lines
    const initialRaw = ticket.detail?.raw || '';
    expect((initialRaw.match(/\*\*Complexity\*\*:/gi) || []).length).toBe(1);
    expect((initialRaw.match(/\*\*(?:Estimated\s+)?Effort\*\*:/gi) || []).length).toBe(1);

    // Partial update to complexity, effort, and status (without passing detailMarkdown)
    const updated = await adapter.updateTicket(ticket.meta.id, {
      status: 'Completed',
      complexity: 'Low-Medium',
      estimatedEffort: '1.5 - 3.0 hours',
    });

    expect(updated.meta.status).toBe('Completed');
    expect(updated.meta.complexity).toBe('Low-Medium');
    expect(updated.meta.estimatedEffort).toBe('1.5 - 3.0 hours');
    expect(updated.detail?.complexity).toBe('Low-Medium');
    expect(updated.detail?.estimatedEffort).toBe('1.5 - 3.0 hours');
    expect(updated.detail?.raw).toContain('- **Status**: Completed');
    expect(updated.detail?.raw).toContain('- **Complexity**: Low-Medium');
    expect(updated.detail?.raw).toContain('- **Effort**: 1.5 - 3.0 hours');
    expect(updated.detail?.raw).not.toContain('- **Complexity**: Low\n');
    expect(updated.detail?.raw).not.toContain('1.0 - 2.0 hours');
  });

  it('preserves existing estimatedEffort and never writes literal undefined when omitted in updateTicket (Ticket #82)', async () => {
    const ticket = await adapter.createTicket({
      title: 'Effort Preservation Test',
      category: 'Feature',
      projectCode: 'Core',
      estimatedEffort: '2.0 - 3.5 hours',
      detailMarkdown: [
        '# Ticket #1: Effort Preservation Test',
        '**Category**: Feature  ',
        '**Complexity**: Medium  ',
        '**Estimated Effort**: 2.0 - 3.5 hours  ',
        '',
        '### Summary',
        'Initial specification summary.',
      ].join('\n'),
    });

    expect(ticket.meta.estimatedEffort).toBe('2.0 - 3.5 hours');
    expect(ticket.detail?.estimatedEffort).toBe('2.0 - 3.5 hours');

    // Update only detail without passing estimatedEffort
    const updated = await adapter.updateTicket(ticket.meta.id, {
      detailMarkdown: [
        '# Ticket #1: Effort Preservation Test',
        '**Category**: Feature  ',
        '**Complexity**: Medium  ',
        '**Estimated Effort**: 2.0 - 3.5 hours  ',
        '',
        '### Summary',
        'Updated summary without specifying effort in updates payload.',
      ].join('\n'),
    });

    expect(updated.meta.estimatedEffort).toBe('2.0 - 3.5 hours');
    expect(updated.detail?.estimatedEffort).toBe('2.0 - 3.5 hours');
    expect(updated.detail?.raw).not.toContain('undefined');
    expect(updated.detail?.raw).toContain('**Estimated Effort**: 2.0 - 3.5 hours');
  });

  it('supports simultaneous implementation plan attachment in createTicket and updateTicket (Ticket #80)', async () => {
    // 1. Create ticket with initial planMarkdown
    const ticket = await adapter.createTicket({
      title: 'Ticket with Atomic Plan',
      category: 'Feature',
      projectCode: 'Core',
      summary: 'Testing simultaneous plan creation',
      planMarkdown: '# Architecture Plan\n- Step 1: Initialize database\n- Step 2: Configure routes',
    });

    expect(ticket.planMarkdown).toBeDefined();
    expect(ticket.planMarkdown).toContain('# Architecture Plan');
    const plan = await adapter.getPlan(ticket.meta.id);
    expect(plan).toContain('# Architecture Plan');
    expect(plan).toContain('Step 1: Initialize database');

    // 2. Update ticket and plan simultaneously
    const updated = await adapter.updateTicket(ticket.meta.id, {
      status: 'In Development',
      planMarkdown: '# Updated Architecture Plan\n- Step 1: Completed\n- Step 2: In progress\n- Step 3: Deployment',
    });

    expect(updated.meta.status).toBe('In Development');
    expect(updated.planMarkdown).toBeDefined();
    expect(updated.planMarkdown).toContain('# Updated Architecture Plan');
    const updatedPlan = await adapter.getPlan(ticket.meta.id);
    expect(updatedPlan).toContain('# Updated Architecture Plan');
    expect(updatedPlan).toContain('Step 3: Deployment');
  });

  it('prewarms ticket cache in chunks and reconciles concurrent CLI/disk mutations during prewarm (Ticket #88)', async () => {
    await adapter.createTicket({
      title: 'Prewarm Ticket One',
      projectCode: 'Core',
      summary: 'Initial summary one',
    });
    await adapter.createTicket({
      title: 'Prewarm Ticket Two',
      projectCode: 'Core',
      summary: 'Initial summary two',
    });
    await adapter.createTicket({
      title: 'Prewarm Ticket Three',
      projectCode: 'Core',
      summary: 'Initial summary three',
    });

    // Fresh adapter instance simulating daemon startup with cold cache
    const daemonAdapter = new FilesystemStorageAdapter(tempDir);
    // Separate adapter instance simulating an external CLI process mutating disk during pre-warming
    const cliAdapter = new FilesystemStorageAdapter(tempDir);

    let mutatedMidPrewarm = false;
    await daemonAdapter.prewarmCache({
      chunkSize: 1,
      onChunkYield: async (processedCount) => {
        if (processedCount === 1 && !mutatedMidPrewarm) {
          mutatedMidPrewarm = true;
          // Ticket #1 was already scanned in chunk 1; mutate it via CLI adapter while prewarm is scanning chunk 2/3
          await cliAdapter.updateTicket(1, {
            title: 'CLI Mutated During Prewarm',
            status: 'In Development',
            detail: '# Ticket #1: CLI Mutated During Prewarm\n\n### Summary\nUpdated by CLI mid-prewarm.',
          });
        }
      },
    });

    expect(mutatedMidPrewarm).toBe(true);
    const t1 = await daemonAdapter.getTicket(1);
    expect(t1?.meta.title).toBe('CLI Mutated During Prewarm');
    expect(t1?.meta.status).toBe('In Development');
    expect(t1?.detail?.summary).toBe('Updated by CLI mid-prewarm.');

    const allTickets = await daemonAdapter.listTickets();
    const listedT1 = allTickets.find((t) => t.meta.id === 1);
    expect(listedT1?.meta.title).toBe('CLI Mutated During Prewarm');
    expect(listedT1?.meta.status).toBe('In Development');

    daemonAdapter.closeWatchers();
  });
});

