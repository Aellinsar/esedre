---
name: esedre_daemon_and_gateway
description: Complete architecture and operations guide for the Esedre background daemon, unified gateway server, port topology, and embedded theme token contract.
---

# Esedre Daemon, Gateway & Embedded UI Architecture

This skill provides an operational and architectural reference for the Esedre daemon lifecycle, gateway proxy routing, and the zero-effort drop-in theme contract.

---

## 1. Server Command Suite

Esedre provides server lifecycle management via clean top-level commands:

```bash
# Start background server daemon on port 5674 (idempotent if already running)
ese start [--port 5674] [--quiet] [--json]

# Run foreground server directly in terminal (blocks terminal, Ctrl+C to stop)
ese start -f [--port 5674]  # or: ese start --foreground

# Check health, uptime, and active project topology
ese status [--port 5674] [--json]

# Tail or view recent server logs
ese logs [--lines <n>]

# Stop running server daemon gracefully
ese stop [--port 5674] [--quiet] [--json]
```

---

## 2. Port Topology & Gateway Proxy Architecture

The unified gateway at port `5674` coordinates two internal sub-services:

| Service | Port | Path | Purpose |
|---|---|---|---|
| **Gateway Proxy** | `5674` | `/` $\rightarrow$ `/app/` | Single public entry point for web browsers, reverse proxies, and tunnels |
| **Web UI Server** | `5675` | `/app` | Serves compiled React 19 UI bundle from `dist/web/` |
| **REST API Server** | `5676` | `/api` | JSON endpoints for ticket inspection, bulk hydration (`/api/planning/all`), leases (`/api/planning/leases`), persistence (`/api/planning/answers`, `/api/planning/details`, `/api/planning/inline-comments`, `/api/planning/upload-attachment`, `/api/planning/attachment`), and health pings |

### Routing Logic
- `GET /` $\rightarrow$ Redirects/rewrites to `/app/`.
- `GET /app` $\rightarrow$ Proxies to internal Web UI (`5675`).
- `GET /api/*` $\rightarrow$ Proxies to internal REST API (`5676`).
- Query parameters: `?project=all` activates cross-project portfolio overview; `?project=Profe` filters to specific project.

### Multi-Project Ticket ID & Performance Architecture
1. **Compound ID Uniqueness**:
   - In cross-project or portfolio mode (`project=all`), numeric ticket IDs collide across repositories (e.g. `Profe-1` vs `Esedre-1`). All storage lookup maps, URL anchors, and React keys must use the compound key `${projectCode}-${ticketNumber}`.
   - **DOM Anchor Invariant**: Ticket cards and scroll targets must strictly use `id="feature-card-${projectCode}-${number}"`, never bare `id="feature-card-${number}"`, preventing DOM query collisions and broken jump navigation.
2. **Prohibition of N+1 Hydration Waterfalls & Summary-First Hydration (`#Esedre-88`)**:
   - Initial UI load and background 10-second polling fetch consolidated lightweight summaries in a single HTTP round-trip via `GET /api/planning/all?summary=1` (with `sinceRevision` / `ETag` `304 Not Modified` short-circuiting when `cacheGeneration` is unchanged).
   - Full heavy markdown and discussion payloads (`detail`, `planMarkdown`, `comments`, `answers`, `inlineComments`) are fetched on demand via `GET /api/planning/ticket/:id` when a user expands a card or opens a deep link, and cached on the client across summary polls while the ticket's `sha1` is unchanged.
   - The right-hand card grid progressively mounts cards in batches of 30 (`visibleCardLimit`) via `IntersectionObserver` while the left-hand Table of Contents and search filter operate across 100% of matching tickets immediately.
   - Sequential N+1 client fetches across `getMetas()`, `getTicketDetails()`, `getAnswers()`, `getComments()`, and `getPlanHistory()` on initial mount are strictly forbidden.
3. **Ticket Lease REST Endpoints**:
   - `GET /api/planning/leases`: Returns active unexpired ticket leases across projects with `remainingSeconds`.
   - `POST /api/planning/leases/claim`: Acquires a ticket lease.
   - `POST /api/planning/leases/release`: Releases an active ticket lease.

---

## 3. Windows Detached Process Pattern

Background daemons use Node.js `child_process.spawn` with detached mode. On Windows, file descriptor handling requires an explicit cleanup pattern:

```typescript
const outFd = fs.openSync(logFile, 'a');
const errFd = fs.openSync(logFile, 'a');

const child = spawn(process.execPath, [cliPath, 'start', '--foreground', '--port', String(port)], {
  detached: true,
  stdio: ['ignore', outFd, errFd],
  cwd: workspaceRoot,
  windowsHide: true,
});

child.unref();

// CRITICAL: Close parent file descriptors immediately after unref()
// to prevent Windows from holding locks on the log file
fs.closeSync(outFd);
fs.closeSync(errFd);
```

### Windows Readiness Watchdog
Cold starts on Windows (especially under Antigravity / WSL / security scans) require sufficient initialization time. The readiness probe (`pingDaemon`) uses a 10,000ms watchdog timeout on Windows (5,000ms on Linux/macOS) with 500ms socket timeouts and 150ms polling intervals, preventing false startup aborts.

### Dynamic Filesystem & Configuration Reloading
The filesystem storage adapter automatically polls configuration files (`esedre.json` and `~/.esedre/config.json`) with a 3-second TTL (`ensureFreshConfig`). Project registrations, data hub additions, and ticket changes on disk are immediately reflected across the API and Web UI without requiring daemon restarts.

---

## 4. Standalone Mode vs Embedded View & Theme Contract

- **Standalone Mode**: Normal, primary operation of Esedre accessed via its dedicated web UI (`/app`, port 5674). The server is ALWAYS run whenever Esedre is utilized (`ese start`).
- **Embedded View**: Optional embedding of `<PlannedWorkView />` inside a host application (e.g., inside a modal or drawer):

```tsx
import { PlannedWorkView } from 'esedre/src/ui/PlannedWorkView';

export function DevPlannerModal({ isOpen, onClose }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
      <div className="w-[95vw] h-[92vh] rounded-2xl overflow-hidden">
        <PlannedWorkView
          initialProject="Prof"
          allowedProjects={['Prof', 'Esedre']}
          showHeader={false}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
```

### Automatic Theme Fallback (Zero Effort)
- If the host application defines **no CSS variables**, `PlannedWorkView` automatically activates its internal fallback bridge (`ESEDRE_THEME_FALLBACK_CSS`).
- Adapts cleanly to dark/light environments via system preferences or `.dark` / `[data-theme]` attributes.

### Full Theme Customization (Inherited Tokens)
If the host defines custom design tokens on `:root` or an ancestor container, the planner automatically adopts them:
- **Surface**: `--bg-surface`, `--bg-surface-elevated`, `--bg-input`
- **Borders**: `--border-subtle`, `--border-strong`, `--border-accent`
- **Text**: `--text-primary`, `--text-secondary`, `--text-muted`
- **Accent**: `--accent-primary`, `--accent-bg-subtle`, `--accent-border-subtle`
