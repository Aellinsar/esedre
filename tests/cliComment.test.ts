import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { FilesystemStorageAdapter } from '../src/storage/filesystem.js';
import { EsedreMcpServer } from '../src/mcp/server.js';

describe('Esedre CLI comment --file and MCP file support (Ticket #62)', () => {
  let tempDir: string;
  let cliScriptPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esedre-comment-test-'));
    cliScriptPath = path.resolve(__dirname, '..', 'dist', 'esedre.mjs');

    const ticketsDir = path.join(tempDir, '.esedre', 'tickets', '1');
    fs.mkdirSync(ticketsDir, { recursive: true });

    // .esedre/esedre.json
    fs.writeFileSync(
      path.join(tempDir, '.esedre', 'esedre.json'),
      JSON.stringify(
        {
          projectCode: 'Core',
          allowedProjects: ['Core'],
        },
        null,
        2
      )
    );

    // Seed ticket #1
    fs.writeFileSync(
      path.join(ticketsDir, 'meta.json'),
      JSON.stringify(
        {
          id: 1,
          title: 'Core Engine Feature',
          type: 'Feature',
          category: 'Feature',
          status: 'Planned',
          project: 'Core',
        },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(ticketsDir, 'detail.md'), '# Ticket #1: Core Engine Feature\n');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const runCli = (args: string[], cwd: string = tempDir): { stdout: string; stderr: string; status: number } => {
    try {
      const stdout = execFileSync(process.execPath, [cliScriptPath, ...args], {
        cwd,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ESEDRE_GLOBAL_DIR: path.join(tempDir, 'global-store'),
        },
      });
      return { stdout, stderr: '', status: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout?.toString() || '',
        stderr: err.stderr?.toString() || '',
        status: err.status ?? 1,
      };
    }
  };

  it('successfully appends a comment from a file preserving percent signs verbatim', () => {
    const notePath = path.join(tempDir, 'comment-note.md');
    const commentBody = 'Verified 100% accurate: 50% performance increase with 0% regression.\n\nCode snippet: `const pct = 100%;`';
    fs.writeFileSync(notePath, commentBody, 'utf-8');

    const res = runCli(['comment', '1', '--file', 'comment-note.md']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Added comment to Ticket #1');

    // Verify on disk in comments.json
    const commentsJsonPath = path.join(tempDir, '.esedre', 'tickets', '1', 'comments.json');
    expect(fs.existsSync(commentsJsonPath)).toBe(true);
    const comments = JSON.parse(fs.readFileSync(commentsJsonPath, 'utf-8'));
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe(commentBody);
    expect(comments[0].author).toBe('User');
  });

  it('--file takes precedence over positional text and --text', () => {
    const notePath = path.join(tempDir, 'file-priority.md');
    const fileContent = 'Authoritative content from file.';
    fs.writeFileSync(notePath, fileContent, 'utf-8');

    const res = runCli(['comment', '1', 'ignored positional text', '--text', 'ignored flag text', '--file', 'file-priority.md']);
    expect(res.status).toBe(0);

    const commentsJsonPath = path.join(tempDir, '.esedre', 'tickets', '1', 'comments.json');
    const comments = JSON.parse(fs.readFileSync(commentsJsonPath, 'utf-8'));
    expect(comments[0].text).toBe(fileContent);
  });

  it('outputs structured JSON when --json is provided with --file', () => {
    const notePath = path.join(tempDir, 'json-note.md');
    fs.writeFileSync(notePath, 'Structured JSON test comment %value%.', 'utf-8');

    const res = runCli(['comment', '1', '--file', 'json-note.md', '--author', 'AutomatedBot', '--json']);
    expect(res.status).toBe(0);

    const json = JSON.parse(res.stdout);
    expect(json.author).toBe('AutomatedBot');
    expect(json.text).toBe('Structured JSON test comment %value%.');
    expect(json.timestamp).toBeDefined();
  });

  it('exits with code 1 and descriptive error when --file does not exist', () => {
    const res = runCli(['comment', '1', '--file', 'nonexistent-file.md']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Error: File not found: nonexistent-file.md');
  });

  it('exits with code 1 and descriptive error when --file points to a directory', () => {
    const subDir = path.join(tempDir, 'sample-dir');
    fs.mkdirSync(subDir, { recursive: true });

    const res = runCli(['comment', '1', '--file', 'sample-dir']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Error: Path is not a file: sample-dir');
  });

  it('exits with code 1 and descriptive error when --file is empty', () => {
    const emptyPath = path.join(tempDir, 'empty.md');
    fs.writeFileSync(emptyPath, '   \n  \t  \n', 'utf-8');

    const res = runCli(['comment', '1', '--file', 'empty.md']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Error: Comment file is empty: empty.md');
  });

  it('exits with code 1 when neither text nor --file is provided', () => {
    const res = runCli(['comment', '1']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Error: Comment text or --file is required');
  });

  it('supports file property in MCP esedre_add_comment tool', async () => {
    const adapter = new FilesystemStorageAdapter(tempDir);
    const server = new EsedreMcpServer(adapter);

    const mcpFilePath = path.join(tempDir, 'mcp-comment.md');
    const mcpContent = 'Verified from MCP via file: 100% PASS with 0% errors.';
    fs.writeFileSync(mcpFilePath, mcpContent, 'utf-8');

    const callRpc = async (rpcServer: any, msg: any) => {
      const response = await (rpcServer as any).handleRequest(msg);
      return response;
    };

    const res = await callRpc(server, {
      jsonrpc: '2.0',
      id: 100,
      method: 'tools/call',
      params: {
        name: 'esedre_add_comment',
        arguments: {
          ticketId: 1,
          file: mcpFilePath,
          author: 'AgentTest',
        },
      },
    });

    expect(res.result).toBeDefined();
    const comment = JSON.parse(res.result.content[0].text);
    expect(comment.author).toBe('AgentTest');
    expect(comment.text).toBe(mcpContent);

    // Assert file not found in MCP
    const errRes = await callRpc(server, {
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: {
        name: 'esedre_add_comment',
        arguments: {
          ticketId: 1,
          file: path.join(tempDir, 'missing.md'),
        },
      },
    });

    expect(errRes.error).toBeDefined();
    expect(errRes.error.message).toContain('File not found:');
  });
});
