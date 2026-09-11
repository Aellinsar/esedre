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
});
