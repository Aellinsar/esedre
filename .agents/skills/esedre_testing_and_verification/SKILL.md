---
name: esedre_testing_and_verification
description: Engineering standards, headless unit testing workflows, root cause analysis invariants, and strict UI testing guidelines for the Esedre codebase.
---

# Esedre Testing & Verification Standards

This skill establishes the mandatory verification standards, testing practices, and root cause analysis invariants for developing within the Esedre repository.

---

## 1. Mandatory Build & Test Verification

You are strictly and absolutely required to execute test and build checks whenever modifying code:

```bash
# Run complete test suite (34+ test files including cross-platform contracts and E2E integration)
npm test

# Run multi-distro Linux Docker verification matrix (Debian slim Node 22, Alpine Node 22, Debian Node 20 LTS)
npm run test:docker

# Run full production build verification (lint + UI build + CLI bundling)
npm run build

# Package release and publishing (runs npm whoami check, lint, test, build, and publish)
npm run pub
# Dry run verification:
npm run pub -- --dry-run
```

- Confirm zero TypeScript compilation errors (`tsc --noEmit`).
- Confirm zero test assertion failures.
- Confirm clean bundling to `dist/esedre.mjs`, `dist/web/embed.js`, and `dist/web/`.
- For releases, developers run `npm run pub` (via `scripts/publish.js`), which performs a fast 100ms `npm whoami` check and triggers interactive login if unauthenticated before executing the `prepublishOnly` lifecycle suite and publishing.
- **Strict Agent Invariant (Dry Run Only & Version Collision Check)**: Autonomous LLM coding agents are strictly forbidden from executing live package publication (`npm run pub` or `npm publish`). Agents may ONLY run dry run verification (`npm run pub -- --dry-run`). Live publishing is reserved exclusively for the human developer. Before suggesting a publish command to the user or running release verification, agents MUST check published registry versions (`npm view <package> versions --json`) to verify that the version in `package.json` has been properly bumped to prevent collision (`E403`).

---

## 2. Unit Testing & Assertion Integrity

1. **Zero Silent Test Weakening**:
   - Never weaken, delete, comment out, or relax unit test assertions.
   - If a test fails after an architectural change, diagnose the root cause and fix the implementation in the source code rather than modifying the test expectations to force a pass.

2. **Mandatory Unit Tests for Black-Boxable Logic**:
   - Write Vitest unit tests for all properly black-boxable domain logic, including:
     - Storage adapters (`FilesystemStorageAdapter`) and multi-topology resolution.
     - Configuration crawlers and upward hierarchy discovery (`findEsedreConfig`).
     - Agent Project Allow-List isolation boundaries (`SecurityFilter`).
     - Optimistic concurrency control and sha1 hashing.
     - CLI argument parsing and normalization.
     - REST API and MCP protocol endpoints.

3. **Headless Verification First**:
   - Prioritize headless testing scripts and Vitest test suites in `tests/` over manual or interactive debugging.
   - Test suites should remain hermetic and isolated (e.g. using isolated temporary directories and overriding `ESEDRE_GLOBAL_DIR` during test runs).

---

## 3. Mandatory Root Cause Analysis Invariant

1. **Architectural Diagnosis**:
   - Perform deep architectural root-cause diagnosis before modifying any code.
   - Diagnose why a bug or discrepancy occurs at its storage, parser, or configuration source.

2. **Strict Ban on Superficial Band-Aids**:
   - Never apply superficial band-aids, trial-and-error string tweaks, or downstream regex patches.
   - Fix the underlying state, data representation, or routing logic directly.

3. **Pave the Desire Paths**:
   - When LLM agents or developers naturally gravitate toward a specific workflow or shorthand pattern, officially support and structure it rather than fighting it.

---

## 4. Strict Ban on Autonomous Browser / UI Testing

- **STRICTLY GET OUT OF THE UI UNLESS DIRECTED**: NEVER launch browser subagents, Chrome DevTools MCP sessions, or open/navigate browser URLs for UI testing/verification unless the user explicitly and directly commands you to do so in that specific turn.
- The developer will conduct UI verification manually unless they instruct otherwise.
- Do NOT perform autonomous visual checks, browser recordings, or UI inspection on your own initiative.

---

## 5. Multi-Tier Cross-Platform & Docker Testing Architecture

Esedre enforces cross-platform compatibility across Windows, Linux, macOS, WSL2, and Docker via a 4-tier testing architecture:

1. **Tier 1: Cross-Platform Contract Suite (`tests/crossPlatformContracts.test.ts`)**:
   - Verifies OS-agnostic `.agents/mcp.json` generation, POSIX wrapper LF line endings (`\n`), `.gitattributes` rules, git index executable modes (`100755`), hermetic `ESEDRE_GLOBAL_DIR` routing (zero `os.homedir()` leaks), platform-aware path containment (`isPathInside`), CRLF vs LF parser/snapshot equivalence, and Node engine floor contracts.

2. **Tier 2: Black-Box Subprocess, MCP Pipe & Daemon E2E Suite (`tests/integration/crossPlatformE2E.test.ts`)**:
   - Spawns `dist/esedre.mjs` and platform-native wrappers (`.esedre/ese.mjs`, `.esedre/ese.cmd`, `.esedre/ese.ps1`, `./.esedre/ese`) across a full end-to-end workspace lifecycle.
   - Exercises stdio MCP JSON-RPC initialization via the tracked `.agents/mcp.json` configuration, tests fragmented/delayed `stdin` pipe reads in `agy-pre-tool-hook.mjs`, verifies `SIGTERM` graceful daemon shutdown, and tests unrecorded daemon stop recovery without requiring `lsof`.

3. **Tier 3: Local Docker Multi-Image Linux Verification (`npm run test:docker`)**:
   - Defined in `tools/docker/Dockerfile.test` and `scripts/test-docker.js` (with `.dockerignore` excluding host `node_modules` and `dist`).
   - Copies the worktree into native container `ext4`/`overlayfs` storage (`/tmp/esedre-linux-worktree`) under non-root user `node` with `/home/node/.esedre` locked down (`mode 0000`) to catch any `os.homedir()` leaks.
   - Runs across 6 Linux distribution images: `node:22-slim` (Debian Bookworm `glibc` + `dash` without `lsof`), `node:22-alpine` (Alpine `musl` + BusyBox `ash`), `node:20-slim` (Node 20 LTS), `ubuntu:24.04` (Ubuntu Noble LTS with UID 1000 `ubuntu` user), `fedora:41` (Red Hat / RPM family `dnf` + OpenSSL 3 crypto policy), and `archlinux:latest` (Arch Linux rolling `pacman`). Supports `--quick`/`--slim`, `--alpine`, `--ubuntu`, `--fedora`, `--arch`, or `--image <tag>`.

4. **Tier 4: GitHub Actions Multi-OS Matrix (`.github/workflows/ci.yml`)**:
   - Runs automated `npm ci`, `npm run build`, and `npm test` across `ubuntu-latest`, `windows-latest`, and `macos-latest` on Node 20 and Node 22.
