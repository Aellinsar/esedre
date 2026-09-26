# Changelog

All notable changes to Esedre are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.12] - 2026-09-26

### Fixed
- **UTF-8 En-Dash Mojibake Normalization**: Added `normalizeDashesAndMojibake` and `normalizeTicketFields` to transparently sanitize Windows-1252 mojibake (`â€“`), double-encoded UTF-8, and non-ASCII Unicode dashes (`\u2013`, `\u2014`, `\u2015`, `\u2012`, `\u2212`) into clean standard ASCII hyphens (`-`) across CLI tables, JSON projections, storage reads, and ticket mutations.

## [0.1.11] - 2026-09-26

### Fixed
- **Prevent Project Query Leak in Embedded Mode**: Guarded `window.history.replaceState` behind `!isEmbedded` in `PlannedWorkView` when switching project filters, added an explicit `isEmbedded` prop to `PlannedWorkViewProps`, and introduced `detectIsEmbedded` and `updateProjectUrlSearchParam` helpers to ensure embedded planners never mutate the host window's URL search parameters.
- **Published Version Collision Guard**: Added upfront registry version pre-check to `scripts/publish.js` to immediately detect and reject attempts to republish already-published versions before running the full build/test lifecycle.

## [0.1.10] - 2026-09-26

### Added
- **Single-Step Ticket Creation (`--detail` & `--file`)**: `ese create` accepts `--detail "<md>"` and `--file <path>` to populate `detail.md` specifications during ticket creation without requiring a secondary `ese plan` call.
- **MCP `esedre_create_ticket` Specification Markdown**: Added optional `detail` parameter to the MCP create tool for agents to mint tickets with full specifications in a single turn.
- **`ese refresh` CLI Alias**: Added `refresh` as a direct alias for `ese snapshot` to regenerate the `.esedre/snapshot.json` projection.

### Fixed
- **Windows CMD Batch Label Syntax Error**: Refactored `WRAPPER_CMD` (`ese.cmd` / `esedre.cmd`) to eliminate parenthesized `if (...)` blocks around `goto` statements, converted jump points to top-level labels, and prefixed all batch script invocations with `call` to prevent `'The system cannot find the batch label specified - done'` crashes on Windows.
- **PowerShell Console Stream UTF-8 Encoding**: Enforced `[Console]::OutputEncoding`, `[Console]::InputEncoding`, and `$OutputEncoding = UTF-8` in `ese.ps1` to prevent Unicode characters (en-dashes, quotes) from rendering as mojibake.
- **Structured JSON Output for `ese plan --json`**: Corrected `ese plan <id> --json` to emit a machine-readable JSON payload (`{ success, ticketId, project, planMarkdown, sha1 }`) instead of ANSI terminal text.

## [0.1.9] - 2026-09-25

### Added
- **Smart npm Publish Lifecycle Wrapper (`npm run pub`)**: Upfront authentication pre-check (`npm whoami`) with automatic interactive login before compilation, executing full prepublish test/lint/build lifecycle.
- **Multi-Layer Zero-Crawl Protection**: Edge and Vite middleware security preventing search spiders and AI crawler cataloging on development tunnels (`esedre.aroomwithamoose.com`).
- **Canonical Apex Ecosystem Links**: Standardized all portfolio ecosystem references to canonical apex `https://arwam.com`.

## [0.1.8] - 2026-09-11

### Added
- **Dynamic Configuration & Manifest Reloading**: 3-second TTL polling (`ensureFreshConfig`) reloading external hubs and manifests in real time without daemon restarts.

### Changed
- **Gateway Server Portfolio Decoupling**: Background daemon and gateway cluster (`ese start`) serve unconstrained portfolio views across all registered data hubs regardless of which workspace directory the server was launched from.
- **Slug Normalization**: Removed redundant `slug` field from `ProjectDescriptor`, manifests, and storage adapters in favor of canonical case-remembering `code`.

## [0.1.7] - 2026-09-11

### Added
- **Case-Remembering Project Resolution**: Preserves canonical casing for project codes up to 8 characters on disk and manifests while supporting case-insensitive lookups across CLI, MCP, and REST endpoints.
- **Workspaceless & Multi-Hub Project Init**: `ese init --project <Code> [--hub <name|path>]` creates projects directly in configured hubs without overwriting existing workspace configurations.

## [0.1.6] - 2026-09-10

### Added
- **Multi-Manifest Detection in `ese init`**: Auto-detects project codes and names from `Cargo.toml`, `pyproject.toml`, `settings.gradle.kts`, `app/build.gradle.kts`, and `go.mod`.
- **Global Port Settings**: Centralized port configuration in `~/.esedre/config.json` with CLI overrides and workspace inheritance.
- **Agent Project Allow-List Isolation**: Multi-tenant workspace scoping strictly limiting CLI and MCP access to declared `allowedProjects`.

## [0.1.5] - 2026-09-09

### Added
- **Interactive Web UI Assets & Previews**: Standalone React 19 web dashboard assets, dark and light preview cards, and documentation guides.

## [0.1.4] - 2026-09-08

### Added
- **MPL-2.0 License Transition**: Open source licensing under Mozilla Public License 2.0.
- **LLM Agent Long-Term Grounding Mission**: Formalized ground-truth architecture providing persistent context across compaction events.

## [0.1.1] - 2026-09-08

### Added
- **Project Onboarding & Configuration Tools**: Initial interactive setup via `ese configure` and `ese init`.

## [0.1.0] - 2026-09-08

### Added
- Initial release of the Esedre ticketing engine, CLI (`ese` / `esedre`), background daemon, and Model Context Protocol (MCP) server.
