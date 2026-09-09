import fs from 'node:fs';
import path from 'node:path';

export function createMockDataset(baseDir) {
  if (fs.existsSync(baseDir)) {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
  fs.mkdirSync(baseDir, { recursive: true });

  const projectsDir = path.join(baseDir, 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });

  const projects = [
    {
      id: 1,
      code: 'Web',
      slug: 'web',
      name: 'Web Dashboard',
      description: 'React planning dashboard, Kanban roadmap, and embeddable web components',
      colors: {
        badge: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
        dot: 'bg-indigo-400',
        border: 'border-indigo-500/40',
      },
      tickets: [
        {
          id: 1,
          title: 'Keyboard shortcuts for ticket navigation (j/k/Enter)',
          type: 'Feature',
          complexity: 'Medium',
          estimatedEffort: '2.0 - 3.0 hours',
          status: 'In Development',
          inDevelopment: true,
          submittedBy: 'Matt G',
          summary: 'Add keyboard navigation to jump between ticket cards using j and k keys, open ticket specs with Enter or Space, and close drawers with Escape.',
          breakdown: [
            'Global keydown event listener with focus management',
            'Visual active card focus ring and auto-scroll into view',
            'Disable shortcuts when typing inside inputs or search fields',
            'Add keyboard shortcuts cheatsheet modal (?)',
          ],
          plan: `# Implementation Plan: Keyboard Navigation\n\n## Summary\nPower users and developers want rapid keyboard traversal without taking hands off the keyboard.\n\n## Tasks\n- [x] Create useKeyboardShortcuts custom hook\n- [x] Add active focus indicator styling\n- [ ] Auto-scroll focused card into view\n- [ ] Write unit tests for input field exclusion\n`,
          comments: [
            { id: 'c1', author: 'Matt G', text: 'Tested basic j/k movement on desktop. Need to ensure search input is excluded.', timestamp: '2026-09-08T10:15:00.000Z' },
            { id: 'c2', author: 'Sarah Jenkins', text: 'Please make sure Escape closes both the detail drawer and any active modal.', timestamp: '2026-09-08T11:40:00.000Z' },
          ],
        },
        {
          id: 2,
          title: 'Warn before closing modal with unsaved plan edits',
          type: 'Feature',
          complexity: 'Low',
          estimatedEffort: '1.0 - 2.0 hours',
          status: 'In Development',
          inDevelopment: true,
          submittedBy: 'Sarah Jenkins',
          summary: 'Prompt a confirmation dialog when clicking the backdrop or pressing Escape if the implementation plan editor has unsaved changes.',
          breakdown: [
            'Track dirty state between initial content and current textarea value',
            'Intercept modal backdrop click and Escape key when dirty is true',
            'Show lightweight confirmation modal (Discard changes / Keep editing)',
          ],
          plan: `# Implementation Plan: Unsaved Changes Prompt\n\n- [x] Add isDirty boolean state to editor container\n- [ ] Hook into ConfirmationModal on dismiss\n`,
          comments: [
            { id: 'c3', author: 'Sarah Jenkins', text: 'Happened to me twice yesterday clicking outside the modal. High priority UX fix.', timestamp: '2026-09-08T09:30:00.000Z' },
          ],
        },
        {
          id: 3,
          title: 'Fix search input losing focus during fast keystrokes',
          type: 'Bug',
          complexity: 'Low',
          estimatedEffort: '1.0 hour',
          status: 'Completed',
          submittedBy: 'Alex Chen',
          summary: 'Debounce ticket filtering state updates to prevent immediate parent re-renders from stealing focus while typing rapidly in the search bar.',
          breakdown: [
            'Use local input state and debounce filter propagation by 150ms',
            'Prevent full card list reconciliation on every keystroke',
          ],
          plan: `# Implementation Plan: Fix Search Focus\n\n- [x] Implement useDebouncedValue hook\n- [x] Verify search input retains caret and focus\n`,
          comments: [
            { id: 'c4', author: 'Alex Chen', text: 'Fixed. Verified typing 100wpm without any focus loss or dropped characters.', timestamp: '2026-09-07T16:20:00.000Z' },
          ],
        },
        {
          id: 4,
          title: 'Virtualize ticket list for repos with 200+ tickets',
          type: 'Feature',
          complexity: 'High',
          estimatedEffort: '4.0 - 6.0 hours',
          status: 'Planned',
          submittedBy: 'Elena Rostova',
          summary: 'Implement dynamic row virtualization for the main ticket feed to maintain 60fps scrolling on large codebases with hundreds of tickets.',
          breakdown: [
            'Measure card heights dynamically with ResizeObserver',
            'Window visible items plus 5 item overscan buffer',
            'Keep sticky table of contents aligned during virtual scroll',
          ],
          plan: '',
          comments: [],
        },
        {
          id: 5,
          title: 'Export active roadmap to Markdown and CSV',
          type: 'Tools',
          complexity: 'Low',
          estimatedEffort: '1.5 hours',
          status: 'Completed',
          submittedBy: 'Matt G',
          summary: 'Add an export dropdown in the header to download the currently filtered ticket list as a CSV file or formatted Markdown summary.',
          breakdown: [
            'Format ticket ID, title, type, status, effort into CSV format',
            'Generate clean Markdown table summary with links',
            'Trigger client-side file download via Blob URL',
          ],
          plan: `# Implementation Plan: Roadmap Export\n\n- [x] CSV export generator\n- [x] Markdown table builder\n- [x] Header dropdown UI\n`,
          comments: [
            { id: 'c5', author: 'Matt G', text: 'Export tested with both All Projects and single project filters.', timestamp: '2026-09-06T14:10:00.000Z' },
          ],
        },
        {
          id: 6,
          title: 'Fix bottom toolbar clipping on mobile Safari',
          type: 'Bug',
          complexity: 'Low',
          estimatedEffort: '1.0 hour',
          status: 'Completed',
          submittedBy: 'David Kim',
          summary: 'Apply env(safe-area-inset-bottom) padding so the iOS Safari dynamic bottom bar does not overlap the filter toolbar or action buttons.',
          breakdown: [
            'Add pb-[env(safe-area-inset-bottom)] to viewport wrapper',
            'Verify layout on iPhone 15 Safari viewport simulator',
          ],
          plan: `# Implementation Plan: Safe Area Padding\n\n- [x] Add safe-area CSS utilities\n- [x] Verify mobile drawer scrolling\n`,
          comments: [
            { id: 'c6', author: 'David Kim', text: 'Verified on physical iPhone test device. Looks clean now.', timestamp: '2026-09-05T18:00:00.000Z' },
          ],
        },
        {
          id: 7,
          title: 'Support interactive task checkboxes in ticket detail',
          type: 'Idea',
          complexity: 'Medium',
          estimatedEffort: '2.0 - 3.0 hours',
          status: 'Planned',
          submittedBy: 'Sarah Jenkins',
          summary: 'Allow toggling markdown task checkboxes directly in the rendered ticket view without needing to open the raw detail.md editor.',
          breakdown: [
            'Parse line index of markdown task items in AST',
            'Add onClick handler updating corresponding markdown line',
            'Auto-save updated detail markdown with optimistic concurrency',
          ],
          plan: '',
          comments: [],
        },
        {
          id: 8,
          title: 'Auto-save plan drafts to local storage every 30s',
          type: 'Feature',
          complexity: 'Medium',
          estimatedEffort: '2.5 - 3.5 hours',
          status: 'In Development',
          inDevelopment: true,
          submittedBy: 'Alex Chen',
          summary: 'Buffer in-progress plan edits in browser localStorage so unexpected tab reloads or crashes do not lose work.',
          breakdown: [
            'Persist draft keyed by ticket ID and revision hash',
            'Display "Draft recovered" notification banner when reopening',
            'Clear draft on successful remote save',
          ],
          plan: `# Implementation Plan: Local Plan Autosave\n\n- [x] Draft storage manager\n- [ ] Restore draft notification bar\n`,
          comments: [],
        },
        {
          id: 9,
          title: 'Lorem ipsum dolor sit amet placeholder test',
          type: 'Idea',
          complexity: 'Low',
          estimatedEffort: '0.5 hours',
          status: 'Planned',
          submittedBy: 'Matt G',
          summary: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
          breakdown: [
            'Duis aute irure dolor in reprehenderit in voluptate velit esse',
            'Cillum dolore eu fugiat nulla pariatur excepteur sint',
            'Sunt in culpa qui officia deserunt mollit anim id est laborum',
          ],
          plan: '',
          comments: [
            { id: 'c-lorem', author: 'Matt G', text: 'Testing card layout with standard latin dummy text.', timestamp: '2026-09-08T15:00:00.000Z' },
          ],
        },
      ],
    },
    {
      id: 2,
      code: 'Core',
      slug: 'core',
      name: 'Planning Engine',
      description: 'Filesystem storage adapter, multi-topology resolver, and MCP server backend',
      colors: {
        badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
        dot: 'bg-emerald-400',
        border: 'border-emerald-500/40',
      },
      tickets: [
        {
          id: 1,
          title: 'Model Context Protocol (MCP) Server for LLM agents',
          type: 'Feature',
          complexity: 'Medium',
          estimatedEffort: '3.5 - 5.0 hours',
          status: 'In Development',
          inDevelopment: true,
          featureFlag: 'ENABLE_MCP_SERVER',
          submittedBy: 'Matt G',
          summary: 'Implement full JSON-RPC 2.0 stdio server implementing the official MCP specification (2024-11-05), exposing tickets and plans as first-class tools for companion LLMs.',
          breakdown: [
            'MCP protocol lifecycle (initialize, tools/list, tools/call)',
            'Expose esedre_list_tickets, esedre_get_ticket, and esedre_save_plan',
            'Optimistic concurrency protection with sha1 hash checking',
            'Full integration tests against mock stdio streams',
          ],
          plan: `# Implementation Plan: MCP Server\n\n- [x] JSON-RPC stdio message transport\n- [x] Tool schema registrations\n- [ ] Resource template routing for tickets://\n- [ ] End-to-end integration tests\n`,
          comments: [
            { id: 'c7', author: 'Matt G', text: 'Standardized on 2024-11-05 protocol spec. Tested with local inspector.', timestamp: '2026-09-08T08:45:00.000Z' },
          ],
        },
        {
          id: 2,
          title: 'Optimistic concurrency control via SHA-1 content hashing',
          type: 'Platform',
          complexity: 'Medium',
          estimatedEffort: '2.5 - 3.5 hours',
          status: 'Completed',
          submittedBy: 'Alex Chen',
          summary: 'Compare incoming lastHash against computed ticket digest before saving mutations to prevent concurrent edits from overwriting each other.',
          breakdown: [
            'Compute canonical SHA-1 digest across ticket metadata and plan',
            'Throw EsedreConflictError on hash divergence',
            'Return current hash in all GET and update responses',
          ],
          plan: `# Implementation Plan: OCC Protection\n\n- [x] Content digest calculation utility\n- [x] Verification checks in storage adapter\n- [x] Conflict error handling tests\n`,
          comments: [
            { id: 'c8', author: 'Alex Chen', text: 'Verified race condition tests pass cleanly across simultaneous workers.', timestamp: '2026-09-07T11:00:00.000Z' },
          ],
        },
        {
          id: 3,
          title: 'Batch ticket status updates and bulk actions',
          type: 'Feature',
          complexity: 'Medium',
          estimatedEffort: '3.0 - 4.5 hours',
          status: 'Planned',
          submittedBy: 'Elena Rostova',
          summary: 'Support multi-select in ticket views to bulk transition items to Completed, Shelved, or update target milestones in a single operation.',
          breakdown: [
            'Add selection checkbox column to list view',
            'Floating multi-select batch action toolbar',
            'Atomic multi-ticket mutation endpoint in API server',
          ],
          plan: '',
          comments: [],
        },
        {
          id: 4,
          title: 'Fast filesystem watcher for external git branch switches',
          type: 'Platform',
          complexity: 'High',
          estimatedEffort: '4.0 - 5.5 hours',
          status: 'In Development',
          inDevelopment: true,
          submittedBy: 'David Kim',
          summary: 'Watch ticket directories for filesystem changes (such as git checkout or pull) and trigger instant in-memory cache invalidation.',
          breakdown: [
            'Debounced recursive directory watcher on dataDir',
            'Invalidate cached /api/planning/all payload on file touch',
            'Broadcast change notification to UI via server-sent events',
          ],
          plan: `# Implementation Plan: Filesystem Watcher\n\n- [x] Watcher initialization logic\n- [x] Cache invalidation callback\n- [ ] Server-sent events endpoint\n`,
          comments: [
            { id: 'c9', author: 'David Kim', text: 'Debounce window set to 250ms to handle rapid git checkouts smoothly.', timestamp: '2026-09-08T13:20:00.000Z' },
          ],
        },
        {
          id: 5,
          title: 'Lean context snapshot projection (.esedre/snapshot.json)',
          type: 'Tools',
          complexity: 'Low',
          estimatedEffort: '2.0 hours',
          status: 'Completed',
          submittedBy: 'Matt G',
          summary: 'Compile all active tickets and plans into a compact local JSON snapshot file so companion LLM agents get instant context with zero CLI overhead.',
          breakdown: [
            'Extract active tickets, summaries, plans, and revisions',
            'Compute ticket staleness metrics (daysSinceUpdate)',
            'Auto-regenerate snapshot on ticket write mutations',
          ],
          plan: `# Implementation Plan: Snapshot Generation\n\n- [x] Projection builder function\n- [x] Auto-trigger on CLI mutations\n- [x] Staleness metric calculation\n`,
          comments: [
            { id: 'c10', author: 'Matt G', text: 'Agents load snapshot in ~1ms directly from disk before starting work.', timestamp: '2026-09-06T17:00:00.000Z' },
          ],
        },
        {
          id: 6,
          title: 'Custom webhook dispatch on ticket milestone completion',
          type: 'Idea',
          complexity: 'Medium',
          estimatedEffort: '3.5 - 5.0 hours',
          status: 'Planned',
          submittedBy: 'Sarah Jenkins',
          summary: 'Configure outgoing HTTP POST webhook notifications to Discord, Slack, or GitHub issues when tickets transition to Completed status.',
          breakdown: [
            'Add webhooks configuration array in esedre.json',
            'Asynchronous fetch dispatcher with exponential retry backoff',
            'Standardized JSON webhook payload with ticket metadata',
          ],
          plan: '',
          comments: [],
        },
        {
          id: 7,
          title: 'Normalize path separators across Windows and POSIX',
          type: 'Bug',
          complexity: 'Low',
          estimatedEffort: '1.0 hour',
          status: 'Completed',
          submittedBy: 'Matt G',
          summary: 'Ensure path.normalize and path.resolve produce consistent forward slashes for internal ticket key comparisons on Windows platforms.',
          breakdown: [
            'Replace Windows backslashes in compound keys and route params',
            'Cross-platform path test coverage in vitest suite',
          ],
          plan: `# Implementation Plan: Path Normalization\n\n- [x] Add path normalization helper\n- [x] Unit test on Windows shell\n`,
          comments: [
            { id: 'c11', author: 'Matt G', text: 'All 15 test suites passing on both Windows and Linux CI runners.', timestamp: '2026-09-05T12:00:00.000Z' },
          ],
        },
      ],
    },
    {
      id: 3,
      code: 'CLI',
      slug: 'cli',
      name: 'Developer CLI',
      description: 'Fast command line tool (esedre / ese), daemon manager, and project initializer',
      colors: {
        badge: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
        dot: 'bg-cyan-400',
        border: 'border-cyan-500/40',
      },
      tickets: [
        {
          id: 1,
          title: 'Interactive terminal picker for "ese get" and "ese plan"',
          type: 'Tools',
          complexity: 'Medium',
          estimatedEffort: '2.5 - 3.5 hours',
          status: 'In Development',
          inDevelopment: true,
          submittedBy: 'Matt G',
          summary: 'When running ese get or ese plan without a ticket ID argument in an interactive terminal, launch a clean searchable fuzzy picker.',
          breakdown: [
            'Detect process.stdout.isTTY before launching interactive prompt',
            'Fuzzy search across ticket numbers, titles, and tags',
            'Arrow key navigation and instant detail preview',
          ],
          plan: `# Implementation Plan: CLI Interactive Picker\n\n- [x] Terminal TTY detection\n- [ ] Keypress listener and ANSI cursor controls\n- [ ] Search filter integration\n`,
          comments: [
            { id: 'c12', author: 'Matt G', text: 'Great quality of life improvement when you forget a ticket number.', timestamp: '2026-09-08T14:00:00.000Z' },
          ],
        },
        {
          id: 2,
          title: 'Responsive ANSI table formatting with column wrapping',
          type: 'Tools',
          complexity: 'Low',
          estimatedEffort: '2.0 hours',
          status: 'Completed',
          submittedBy: 'Elena Rostova',
          summary: 'Auto-detect terminal column width and intelligently wrap title and summary columns so wide terminal outputs never wrap awkwardly.',
          breakdown: [
            'Read process.stdout.columns with sensible 80-column fallback',
            'Word-wrapping helper respecting ANSI color escape code boundaries',
            'Fixed-width status and ID columns with flexible title column',
          ],
          plan: `# Implementation Plan: Terminal Table Formatting\n\n- [x] Column width calculator\n- [x] ANSI-aware text wrapping\n- [x] Clean borders\n`,
          comments: [
            { id: 'c13', author: 'Elena Rostova', text: 'Tested in 80-column narrow terminals and 160-column ultra-wides.', timestamp: '2026-09-06T11:30:00.000Z' },
          ],
        },
        {
          id: 3,
          title: 'Fix daemon launcher holding parent file handle on Windows',
          type: 'Bug',
          complexity: 'Low',
          estimatedEffort: '1.5 hours',
          status: 'Completed',
          submittedBy: 'David Kim',
          summary: 'Explicitly close parent stdio file descriptors immediately after unref to avoid file locking on daemon.log during restarts.',
          breakdown: [
            'Call fs.closeSync(outFd) and fs.closeSync(errFd) post child.unref()',
            'Add dual liveness check (PID + HTTP ping) before reporting daemon active',
          ],
          plan: `# Implementation Plan: Windows FD Fix\n\n- [x] Close parent file handles\n- [x] Dual HTTP liveness check\n`,
          comments: [
            { id: 'c14', author: 'David Kim', text: 'Verified daemon stop and start loop 20 times with zero EBUSY locks.', timestamp: '2026-09-04T16:00:00.000Z' },
          ],
        },
        {
          id: 4,
          title: 'Support piped stdin for adding comments from scripts',
          type: 'Feature',
          complexity: 'Low',
          estimatedEffort: '1.0 - 1.5 hours',
          status: 'Planned',
          submittedBy: 'Alex Chen',
          summary: 'Allow piping verification output or git diff summaries directly into ticket comments via "cat test.log | ese comment 12".',
          breakdown: [
            'Read from process.stdin when --text is omitted and stdin is not a TTY',
            'Enforce max comment size limit (32KB)',
            'Auto-format preformatted markdown code blocks when input has newlines',
          ],
          plan: '',
          comments: [],
        },
        {
          id: 5,
          title: 'Shell tab-completion scripts for bash and zsh',
          type: 'Idea',
          complexity: 'Medium',
          estimatedEffort: '2.0 - 3.0 hours',
          status: 'Planned',
          submittedBy: 'Sarah Jenkins',
          summary: 'Provide "ese completion bash" and "ese completion zsh" commands to generate shell tab completions for commands, flags, and project codes.',
          breakdown: [
            'Dynamic completion generator function',
            'Complete ticket IDs based on local .esedre/snapshot.json',
            'Install instructions in configure guided output',
          ],
          plan: '',
          comments: [],
        },
      ],
    },
  ];

  for (const proj of projects) {
    const pDir = path.join(projectsDir, proj.code);
    const ticketsDir = path.join(pDir, 'tickets');
    fs.mkdirSync(ticketsDir, { recursive: true });

    const pJson = {
      id: proj.id,
      code: proj.code,
      slug: proj.slug,
      name: proj.name,
      description: proj.description,
      colors: proj.colors,
    };
    fs.writeFileSync(path.join(pDir, 'project.json'), JSON.stringify(pJson, null, 2) + '\n', 'utf-8');

    for (const t of proj.tickets) {
      const tDir = path.join(ticketsDir, String(t.id));
      fs.mkdirSync(tDir, { recursive: true });

      const meta = {
        id: t.id,
        title: t.title,
        type: t.type,
        category: t.type,
        complexity: t.complexity,
        estimatedEffort: t.estimatedEffort,
        status: t.status,
        inDevelopment: t.inDevelopment || false,
        featureFlag: t.featureFlag,
        submittedBy: t.submittedBy,
        timestamp: '2026-09-08T09:00:00.000Z',
        projectId: proj.id,
        project: proj.code,
        revision: 2,
        isActivePlanning: t.status === 'In Development' || t.status === 'Planned',
      };
      fs.writeFileSync(path.join(tDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf-8');

      const breakdownLines = t.breakdown.map((b) => `- ${b}`).join('\n');
      const detailMd = `# Ticket #${t.id}: ${t.title}

**Type**: ${t.type}
**Complexity**: ${t.complexity}
**Estimated Effort**: ${t.estimatedEffort}

## Summary
${t.summary}

## Feature Breakdown
${breakdownLines}
`;
      fs.writeFileSync(path.join(tDir, 'detail.md'), detailMd, 'utf-8');

      if (t.plan) {
        fs.writeFileSync(path.join(tDir, 'implementation_plan.md'), t.plan, 'utf-8');
      }

      if (t.comments && t.comments.length > 0) {
        fs.writeFileSync(path.join(tDir, 'comments.json'), JSON.stringify(t.comments, null, 2) + '\n', 'utf-8');
      }
    }
  }

  console.log(`Realistic mock dataset generated: 3 projects (Web, Core, CLI) and ${projects.reduce((acc, p) => acc + p.tickets.length, 0)} tickets.`);
}

if (process.argv[1] === new URL(import.meta.url).pathname || process.argv[1]?.endsWith('generate-mock-data.mjs')) {
  const target = process.argv[2] || path.join(process.cwd(), '.demo-mock-hub');
  createMockDataset(target);
}
