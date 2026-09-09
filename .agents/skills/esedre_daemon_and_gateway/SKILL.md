---
name: esedre_daemon_and_gateway
description: Complete architecture and operations guide for the Esedre background daemon, unified gateway server, port topology, and embedded theme token contract.
---

# Esedre Daemon, Gateway & Embedded UI Architecture

This skill provides an operational and architectural reference for the Esedre daemon lifecycle, gateway proxy routing, and the zero-effort drop-in theme contract.

---

## 1. Daemon Command Suite

Esedre provides background process management via the `daemon` command family (with root aliases `start`, `stop`, `status`):

```bash
# Start background daemon on port 5674 (idempotent if already running)
ese daemon start [--port 5674] [--quiet] [--json]
ese start [--port 5674]

# Check health, uptime, and active project topology
ese daemon status [--port 5674] [--json]
ese status [--port 5674]

# Tail or view recent daemon logs
ese daemon logs

# Stop running daemon gracefully
ese daemon stop [--port 5674] [--quiet] [--json]
ese stop [--port 5674]
```

### Foreground Server Alternative (`serve`)
For active terminal debugging or container environments:
```bash
ese serve [--port 5674]
```

---

## 2. Port Topology & Gateway Proxy Architecture

The unified gateway at port `5674` coordinates two internal sub-services:

| Service | Port | Path | Purpose |
|---|---|---|---|
| **Gateway Proxy** | `5674` | `/` $\rightarrow$ `/app/` | Single public entry point for web browsers, reverse proxies, and tunnels |
| **Web UI Server** | `5675` | `/app` | Serves compiled React 19 UI bundle from `dist/web/` |
| **REST API Server** | `5676` | `/api` | JSON endpoints for ticket inspection, bulk hydration (`/api/planning/all`), and health pings |

### Routing Logic
- `GET /` $\rightarrow$ Redirects/rewrites to `/app/`.
- `GET /app` $\rightarrow$ Proxies to internal Web UI (`5675`).
- `GET /api/*` $\rightarrow$ Proxies to internal REST API (`5676`).
- Query parameters: `?project=all` activates cross-project portfolio overview; `?project=Profe` filters to specific project.

---

## 3. Windows Detached Process Pattern

Background daemons use Node.js `child_process.spawn` with detached mode. On Windows, file descriptor handling requires an explicit cleanup pattern:

```typescript
const outFd = fs.openSync(logFile, 'a');
const errFd = fs.openSync(logFile, 'a');

const child = spawn(process.execPath, [cliPath, 'serve', '--port', String(port)], {
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

---

## 4. Embedded View & Zero-Effort Theme Contract

When embedding `<PlannedWorkView />` in a host application (e.g., inside a modal or drawer):

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
