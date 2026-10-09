# Esedre Grounding Platform & `ese crew` Opportunity Ledger

## Purpose & Developer Dogfooding Context

This ledger tracks real-world development friction points, parallelization bottlenecks, and safety risks encountered during active pair-programming sessions across the Lab 151 ecosystem (Lab 151 Portal, Sleep Lab, Conquest Lab, and TCG Companion).

Every entry represents a concrete, observed development task where an upcoming **Esedre Grounding Platform** or **`ese crew`** capability would have delivered measurable time savings, race-condition protection, or workflow isolation. This ledger serves as direct empirical field data for Esedre engine and CLI development.

### Core Architectural Thesis: The Lead Terminal Invariant

> **The primary goal of `ese crew` workers is to allow the Lead Session to defer tasks to the background, preserving a zero-latency, highly interactive main terminal for agentic development.**

In modern AI pair programming, the main terminal is the strategic cockpit: the space where the developer and AI discuss high-level trade-offs, architecture, design systems, and roadmaps. When the lead session is forced to synchronously execute routine edits, 45-second test suites, multi-repository builds, or multi-branch releases, the primary terminal locks into a blocking wait state and conversational velocity collapses.

With `ese crew`, the lead session acts as an orchestrator: delegating tactical execution to background workers over MCP while immediately returning to the developer to continue uninterrupted interactive collaboration.

### Security & Trust Architecture: The Zero-Trust Mesh Model

The single largest barrier to developer adoption of autonomous agents is fear: *"There is no way I am giving autonomous AI agents unrestricted shell control over my personal computers."*

Esedre dissolves this existential security concern through a three-tier Zero-Trust Mesh:

1. **Hardware-Backed Lead Authority (FIDO2 / YubiKey 2FA)**:
   - Claiming the Lead orchestrator position in an active mesh requires physical 2FA hardware key authorization.
   - A rogue background agent, compromised worker, or remote network probe cannot usurp the lead position or issue autonomous orders across the mesh without physical human presence.

2. **Disposable Worker Sandboxing (Zero Host Exposure)**:
   - Compute workers execute tasks exclusively inside ephemeral Docker containers (`--sandbox=docker` / `docker run --rm`).
   - Containers mount only `/workspace` (or the specific ticket worktree).
   - Workers have strictly ZERO access to the host `$HOME`, `~/.ssh`, `~/.aws`, environment secrets, or host OS files.
   - Any errant shell command, prompt injection, or broken build script is completely contained and vaporized when the container exits.

3. **Explicit System Registration & Capability Scoping**:
   - Secondary compute nodes (e.g. desktop workstation `Eris`) join the mesh as registered execution targets with pre-declared, scoped capabilities (e.g. test runner, compiler, linter).
   - Workers only accept cryptographically signed dispatch envelopes originating from the authenticated Lead Session.

---

## Capabilities Taxonomy

| Capability Code | Feature / Command | Target Benefit |
|---|---|---|
| **HOT-WORKER** | Zero-Latency Hot Standby Workers (`minWorkers: 1`) | Pre-warmed background containers on compute nodes (e.g. `Eris`) executing batch tasks instantly with zero container cold-start delay. |
| **MCP-MESH** | Native MCP Mesh over Esedre Gateway (port 5674) | Agent-to-worker JSON-RPC communication streaming progress updates, test results, and plan revisions. |
| **WORKTREE-ISO** | Isolated Git Worktrees (`ticket/<id>-<slug>`) | Execution on dedicated child branches and worktrees, eliminating `.git/index.lock` collisions and active editor tab churn. |
| **DOCKER-SAND** | Disposable Docker Sandboxing (`--sandbox=docker`) | Ephemeral containers mounting only `/workspace` (`docker run --rm`), preventing host pollution and script collisions. |
| **PATH-LEASE** | Subsystem Path & Ticket Leases | Exclusive mutual exclusion locks preventing multiple agents from clobbering shared schemas, files, or common modules concurrently. |
| **PARALLEL-FAN** | Parallel Task Fan-Out (`ese crew run --parallel`) | Concurrently dispatching independent builds, test suites, or linters across multiple workers. |
| **ASYNC-DISPATCH** | Fire-and-Notify Fast Polish (`ese crew dispatch <task>`) | Dispatching self-contained 30-60s tasks (component swaps, dead button removal, radius tweaks) to standby workers, unblocking the main conversation immediately with zero conversational stall. |
| **PLAN-GROUND** | Cognitive Plan Grounding (`ese plan sync`) | Anchoring active execution state against LLM context truncation and compaction drift. |

---

## Running Opportunity Log

### Entry 001: Cross-Ecosystem Parallel Test & Build Verification
- **Date**: 2026-10-05
- **Session / Task**: Universal default username (`"User"`) rollout across all 4 ecosystem repositories.
- **Affected Projects**: `lab151`, `lab151-conquest`, `lab151-sleep`, `lab151-tcg`
- **Capability**: `PARALLEL-FAN` + `HOT-WORKER` (`ese crew run --parallel`)
- **Observed Friction**:
  - Updating `DEFAULT_GLOBAL_IDENTITY.username = 'User'` required verifying typechecks and test suites across all 4 projects.
  - Executed sequentially in the main thread:
    - `lab151`: `npm test` (36 tests) + `npm run build` (~8s)
    - `lab151-conquest`: `npm test` (38 tests) + `tsc` (~9s)
    - `lab151-sleep`: `npm test` (118 test files, 919 tests!) taking 36.87s + `tsc` (~45s)
    - `lab151-tcg`: `npm test` (6 test suites) + `lint` (~10s)
  - Total cumulative verification time: ~75 seconds of blocking wait time in the primary conversation thread.
- **Projected Grounding Benefit**:
  - Firing `ese crew run --parallel "npm test"` fans out all 4 test suites concurrently to pre-warmed background workers.
  - Wall-clock time collapses to the single longest test suite (~37s for Sleep Lab), saving ~38 seconds (>50% latency reduction) per cross-repo change.

---

### Entry 002: Isolated Git Release Sequence Without Active Editor Workspace Churn
- **Date**: 2026-10-04
- **Session / Task**: Production release rollout taking Conquest Lab and Lab 151 to `main`.
- **Affected Projects**: `lab151-conquest`, `lab151`
- **Capability**: `WORKTREE-ISO` (`ese crew release --worktree`)
- **Observed Friction**:
  - Releasing to production required staging changes on `release/upcoming`, committing, switching branch to `main`, merging `release/upcoming`, pushing `origin/main`, and switching branch back to `release/upcoming`.
  - Executing `git checkout main` and `git checkout release/upcoming` directly in the active workspace caused open IDE editor tabs to reload, triggered TypeScript language server rescans, caused Vite HMR restarts, and created risk of `.git/index.lock` collisions.
- **Projected Grounding Benefit**:
  - A worker executing on an isolated git worktree (`/worktrees/conquest-prod`) performs the merge, verification, and push completely out-of-band.
  - The developer's primary editor workspace and active dev servers remain 100% undisturbed with zero tab flickers or lock contentions.

---

### Entry 003: Subsystem Path Leases on Canonical Common Suite
- **Date**: 2026-10-04
- **Session / Task**: Shared module authoring (`UserBadge.tsx`, `EcosystemSwitcher.tsx`) and ecosystem sync via `scripts/sync_common.js`.
- **Affected Projects**: `lab151`, `lab151-conquest`, `lab151-sleep`, `lab151-tcg`
- **Capability**: `PATH-LEASE` (`ese crew lease src/common`)
- **Observed Friction**:
  - `lab151/src/common/` is the canonical authoring source of truth, while subprojects maintain strictly read-only mirrored files.
  - In a multi-machine setup (e.g. desktop + laptop Antigravity instances coordinating via MCP), two agents could inadvertently edit or sync mirrored files concurrently, producing race conditions or diverged mirrors.
- **Projected Grounding Benefit**:
  - Before modifying common components, the agent acquires an exclusive lease (`esedre_claim_lease(path: "src/common", ttl: 15)`).
  - All other instances across the network respect the lease boundary until `sync_common.js --check` passes and the lease is released.

---

### Entry 004: Heavy ROM Extraction & Scale4x Super-Resolution in Sandboxed Worker
- **Date**: 2026-10-04
- **Session / Task**: Datamining 2,201 Nintendo DS sprites, castle maps, and running Scale4x vector super-resolution in `lab151-conquest`.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `DOCKER-SAND` + `HOT-WORKER` (`ese crew run --sandbox=docker python tools/upscale_used_assets.py`)
- **Observed Friction**:
  - Running multi-threaded extraction (`extract_rom_assets.py` with 16 workers) and Scale4x contour super-resolution consumes massive host CPU and memory on the developer's workstation.
  - Python scripts directly touch host disk and require local Python dependencies (Pillow, NumPy).
- **Projected Grounding Benefit**:
  - Delegating binary mining jobs to an ephemeral Docker container on compute node `Eris` keeps the local workstation responsive and guarantees clean, reproducible sandbox execution.

---

### Entry 005: Cognitive Plan Grounding Across Multi-Turn Compaction
- **Date**: 2026-10-04
- **Session / Task**: Multi-hour architectural sprint spanning navigation redesign, mobile header refactoring, release notes, and deployment.
- **Affected Projects**: All
- **Capability**: `PLAN-GROUND` (`ese plan sync`)
- **Observed Friction**:
  - As conversation history grew, the session hit the token compaction threshold and underwent memory summarization.
  - Ephemeral chat context (such as pending ticket assignments and multi-turn user layout preferences) had to be reconstructed from compaction summaries.
- **Projected Grounding Benefit**:
  - Actively syncing structured task plans into `.esedre/snapshot.json` and ticket `detail.md` gives resumed conversations and subagents instant, loss-free ground truth directly from the filesystem.

---

### Entry 006: Headless Layout & Visual Collision Auditing
- **Date**: 2026-10-05
- **Session / Task**: Diagnosing and fixing the portal header overlap (Conquest card clipping into the User badge on desktop).
- **Affected Projects**: `lab151`
- **Capability**: `HOT-WORKER` (`ese crew test --visual-bounds`)
- **Observed Friction**:
  - Under strict headless verification rules (no interactive browser sessions), CSS layout overlaps like `md:fixed` clipping cards can only be spotted visually by the user or through manual CSS inspection.
- **Projected Grounding Benefit**:
  - A hot standby worker running headless Puppeteer / Playwright checks DOM bounding rects across standard responsive viewports (600x800, 1024x768, 1440x900) in <2 seconds.
  - It automatically flags bounding box collisions (`expect(headerRect.bottom).toBeLessThanOrEqual(mainRect.top)`) before the user ever sees the bug on screen.

---

### Entry 007: Fire-and-Notify Fast Polish for Component Swaps & Dead Controls
- **Date**: 2026-10-04 / 2026-10-05
- **Session / Task**:
  1. Integrating common `UserBadge` into TCG Lab header.
  2. Removing the erroneous "Warriors" button from the Pokemon page on Conquest Lab.
- **Affected Projects**: `lab151-tcg`, `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Replace header user avatar with shared UserBadge"`)
- **Observed Friction**:
  - The developer spotted these minor UI defects while actively engaged in higher-level architectural discussions (planning release readiness, navigation structure, story progress).
  - Addressing each small fix sequentially stalled the main conversation: the lead agent spent multiple tool turns reading files, making string edits, running tests, and awaiting output before returning control.
  - The user had to context-switch away from their strategic line of thought to wait for minor tactical code edits.
- **Projected Grounding Benefit**:
  - The lead agent instantly dispatches the fix to an idle standby worker via MCP: `ese crew dispatch "Remove dead Warriors button from Pokemon detail modal"`.
  - The lead agent immediately responds in chat: *"Dispatched to worker. Continuing on our navigation strategy..."* with zero conversational pause.
  - The worker performs the edit, runs `npm test` in its isolated worktree, and notifies via MCP: *"Worker completed: Warriors button removed, 38/38 tests passing, branch ready to merge."*

---

### Entry 008: Mechanical UI Token & Radius Refactoring ("De-iPhoned")
- **Date**: 2026-10-05
- **Session / Task**: Reducing corner rounding from `rounded-2xl sm:rounded-3xl` down to `rounded-xl sm:rounded-2xl` across showcase cards, feature badges, and buttons.
- **Affected Projects**: `lab151`
- **Capability**: `ASYNC-DISPATCH` (`ese crew dispatch "Refactor showcase cards corner radius to rounded-xl"`)
- **Observed Friction**:
  - A straightforward token replacement across 4 files (`SleepShowcaseCard`, `ConquestShowcaseCard`, `TcgShowcaseCard`, `UpcomingWingsCard`) consumed a dedicated conversational turn with multiple tool calls and build runs.
- **Projected Grounding Benefit**:
  - Routine styling tweaks and design-token adjustments are delegated directly to standby workers as non-blocking background jobs, returning *"Hey, that thing is ready"* while the user and lead agent focus on substantive logic.

---

### Entry 009: Non-Destructive CSS Asset Viewport Clipping ("1px ROM Border Removal")
- **Date**: 2026-10-05
- **Session / Task**: Inspecting 17 kingdom scenic paintings, identifying the 1px top/bottom border in native ROM extractions, and clipping via `aspect-[256/118]` and `scale-y-[1.025]` across presentation components while preserving raw disk assets.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Clip 1px scenic border with CSS across cards and dossiers"`)
- **Observed Friction**:
  - The developer visually spotted a 1px border artifact along the top and bottom edges of the warlord card background art.
  - Investigating the artifact required pixel analysis via Python, locating all 4 components displaying scenic art (`WarriorBattleStage`, `KingdomDetailView`, `RanseiKingdomsPreview`, `BestLinkTeaser`), refactoring the aspect ratio and scale tokens, and codifying the intent in `AGENTS.md` and `SKILL.md`.
  - The sequential investigation and multi-file refactor occupied the lead session for multiple turns.
- **Projected Grounding Benefit**:
  - The lead session immediately issues an order: `ese crew dispatch "Investigate 1px border on kingdom scenic assets, clip via CSS without altering disk files, and document in AGENTS.md"`.
  - The hot worker executes the Python pixel audit, applies the CSS adjustments, updates the skill and workspace rules, runs `npm test` + `npm run build`, and signals completion to the lead.

---

### Entry 010: Ecosystem Common Component Synchronization Under Path Lease
- **Date**: 2026-10-05
- **Session / Task**: Canonical common component update in `lab151/src/common/chat/AssistantChatMessage.tsx` (gating `Copy MD` behind developer mode, removing stray `Retry` action) and propagating via `sync_common.js` across the 4-repository ecosystem.
- **Affected Projects**: `lab151`, `lab151-conquest`, `lab151-sleep`, `lab151-tcg`
- **Capability**: `PATH-LEASE` + `HOT-WORKER` (`ese crew lease src/common` + `ese crew run "npm run sync:common"`)
- **Observed Friction**:
  - `lab151/src/common/` is the single authoring source of truth for shared modules, mirrored strictly read-only in subprojects.
  - Making a change to `AssistantChatMessage` required:
    1. Authoring the change in canonical `lab151/src/common/chat/AssistantChatMessage.tsx`.
    2. Syncing it outward across repositories via `npm run sync:common`.
    3. Wiring consumer props (`isDeveloper={globalSettings.isDeveloperModeEnabled}`) in `lab151-conquest/src/components/Conquest/StrategyAdvisorView.tsx`.
    4. Running `npm test`, `npm run lint`, and `npm run build` across both `lab151` and `lab151-conquest`.
  - In a multi-agent or collaborative environment, concurrent edits to shared modules or divergent sync runs risk clobbering files, creating dirty git trees, or breaking consumer contracts mid-turn.
- **Projected Grounding Benefit**:
  - The lead session acquires an exclusive path lease: `ese crew lease src/common --ttl=10m`.
  - While held, no other concurrent process, agent, or background worker can touch canonical or mirrored common files.
  - The worker executes the canonical edit, triggers `sync:common`, runs cross-repo typechecks, releases the lease, and returns a verified result to the lead.

---

### Entry 011: Multi-Locale Synchronous String Refactoring ("The Northern Citadels")
- **Date**: 2026-10-05
- **Session / Task**: Renaming region category from "Northern Citadels & Dragon Fortress" to "The Northern Citadels" across data models and 3 localization dictionaries (`en-US.ts`, `es-ES.ts`, `ja-JP.ts`).
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Update region name to The Northern Citadels in warlords.ts and all 3 locales"`)
- **Observed Friction**:
  - A clean label refinement requested by the user required searching and updating 4 separate files (`warlords.ts`, `en-US.ts`, `es-ES.ts`, `ja-JP.ts`), running test suites (`tools/testRomDataIntegrity.ts`, `tools/testTranslationCoverage.ts`), and executing a full production build (`npm run build`, 22s) to check for bundler/type regressions.
  - The sequential edits and test execution stalled the main terminal on a purely semantic label change.
- **Projected Grounding Benefit**:
  - The lead dispatches: `ese crew dispatch "Rename region to The Northern Citadels across warlords.ts and all locales"`.
  - The hot standby worker executes the string replacements, runs `npm test` verifying 100% key parity across all 3 locales, and reports completion without interrupting the user's ongoing design review.

---

### Entry 012: In-Page Card Header Condensation & Redundancy Pruning
- **Date**: 2026-10-05
- **Session / Task**: Vertical condensation in `RanseiKingdomsPreview.tsx` and `BestLinkTeaser.tsx` (collapsing redundant standalone section header bars into integrated card headers, dropping duplicate subtitle lore, and tightening outer container padding/radius).
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` (`ese crew dispatch "Condense Ransei Kingdoms card header and drop redundant subtitle"`)
- **Observed Friction**:
  - Iterating on card header whitespace and text deduplication took multiple back-and-forth prompt turns: removing the outer header, adding the title inside the card, noticing the duplicate subtitle lore, and dropping the subtitle.
  - Each iteration blocked the lead conversation while running full builds (`npm run build`, 22s each).
- **Projected Grounding Benefit**:
  - Fast visual refactors are handed off to standby workers to test and compile out-of-band, preserving a fast interactive iteration loop in the lead terminal.

---

### Entry 013: Cognitive Plan Grounding Across Resumed Sessions (Ticket Conquest-18)
- **Date**: 2026-10-06
- **Session / Task**: Formulating the exhaustive 5-phase implementation plan for the Pokemon directory and family lineage architecture (Ticket `Conquest-18`).
- **Affected Projects**: `lab151-conquest`
- **Capability**: `PLAN-GROUND` (`ese plan Conquest-18 --ground`)
- **Observed Friction**:
  - Complex architectural decisions (e.g. `PartnerCard` naming to avoid TCG conflicts, 78-family lineage grouping, top clickable evolution progression bar, forward-looking items stubbing) were discussed across conversation compactions.
  - Relying on conversational context summaries risked compaction drift or losing nuanced technical constraints across multi-day sprints.
- **Projected Grounding Benefit**:
  - Formally anchoring the plan to the filesystem via `.esedre/plans/Conquest-18.md` and `.esedre/snapshot.json` guarantees that future sessions, subagents, and workers share an exact, loss-free single source of truth regardless of chat compaction.

---

### Entry 014: Multi-Locale Semantic Phrase Pruning ("100% Best Links" -> "Best Links")
- **Date**: 2026-10-06
- **Session / Task**: Eliminating redundant "100% Best Links" phrasing across field manual headers, advisor prompts, tactical descriptions, and the ticket plan.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Prune redundant 100% Best Links across all 3 locales and plan"`)
- **Observed Friction**:
  - Cleaning up the repetitive phrasing required cross-referencing and modifying 4 files (`en-US.ts`, `es-ES.ts`, `ja-JP.ts`, `Conquest-18.md`), followed by running full test suites (`npm test`) and TypeScript checks (`npm run lint`).
  - The sequential edits and test execution stalled the main terminal on a straightforward copy polish request.
- **Projected Grounding Benefit**:
  - The lead dispatches: `ese crew dispatch "Clean 100% Best Links phrasing across all locales and verify test suite"`.
  - A pre-warmed background worker executes the string replacements, runs `npm test` verifying 100% key parity across all 3 locales, and reports back while the developer and lead agent continue active discussion without conversational pause.

---

### Entry 015: Dual-Ticket Pre-Execution Grounding (Conquest-15 & Conquest-16)
- **Date**: 2026-10-06
- **Session / Task**: Formulating interconnected technical implementation plans for the 38 Evolving Warlords (`Conquest-15`) and the 200-Warrior Directory (`Conquest-16`) prior to starting Pokemon development.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `PLAN-GROUND` (`ese plan Conquest-15 --ground` & `ese plan Conquest-16 --ground`)
- **Observed Friction**:
  - Complex architectural decisions (e.g. unified Warlord cards section, segmented subsection switcher for standard warriors, super-minimal crown glyph and border tint for Kingdom Leaders) were decided during high-level planning.
  - Deferring plan documentation until coding begins risks misaligning component interfaces, duplicate state models, or violating visual guidelines (e.g. accidental buzzword pills).
- **Projected Grounding Benefit**:
  - Grounding both tickets directly into the engine (`.esedre/plans/Conquest-15.md`, `.esedre/plans/Conquest-16.md`) with explicit phased checklists establishes an authoritative contract before any code is written, enabling zero-drift execution.

---

### Entry 016: Binary ROM Extraction & Test Suite Expansion (Conquest-15 & Conquest-16)
- **Date**: 2026-10-06
- **Session / Task**: Executing binary ROM extraction across `BaseBushou.dat` and `BaseBushouMaxSyncTable.dat`, compiling the 200-warrior directory JSON, expanding the 37 evolving warlords, and verifying 38 unit tests and the 42s Vite production build.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `PARALLEL-FAN` + `HOT-WORKER` (`ese crew run --parallel`)
- **Observed Friction**:
  - Running offline ROM data mining scripts, generating TypeScript constants, updating unit test assertions, and waiting for the 42-second Vite production build were performed sequentially in the lead thread, incurring blocking wait states.
- **Projected Grounding Benefit**:
  - The Lead dispatches `ese crew dispatch "Compile warriors directory, run unit tests, and verify production build"`.
  - A pre-warmed background worker runs the asset validation, TypeScript compilation, and bundler out-of-band, returning pass/fail metrics via MCP while the Lead and developer continue interactive roadmap reviews.

---

### Entry 017: Rapid UI Micro-Refactoring & Out-of-Band Build Verification
- **Date**: 2026-10-06
- **Session / Task**: Sequential UI micro-refactors: relocating the Realm Leader crown from the stage pin to the card body description row with a touchable React Portal tooltip, followed by assembling the hybrid control toolbar (Live Search + Jump Dropdown + Table targeting).
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch <task>`)
- **Observed Friction**:
  - Each micro-refactor required multi-file replacements across UI components and 4 locale dictionaries (`types.ts`, `en-US.ts`, `es-ES.ts`, `ja-JP.ts`).
  - After each edit pass, the lead session ran `tsc --noEmit`, `npm test`, and a 19-30 second full Vite production build (`tsc -b && vite build`) to enforce our Zero Build Warnings policy.
  - This created repeated 45-60 second blocking stalls in the main chat terminal where the developer had to wait before giving the next design instruction (e.g. transitioning from the crown tooltip to the hybrid toolbar).
- **Projected Grounding Benefit**:
  - The developer provides the visual direction ("take crown out of map pill, put right aligned in card top row with touchable portal tooltip").
  - The Lead delegates the concrete implementation, locale updates, and headless build verification to an idle standby worker on compute backbone Eris via MCP:
    `ese crew dispatch "Relocate Realm Leader crown to card description row with touchable Portal Tooltip, update locales, and verify build"`
  - The Lead immediately returns to the developer with zero terminal latency to brainstorm the upcoming toolbar options ("While the worker verifies that, do we prefer filtering or jumping for the warlords toolbar?").
  - Result: 100% conversational concurrency; zero wait time for bundlers.

---

### Entry 018: Mass Super-Resolution Batch Processing & Asset Geometry Audit
- **Date**: 2026-10-06
- **Session / Task**: Upscaling 276 remaining waist-up warrior portraits (`wu_*.png`) with 4x Scale4x mathematical super-resolution, verifying 100% asset parity across all categories, creating persistent geometry audit tooling (`tools/inspect_asset_geometry.py`), and upgrading standard warrior cards to full scenic stages.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `PARALLEL-FAN` + `HOT-WORKER` + `DOCKER-SAND` (`ese crew dispatch "Execute mass Scale4x super-resolution batch and verify asset parity"`)
- **Observed Friction**:
  - Processing 276 high-resolution image transforms required significant multithreaded CPU load (16 concurrent PIL/numpy workers), file system writes, and running verification checks.
  - The Lead session was locked in execution mode running asset batch scripts, creating inspection CLI tools, updating card components, and executing the 18-second production bundler (`npm run build`).
  - The developer had to wait across sequential turns for heavy compute tasks (Scale4x batch processing, image bounding audits, and full Vite builds) before progressing to the next card layout discussion.
- **Projected Grounding Benefit**:
  - The Lead orchestrator issues a single command over MCP:
    `ese crew dispatch --node=Eris "Batch upscale 276 waist-up portraits to 4x, verify de-rez accuracy, and run asset geometry audit"`
  - Dedicated compute workstation `Eris` claims the task on a pre-warmed worker inside an ephemeral Docker container (`--sandbox=docker`), crunching the mathematical Scale4x super-resolution and saving assets directly to the shared build cache with zero host CPU load on the developer's laptop.
  - Progress updates, asset counts, and parity reports stream back via MCP over port 5674.
  - The main terminal remains completely free for the developer and AI to continue refining card typography, stage aesthetics, and UI interaction models without a single second of compute downtime.

---

### Entry 019: Fast-Paced Interactive UX Triage, Canon Fact-Finding & Compaction Boundary
- **Date**: 2026-10-06
- **Session / Task**: Rapid interactive overhaul of the Warriors and Warlords directory navigation (pruning redundant "Jump" controls and count pills, implementing an All | Warlords | Warriors segmented toggle, web research on canon warrior numbering conventions, switching table partners to compact sprites with portal tooltips, and decoupling Cards stage art from Roster face framing).
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `PLAN-GROUND` (`ese crew dispatch <task>` + `ese plan sync`)
- **Observed Friction**:
  - The developer and agent engaged in a high-velocity feedback loop diagnosing navigation clutter ("clusterfuck of toggles and tabs").
  - The workflow oscillated rapidly between strategic UI triage, canon fact-finding (searching whether warrior numbers were visible in Nintendo DS cartridges or fansites), CSS aspect-ratio calculations, and running full production builds.
  - While this design review was actively underway, the conversation crossed the LLM token compaction boundary. The active design rationale (such as why warrior numbers were dropped and how standard warrior cards map to kingdom scenic stages) had to be retained through compaction summaries.
  - In addition, running full 18-second production builds after each minor UI tweak (removing a dropdown, removing a column, tweaking sprite tooltips) forced artificial conversational pauses.
- **Projected Grounding Benefit**:
  - The Lead dispatches rapid mechanical code edits and bundler verification out-of-band:
    `ese crew dispatch "Remove warrior number column from table, wire sprite portal tooltips, and verify build"`
  - Concurrently, the Lead executes `ese plan sync` to anchor active design decisions (pruning rationale, canon findings, component architecture) into `.esedre/snapshot.json`, immunizing the session against token compaction drift.
  - The Lead immediately answers the developer's gameplay canon question without delay, maintaining unbroken conversational momentum.

---

### Entry 020: Dual-Grid Presentation Decoupling & Game Lore Fact-Finding Concurrency
- **Date**: 2026-10-06
- **Session / Task**: Splitting the mixed single-grid cards presentation into two distinct grids (Warlords vs. Standard Warriors) with a clean responsive visual divider (`WARRIORS ──────`), while simultaneously conducting gameplay canon research on Warrior home kingdoms and evolution mechanics.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Split card presentation into dual grids with divider and verify build"`)
- **Observed Friction**:
  - The developer posed three interconnected questions in a single prompt: two regarding game lore/mechanics (inquiring if standard warriors have home kingdoms or if their card art was arbitrary, and whether standard warriors can evolve) and one regarding visual layout (requesting a visual divider and two distinct grids instead of loading both datasets into one grid).
  - Answering the lore questions required web searches across Pokémon Conquest guides, while updating the layout required code edits to `BestLinkTeaser.tsx` and running full headless verification (`tsc`, `npm test`, and a 14-second production build).
  - Executing both sequentially in the Lead thread meant the Lead was blocked waiting for bundlers before it could return the answers about warrior evolution and home cities.
- **Projected Grounding Benefit**:
  - The Lead immediately dispatches the layout refactor and headless verification:
    `ese crew dispatch "Partition BestLinkTeaser into distinct Warlord and Warrior grids with visual divider and run build verification"`
  - While the hot worker on `Eris` compiles the TypeScript and executes the Vite production bundle out-of-band, the Lead session immediately performs the game mechanics investigation and replies with the lore answers.
  - Conversational latency drops to near-zero, completely eliminating wait time for the 14-second production bundler.

---

### Entry 021: Non-Blocking Secondary Collection Sorting & Verification
- **Date**: 2026-10-06
- **Session / Task**: Alphabetizing the 163 standard warriors in the secondary card grid while strictly preserving story encounter order for the 37 warlords in the primary grid.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` (`ese crew dispatch "Alphabetize standard warrior cards and verify production build"`)
- **Observed Friction**:
  - A small sorting refinement required running full TypeScript typechecking (`tsc --noEmit`), 38 unit tests, and the 14-second Vite production build.
  - The developer experienced a wait state before getting confirmation on a minor sort-order adjustment.
- **Projected Grounding Benefit**:
  - The Lead dispatches the sorting tweak: `ese crew dispatch "Sort standardEntries alphabetically in BestLinkTeaser and verify build"`.
  - The standby worker applies the sort, verifies the bundle, and reports back while the Lead immediately confirms the order to the developer.

---

### Entry 022: Cross-Component Stage Geometry Calibration & Visual Parity
- **Date**: 2026-10-06
- **Session / Task**: Re-calibrating Partner Pokemon horizontal offset and scale on `StandardWarriorCard` (`right-[43px] sm:right-[51px] md:right-[59px]` and 105px-132px portrait scale) to match `WarriorBattleStage` solo partner geometry.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` (`ese crew dispatch "Align partner Pokemon stage offset and scale to match Warlord cards"`)
- **Observed Friction**:
  - Fine visual alignment across sibling card components required inspecting CSS offset tokens, applying the responsive Tailwind classes, and running TypeScript checks, unit tests, and the 13-second production build.
  - Doing this synchronously stalled conversational flow for a purely visual positioning fix.
- **Projected Grounding Benefit**:
  - The Lead dispatches: `ese crew dispatch "Sync StandardWarriorCard partner offset with WarriorBattleStage solo partner and verify build"`.
  - The hot worker verifies the build and updates screenshot/bounds assertions out-of-band while the Lead remains immediately responsive.

---

### Entry 023: Universal Deep Hash Routing & Polymorphic Dossier Expansion
- **Date**: 2026-10-06
- **Session / Task**: Eliminating redundant dual-language name overlays across standard cards and roster tables, replacing "Inspect Sync" with "View Warrior Dossier", and extending the high-fidelity `WarriorDossierView` component and deep hash routing (`#/warriors/<slug>`) to all 163 standard warriors.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Extend WarriorDossierView to standard warriors and wire deep hash routing"`)
- **Observed Friction**:
  - Expanding the comprehensive 1,000-line `WarriorDossierView` architecture to polymorphically support both multi-rank Warlords and single-rank Standard Warriors required multi-file data modeling (adapting `warriorsDirectory` records, exporting `TYPE_KINGDOM_MAP`, updating router tests), removing legacy string combinations across 3 components, and running TypeScript checks, unit tests, and the 13-second production bundler.
  - Executing all verification sequentially in the Lead thread locked the terminal while testing and bundling.
- **Projected Grounding Benefit**:
  - The Lead dispatches: `ese crew dispatch "Wire polymorphic warrior dossier adapter, update card affordance to View Warrior Dossier, and run full test/build suite"`.
  - An idle background worker executes the component wiring, updates router unit tests, and verifies the production bundle out-of-band, returning verified metrics over MCP while the Lead and user continue interactive tactical reviews.

---

### Entry 024: Automated Ground Truth Cross-Validation & ROM Discrepancy Auditing
- **Date**: 2026-10-06
- **Session / Task**: Double-checking the accuracy of all 163 standard warrior image mappings, Japanese character names, and 100% Best Link partner Pokemon against external authoritative sources (Serebii, Bulbapedia, Veekun) and resolving ROM struct misalignment.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Scrape external ground-truth warrior tables, cross-validate against ROM sync matrix, and verify model bindings"`)
- **Observed Friction**:
  - Validating 163 standard warriors required fetching external HTML tables, parsing multi-column DOM structures, performing cross-table differential audits on 163 character records, identifying 5 legacy community guide misconceptions on Serebii (e.g. Masahide, Akizane, Takatane, Tsuru, Jubei), discovering that standard warriors share 27 generic models (`b0 = 100..129` mapped to `bust_*.png`) rather than waist-up art, correcting Japanese ROM string table indexing, and rebuilding `warriors_directory.json`.
  - Performing this intensive cross-validation, script execution, data regeneration, and full bundle build sequentially blocked the main conversation loop.
- **Projected Grounding Benefit**:
  - The Lead dispatches: `ese crew dispatch "Fetch external warrior datasets, audit ROM sync matrix and image mappings, and regenerate warriors_directory.json"`.
  - A hot standby worker spins up in a headless sandbox, parses the web tables, performs the binary diff against the cartridge dump, fixes the generator script, re-compiles the JSON dataset, runs `npm test` and `npm run build`, and returns a detailed verification report directly to the Lead over MCP.

---

### Entry 025: Zero-Flicker Skeleton State & Asynchronous Data Preloading
- **Date**: 2026-10-06
- **Session / Task**: Resolving empty-query flicker ("No Warlords match your search query") when navigating to the Warriors page by implementing eager store preloading, loaded lifecycle gating, and pulse skeleton grids.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Add isWarriorsDirectoryLoaded lifecycle, skeleton grid cards, and verify production build"`)
- **Observed Friction**:
  - Investigating the race condition between component mount and asynchronous JSON dataset fetching (`/data/warriors_directory.json`) required tracing MobX observable dependencies, identifying empty-array default evaluation as a zero-match query result, creating responsive CSS skeleton components matching card geometry, updating `ConquestStore` action boundaries with `runInAction`, and verifying isomorphic fetch safety across both Node.js unit tests (`MockWindow`) and browser runtimes.
  - Sequentially running `npm run lint`, 38 unit tests, and the 13.4s Vite production bundle blocked interactive conversation.
- **Projected Grounding Benefit**:
  - The Lead dispatches: `ese crew dispatch "Add isWarriorsDirectoryLoaded flag, render skeleton card placeholders during load, and run test/build verification"`.
  - A hot standby worker applies the lifecycle guard, builds the skeleton component, runs the test suite and bundler in the background, and streams the verification badge over MCP, keeping the user and Lead conversation completely fluid.

---

### Entry 026: Binary ROM Attack Range Datamining & Unified Hero Deck Overhaul
- **Date**: 2026-10-06
- **Session / Task**: Datamining 200 Pokemon canonical signature moves, attack range geometries, and primary abilities directly from NitroFS binary tables (`Pokemon.dat`, `Waza.dat`, `Tokusei.dat`, `WazaRange.dat`), generating `pokemonCombat.ts`, implementing the Unified 2-Zone Deck layout with full 3-language localization, and removing redundant 4x super-resolution debug badges.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Extract ROM moves & ranges into pokemonCombat.ts, implement Unified 2-Zone Deck, and verify build"`)
- **Observed Friction**:
  - Unpacking bitfields across 48-byte `Pokemon.dat` binary records (`((rec[22] & 0x07) << 6) | (rec[21] >> 2)`), correlating 143 moves in `Waza.dat` with `WazaRange.dat` byte offsets, mapping reach and AoE geometry labels, generating `src/constants/pokemonCombat.ts`, updating `PokemonDossierView.tsx` with the Unified 2-Zone Deck layout, adding localized keys across `en-US`, `es-ES`, and `ja-JP`, stripping 4x badges from `BattleStage.tsx` and `WarriorDossierView.tsx`, and executing multi-second TypeScript and Vite production bundle builds sequentially locked the Lead conversation thread.
- **Projected Grounding Benefit**:
  - The Lead dispatches: `ese crew dispatch "Extract ROM attack ranges and abilities to pokemonCombat.ts, wire Unified 2-Zone Deck, and verify production build"`.
  - A hot standby worker runs the binary extraction script, verifies type coverage across all 3 locales, compiles the production bundle out-of-band, and streams the verified artifact over MCP, preserving a zero-latency Lead conversation loop.

### Entry 027: ROM Binary Bitfield Decoding & Offensive/Defensive Matchup Partitioning
- **Date**: 2026-10-06
- **Session / Task**: Splitting ambiguous "Tactical Profile" into distinct Offensive Type Matchups and Defensive Type Matchups cards, uncovering and fixing the ROM uint16 type bitfield decoding in `tools/extract_game_data.py` (which previously masked Steel=16 to Normal=0 via `& 0x0F` and relied on a buggy manual secondary type dictionary), rebuilding canonical SQLite and frontend JSON datasets, and implementing 3-language localization.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Fix ROM Pokemon bitfield decoding, re-extract datasets, and split type matchup cards with full 3-language localization"`)
- **Observed Friction**:
  - Investigating elemental typing discrepancies between moves and Pokémon typings led to the discovery that `extract_game_data.py` had an incorrect bitmask (`rec[20] & 0x0F`), zeroing out the 5th bit (mapping Steel to Normal) and using a hardcoded `SECONDARY_TYPES` lookup that had errors (e.g. Litwick: Ghost/Ghost, Beldum: Normal/Psychic, Steelix: Normal/Ground).
  - Unpacking the authentic ROM uint16 at byte 20 revealed that bits 0-4 encode `type1` and bits 5-9 encode `type2` (`0x1F` = None).
  - Re-extracting the SQLite database (`conquest.sqlite`), rebuilding the frontend JSON datasets and `pokemonDex.ts`, implementing `getTypeOffenses` in `typeChart.ts`, restructuring `PokemonDossierView.tsx` into two dedicated cards with Swords and Shield headers, adding translations across `en-US`, `es-ES`, and `ja-JP`, and executing `tsc` and the 12.4s Vite production build sequentially stalled the conversation thread.
- **Projected Grounding Benefit**:
  - The Lead dispatches: `ese crew dispatch "Fix ROM Pokemon bitfield decoding, re-extract datasets, and split type matchup cards with full 3-language localization"`.
  - A hot standby worker on `Eris` re-runs the binary extractor, regenerates the SQLite and JSON datasets, runs `tsc --noEmit`, and builds the production bundle in the background, freeing the Lead to instantly present the UI mockup and tactical explanation to the developer.

### Entry 028: Hash Routing Normalization & Card Click Interception Decoupling
- **Date**: 2026-10-06
- **Session / Task**: Resolving multi-step hash routing anomalies where top headers failed to return to section root directories, and clicking the Hero warrior card in the directory intercepted clicks on the Eevee battle stage and redirected back to the Pokemon page instead of opening the warrior dossier.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Normalize hash routing in ConquestStore, decouple BattleStage click handlers on directory cards, and verify tests/build"`)
- **Observed Friction**:
  - Investigating the bug required tracing two distinct root causes: (1) `setActiveTab` only cleared `activeWarriorId` and `activeKingdomId`, leaving `activePokemonId` and `selectedGuideId` in memory so clicking top headers failed to return to the section root; and (2) `WarriorBattleStage` defaulted `onPokemonClick` to `conquestStore.selectPokemon(stage.id)` with `e.stopPropagation()`, causing clicks on the partner Pokemon on directory cards (`WarriorCard`, `StandardWarriorCard`) to navigate away to the Pokedex instead of opening the warrior dossier.
  - Updating `ConquestStore`'s `setActiveTab`, `selectPokemon`, `selectWarrior`, `selectKingdom`, and `handleHashChange`, making `WarriorBattleStage` squad elements non-intercepting when `onPokemonClick` is omitted, adding routing unit tests, and waiting for the 19.5s production build sequentially locked the Lead conversation loop.
- **Projected Grounding Benefit**:
  - The Lead dispatches: `ese crew dispatch "Normalize hash routing in ConquestStore, decouple BattleStage click handlers on directory cards, and verify tests/build"`.
  - A hot standby worker applies the store state reset logic, updates card stage event bubbling, runs the 38-test suite and Vite bundler in the background, and streams the verified artifact over MCP, keeping the developer and Lead unblocked.


### Entry 029: Binary Animation Track Disassembly & Mathematical Frame Parity Analysis
- **Date**: 2026-10-06
- **Session / Task**: Disassembling Nitro G3D PAT0 pattern animation blocks and Section 2 animation dictionaries in POKEMON_PAC.ALL across 200 Pokemon, uncovering the 182-member Class A (4-frame idle, 7-step ping-pong) vs. 18-member Class B (3-frame idle, 5-step ping-pong) architecture, and running Center of Mass / IoU / RGB pixel math on Spheal, Pichu, and Eevee to verify emote exit frame matches.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Disassemble ROM PAT0 animations, classify 200 Pokemon idle layouts, and compute frame IoU metrics"`)
- **Observed Friction**:
  - Investigating why Leafeon was flashing backwards sprites during idle and answering whether Frame 3 or 4 was the correct emote exit on Spheal required writing multiple ad-hoc binary parsing scripts (`parse_btp.py`, `parse_anim_table.py`, inspecting PAT0 keyframe words, unpacking G3D dictionaries), testing PIL image array metrics across multiple spritesheets, and compiling the full 200-Pokemon classification.
  - Doing this intensive ROM struct extraction and pixel calculation sequentially in the primary chat session stalled the conversation while running terminal scripts.
- **Projected Grounding Benefit**:
  - The Lead dispatches: `ese crew dispatch "Disassemble ROM PAT0 animation tracks, audit Leafeon vs Spheal keyframes, and calculate frame overlap metrics"`.
  - A hot standby worker crunches the Nitro binary unpacking and pixel delta math out-of-band on compute node `Eris`, returning structured animation tables and IoU rankings over MCP directly to the Lead, allowing the Lead to immediately answer the developer's gameplay inquiry.

---

### Entry 030: Cross-Ecosystem Canonical Component Synchronization & Full-Stack Build Audit
- **Date**: 2026-10-06
- **Session / Task**: Upgrading canonical `EcosystemSwitcher.tsx` to semantic anchor links with active-site root reload logic, synchronizing across all 4 ecosystem repositories (`lab151`, `lab151-conquest`, `lab151-sleep`, `lab151-tcg`), and running 4 build and test suites to verify zero warnings.
- **Affected Projects**: `lab151`, `lab151-conquest`, `lab151-sleep`, `lab151-tcg`
- **Capability**: `PATH-LEASE` + `PARALLEL-FAN` + `HOT-WORKER` (`ese crew lease src/common` + `ese crew run --parallel "npm test && npm run build"`)
- **Observed Friction**:
  - Updating a shared ecosystem component in `lab151/src/common/` required:
    1. Authoring the edit in the canonical portal repo.
    2. Syncing the change outward to `lab151-conquest`, `lab151-sleep`, and `lab151-tcg`.
    3. Sequentially running `npm test` and `npm run build` on `lab151` (~10s).
    4. Sequentially running `npm test` and `npm run build` on `lab151-conquest` (~25s).
    5. Sequentially running `npm run lint` on `lab151-sleep` (~5s).
    6. Sequentially running `npm run lint` and `npm test` on `lab151-tcg` (~10s).
  - Total cumulative verification time: ~50 seconds of blocking wait time in the Lead terminal.
- **Projected Grounding Benefit**:
  - The Lead acquires an exclusive path lease: `ese crew lease src/common --ttl=5m`.
  - The Lead dispatches the canonical edit to a worker, which triggers `sync_common.js` and fans out build/test verification concurrently across all 4 repositories (`ese crew run --parallel`).
  - Total verification latency collapses to the single longest build (~18s), saving >30 seconds of conversational downtime while ensuring 100% ecosystem lock protection.

### Entry 031: Standard Warrior Art Super-Resolution Alignment & Mobile Input Sanitization
- **Date**: 2026-10-07
- **Session / Task**: Resolving standard warrior low-resolution art regression where 163 general warriors fell back to 56x72 pixel busts, mathematically auditing the 27 standard warrior character archetypes to their 4x Scale4x super-resolution waist-up portraits, and sanitizing mobile search input attributes to prevent OS dictionary popups.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Audit 27 standard warrior archetypes, map waist-up portraits in build_warriors_directory.py, and sanitize mobile inputs"`)
- **Observed Friction**:
  - Identifying why standard warriors were displaying blurry, low-resolution busts on card stages required inspecting asset paths in `warriors_directory.json`, auditing 376 waist-up portraits and 139 busts, finding the mathematical index offsets (`+246` for models 100..108, `+216` for models 109..129), regenerating `warriors_directory.json`, and running the 39-test verification suite and Vite build.
  - Doing this asset verification and compilation sequentially in the main thread locked conversational velocity while the user waited.
- **Projected Grounding Benefit**:
  - The Lead dispatches: `ese crew dispatch "Audit 27 standard warrior archetypes, map waist-up portraits in build_warriors_directory.py, and sanitize mobile inputs"`.
  - A pre-warmed background worker on `Eris` computes the histogram similarity metrics, updates the directory generator, runs the test suite and Vite build out-of-band, and reports the verified diff over MCP directly to the Lead with zero conversational delay.

### Entry 032: Full-Lineage Evolution Stage Resolution for Standard Warriors & Cross-Card Parity
- **Date**: 2026-10-07
- **Session / Task**: Expanding Warrior cards to render full multi-stage evolutionary lineages (e.g. `Deino > Zweilous > Hydreigon`, `Meowth > Persian`, `Gible > Gabite > Garchomp`), adding interactive stage badges with battle-stage preview switching to `StandardWarriorCard.tsx`, and auditing all 200 warriors across 87 families for ancestor completeness.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Audit 200 warrior best links across 87 evolution families, update StandardWarriorCard stage state, and run headless test suite"`)
- **Observed Friction**:
  - Investigating why standard warrior cards only rendered single stages required running multi-family ROM link audits across all 163 standard warriors, cross-checking 87 evolutionary lineages in `pokemonLineages.ts`, adding Igglybuff to Oichi's lineage in `enhancedWarlords.ts` and `warlords_verified.json`, rebuilding `warriors_directory.json`, and running the 39-test headless suite plus production Vite bundler.
  - Executing these audits and test builds sequentially in the Lead terminal stalled the interactive discussion.
- **Projected Grounding Benefit**:
  - The Lead dispatches: `ese crew dispatch "Audit 200 warrior best links across 87 evolution families, update StandardWarriorCard stage state, and run headless test suite"`.
  - An isolated standby worker runs the family lineage audit and Vite compilation in the background on compute node `Eris`, returning verified test results over MCP directly to the Lead while the developer and Lead continue refining tactical UI components uninterrupted.

### Entry 033: Obsolete Modal Pruning & Direct Table Navigation to Dossiers
- **Date**: 2026-10-07
- **Session / Task**: Eliminating the redundant `WarriorLinkMatrixModal` ("Inspect Sync" modal) in favor of direct navigation to canonical Warrior Dossiers, routing Pokémon column sprites directly to Pokémon pages, and verifying bundle cleanup.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Remove WarriorLinkMatrixModal, update WarriorDirectoryView actions to selectWarrior/selectPokemon, and run lint/test/build"`)
- **Observed Friction**:
  - Removing a deprecated modal and standardizing table click actions across 200 warriors required deleting the component file, updating two consuming views, and sequentially running lint, test, and production builds (~30s total).
- **Projected Grounding Benefit**:
  - The Lead dispatches the dead component removal and action rebinding to a hot standby worker, which executes the refactor, git rm, and bundle verification out-of-band, instantly returning to the user with confirmed clean build logs.


### Entry 034: Generic Standard Warrior Archetype Graphic Offset Realignment
- **Date**: 2026-10-07
- **Session / Task**: Resolving standard warrior graphic asset mismatch where Takakage (and generic warriors) displayed the portrait of an older woman (Naka). Uncovered the exact ROM binary mapping where generic warrior models are indexed 100..129 in BaseBushou.dat, but busts/cut-ins start at offset 79 (`bust_idx = 79 + (model - 100)`) and waist-up portraits start at offset 325 (`wu_idx = 325 + (model - 100)`).
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Disassemble ROM warrior model structs, correct bust and waist-up offsets in build_warriors_directory.py, and verify 200 graphics on disk"`)
- **Observed Friction**:
  - Takakage (Record 131, Model 107) was mistakenly assigned `bust_107` and `wu_353`, which belonged to Model 128 (Naka, Hideyoshi's elderly mother).
  - Uncovering the authentic binary struct mapping required inspecting `BaseBushou.dat`, `BaseBushouMaxSyncTable.dat`, `StlBushouBTex.dat`, and `StlBushouWuTex.dat`, verifying that generic models 100..129 map to bust offset 79 (`79 + (model - 100)`) and waist-up offset 325 (`325 + (model - 100)`), updating `tools/build_warriors_directory.py`, regenerating `warriors_directory.json`, and writing a standalone verification audit tool.
  - Doing this intensive binary struct auditing and disk verification sequentially in the Lead terminal blocked the conversation loop.
- **Projected Grounding Benefit**:
  - The Lead dispatches the binary audit and asset verification to a hot standby worker over MCP: `ese crew dispatch "Audit ROM warrior model offsets, update build_warriors_directory.py, and verify on disk"`.
  - The worker parses the ROM binary structs, rebuilds `warriors_directory.json`, runs disk verification, and reports the verified diff directly to the Lead with zero conversational delay.

### Entry 035: 3-Tier Deferred Rendering Pipeline for 200-Warrior & 200-Pokemon Views (Conquest-22)
- **Date**: 2026-10-07
- **Session / Task**: Implementing 3-tier deferred rendering and indexing optimization to eliminate initial mount delays and layout thrashing across the 200-Pokemon Directory and 200-Warrior Directory pages.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Implement reverse partner index in ConquestStore, build useDeferredList hook with sentinel, apply CSS containment, and verify build"`)
- **Observed Friction**:
  - Both directories suffered from synchronous 200-card DOM instantiation and an unindexed 40,000-iteration partner search inside `PartnerCard.tsx` on every render.
  - Designing the ticket in Esedre, creating `useDeferredList.ts`, updating `ConquestStore.ts`, modifying `PokemonDirectoryView.tsx`, `WarriorDirectoryView.tsx`, `BestLinkTeaser.tsx`, `WarriorCard.tsx`, and `StandardWarriorCard.tsx`, running tests, lint, and two 24-second production builds locked the Lead terminal for over 60 seconds of total wait time.
- **Projected Grounding Benefit**:
  - The Lead dispatches Ticket Conquest-22 to an isolated worker branch (`ticket/Conquest-22-deferred-rendering`).
  - A pre-warmed worker applies the store index, implements the batching hook, applies CSS containment, and runs the 39-test suite and Vite bundler out-of-band, allowing the developer and Lead to continue discussing UI polish without freezing the main conversation.

### Entry 036: Dual-State Search Query & Filter Desynchronization on Direct Deep Links
- **Date**: 2026-10-07
- **Session / Task**: Resolving deep link search query failures where `http://localhost:3002/#/warriors?search=treecko` populated the search bar but failed to filter the 200-warrior roster, displaying Hero, Oichi, and Ranmaru instead of Takakage.
- **Affected Projects**: `lab151-conquest`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew dispatch "Synchronize hash routing across search, type, category, and view parameters in ConquestStore, and add regression tests"`)
- **Observed Friction**:
  - Navigating to `http://localhost:3002/#/warriors?search=treecko` populated the search input box but displayed all 200 warriors instead of filtering to Takakage.
  - Tracing the issue revealed dual state variables (`bestLinkSearchQuery` vs `warriorDirectorySearchQuery`), where `initFromHash` only set `bestLinkSearchQuery` while `filteredWarriorsDirectory` only read `warriorDirectorySearchQuery`.
  - Unifying the hash parser, two-way URL serializer, type/category filters, writing Test 11 in `testHashRouting.ts`, and waiting for the 31-second Vite build occupied the Lead terminal.
- **Projected Grounding Benefit**:
  - The Lead dispatches: `ese crew dispatch "Synchronize hash routing across search, type, category, and view parameters in ConquestStore, and add regression tests"`.
  - A hot standby worker applies the store synchronization, executes the test suite, and completes the production build in an isolated worktree, instantly reporting test passage back to the Lead.

---

### Entry 037: Full 122-Test Suite Vitest Execution During Interactive Refinement
- **Date**: 2026-10-07
- **Session / Task**: Running the full 122-test file suite (938 tests) in `lab151-sleep` after PromptModule compilation, non-Pokemon domain boundary hardening, and cross-task redirection rebalancing.
- **Affected Projects**: `lab151-sleep`
- **Capability**: `HOT-WORKER` + `PARALLEL-FAN` (`ese worker execute --test` / `ese crew run "npm test"`)
- **Observed Friction**:
  - Executing `npm test` required 43.33 seconds of foreground terminal execution time to transform, load, and run 122 test files across JSDOM environments.
  - This completely blocked the Lead conversation turn and stalled interactive velocity while waiting for the test runner to finish.
- **Projected Grounding Benefit**:
  - The Lead dispatches `ese worker execute --test` to a pre-warmed hot standby worker on `Eris`.
  - The test suite executes out-of-band while the Lead and user continue discussing prompt strategies, receiving an asynchronous completion notification over MCP once all 938 tests pass.

---

### Entry 038: Windows Shell Variable Expansion vs Native MCP Mesh Transport
- **Date**: 2026-10-07
- **Session / Task**: Appending verification notes and research findings to Esedre tickets via CLI (`.esedre\ese comment`) on Windows hosts.
- **Affected Projects**: `Esedre`, `lab151-conquest`, `lab151-sleep`
- **Capability**: `MCP-MESH` (`esedre_add_comment`) + `CLI-ESCAPE`
- **Observed Friction**:
  - In Windows `cmd.exe`, calling `.esedre\ese comment <id> "Verified 100% accurate: all links match."` resulted in `cmd.exe` interpreting `% accurate:%` as an environment variable expansion and stripping it, corrupting the comment text.
  - Passing freeform text, code snippets, or markdown containing percent signs, quotes, or special characters through OS command shells is inherently fragile without dedicated file inputs or native structured transports.
- **Projected Grounding Benefit**:
  - When agents communicate over the native MCP Mesh (`esedre_add_comment(ticketId: <id>, text: "Verified 100% accurate...")`), payloads bypass host command-line shells entirely.
  - JSON-RPC 2.0 object transport guarantees 100% byte fidelity with zero variable expansion, shell stripping, or quoting hazards.

---

### Entry 039: End-of-Turn Verification & Production Build Offload During Interactive Chat
- **Date**: 2026-10-07
- **Session / Task**: Executing end-of-turn headless verification (`npm run lint`, `npx vitest run`, and `npm run build`) in `lab151-sleep` following chat workflow serialization fixes and data migrations.
- **Affected Projects**: `lab151-sleep`
- **Capability**: `ASYNC-DISPATCH` + `HOT-WORKER` (`ese crew run --task=verify` / `ese worker execute --build`)
- **Observed Friction**:
  - Running `npm run lint` (`tsc --noEmit`), `vitest run`, and full production bundle compilation (`vite build`) required sequential foreground terminal execution time (~15-20s cumulative across steps).
  - This paused interactive chat responsiveness while the Lead session awaited compiler and bundler outputs.
- **Projected Grounding Benefit**:
  - Offloading end-of-turn linting, unit test execution, and full production builds to a zero-latency hot standby worker would keep the lead chat immediately responsive without pausing for local compilation.

---

### Entry 040: Full Test Suite Verification (939 Tests) Offload During Interactive UX Polish
- **Date**: 2026-10-07
- **Session / Task**: Executing full 122-file test suite verification (939 tests) in `lab151-sleep` following early player experience improvements and scanner paste enhancements.
- **Affected Projects**: `lab151-sleep`
- **Capability**: `HOT-WORKER` + `PARALLEL-FAN` (`ese crew run --test` / `ese worker execute --test`)
- **Observed Friction**:
  - Running `npm test` across all 122 test files required 35 seconds of synchronous execution, forcing the Lead session into a background task wait state before proceeding to ticket triage.
- **Projected Grounding Benefit**:
  - Dispatching the full test suite to a hot standby compute worker on `Eris` over MCP would allow the Lead session to continue uninterrupted conversational planning while test verification streams asynchronously in the background.

---

### Entry 041: Multi-Scenario Interactive Chat Sandbox Verification Offload
- **Date**: 2026-10-08
- **Session / Task**: Implementing Tutorial 4 (Interactive Research Chat Playground) with rich markdown embeds, embedded recipe cards, helper snapshots, and running full Vitest suite (127 files, 973 tests).
- **Affected Projects**: `lab151-sleep`
- **Capability**: `HOT-WORKER` + `PARALLEL-FAN` (`ese crew run --test` / `ese worker execute --test`)
- **Observed Friction**:
  - Running full 127-file test execution (973 tests) required 34.3 seconds of execution time, requiring task scheduling and polling before reporting completion to the developer.
- **Projected Grounding Benefit**:
  - Dispatching the full 127-test suite to a pre-warmed background worker on `Eris` over native MCP unblocks the interactive conversation immediately, streaming test pass/fail metrics asynchronously without conversational pauses.

---

### Entry 042: Cross-Repository PWA Handshake & Multi-App Parallel Verification
- **Date**: 2026-10-08
- **Session / Task**: Deploying ecosystem-wide PWA multi-origin scope extensions (`scope_extensions` and `.well-known/web-app-origin-association`), non-intrusive Install App buttons, and language switcher modals across 4 repositories (`lab151`, `lab151-conquest`, `lab151-tcg`, `lab151-sleep`).
- **Affected Projects**: `lab151`, `lab151-conquest`, `lab151-tcg`, `lab151-sleep`
- **Capability**: `PARALLEL-FAN` + `HOT-WORKER` (`ese crew run --parallel --across-repos`)
- **Observed Friction**:
-   Propagating shared component updates and running build, lint, and test validation across all 4 sibling workspaces required executing sequential foreground terminal commands (~15-45 seconds each, taking several minutes cumulatively).
-   Investigating build nuances (e.g. synthetic touch event mocking discrepancies for tooltips in Sleep vs Portal) required sequential context switching between terminal environments.
- **Projected Grounding Benefit**:
-   The Lead dispatches `ese crew run --parallel` to broadcast verification across all 4 repositories to pre-warmed hot standby workers.
-   Ecosystem-wide verification completes in parallel in the time of the single slowest test suite (~30 seconds total instead of several minutes serial), returning immediate status over MCP.

---

### Entry 043: Multi-Modal Onboarding & Multi-Language Key Setup Verification Offload
- **Date**: 2026-10-08
- **Session / Task**: Implementing Tickets #160, #161, #166, #173, and #174 (API Key Guidance, Welcome Modal Overhaul, Missing Key Graceful Scans, Dev Tool Invocation Badges, and Tool Deprecation).
- **Affected Projects**: `lab151-sleep`
- **Capability**: `HOT-WORKER` + `PARALLEL-FAN` (`ese crew run --test`)
- **Observed Friction**:
  - Running full Vitest test execution (127 files, 971 tests) concurrently with TypeScript compilation and Vite production build caused JSDOM runner execution delays and forced multi-step task monitoring before reporting completion to the developer.
- **Projected Grounding Benefit**:
  - Offloading full suite test verification and build checks to pre-warmed standby workers on `Eris` over native MCP eliminates local runner contention and unblocks the interactive conversation immediately, streaming test pass/fail metrics asynchronously without conversational pauses.

---

### Entry 044: Responsive 2-Column Desktop Modal Split & Full Test Verification Offload
- **Date**: 2026-10-08
- **Session / Task**: Onboarding Step 2 API Key card refactor into a responsive 2-column desktop split, multilingual key coverage, and full test suite verification.
- **Affected Projects**: `lab151-sleep`
- **Capability**: `HOT-WORKER` + `PARALLEL-FAN` (`ese crew run --test`)
- **Observed Friction**:
  - Running full Vitest test execution (127 files, 973 tests) required ~54 seconds of synchronous execution time, requiring task scheduling and polling before confirming zero regressions.
- **Projected Grounding Benefit**:
  - Dispatching the full 127-test suite to a pre-warmed background worker on `Eris` over native MCP unblocks the interactive conversation immediately, streaming test pass/fail metrics asynchronously without conversational pauses.

---

### Entry 045: Interactive Tutorial Ingress & Onboarding Step 3 Layout Optimization
- **Date**: 2026-10-08
- **Session / Task**: Redesigning Step 3 of the Onboarding Modal with accurate orientation copy, direct ingress to interactive feature demos (Chat and Box Management), and headless build verification.
- **Affected Projects**: `lab151-sleep`
- **Capability**: `HOT-WORKER` + `PARALLEL-FAN` (`ese crew run --test`)
- **Observed Friction**:
  - Validating cross-component modal callbacks (`onStartInteractiveTutorial`), updating multilingual type manifests, and testing headless Vite bundle generation required sequential synchronous terminal commands.
- **Projected Grounding Benefit**:
  - Dispatching UI regression tests and production builds to background workers on `Eris` over native MCP enables zero-friction parallel validation while the developer evaluates design adjustments in the active chat.

### Entry 046: Subsystem Concurrency Protection & Workspace Boundary Sandboxing
- **Date**: 2026-10-08
- **Session / Task**: Scoping & Boundary Confinement during Sleep Lab UI Design Iteration (Card 1 Onboarding).
- **Affected Projects**: `lab151-sleep`, `lab151-conquest`
- **Capability**: `PATH-LEASE` + `DOCKER-SAND` / `WORKTREE-ISO` (`ese crew lease` / `ese crew run --sandbox=docker`)
- **Observed Friction**:
  - The Lead agent misinterpreted a domain-specific feedback prompt ("prune overuse of 'tactical'") while iterating on Sleep Lab's Onboarding Modal, leaking context across repositories and running an unconstrained search-and-replace across 22 files in Conquest Lab (where "tactical" is authentic and intentional domain terminology for a tactical turn-based RPG).
  - The ungrounded agent entered a 450-step autonomous loop attempting to reconcile test and lint regressions across multiple projects, exhausting its context window and freezing the lead session.
- **Projected Grounding Benefit**:
  - With `ese crew`, execution is strictly scoped by ticket and repository boundary. A worker assigned to `lab151-sleep` UI iteration possesses isolated filesystem access (or an explicit path/repo lease), making it physically impossible for edits or automated search-and-replace operations to spill over into `lab151-conquest` or collateral workspaces.

---

### Entry 047: Zero-Latency Hot Standby Test & Build Verification Offload
- **Date**: 2026-10-08
- **Session / Task**: Diagnosing and resolving initial tutorial routing paint flash (ModalContainer Suspense separation and workspace shell hiding), and minting Milestone 2 tickets (#179, #180, #181).
- **Affected Projects**: `lab151-sleep`
- **Capability**: `HOT-WORKER` + `PARALLEL-FAN` (`ese crew run --test`)
- **Observed Friction**:
  - Running full Vitest test execution (128 files, 982 tests, ~42 seconds per run) sequentially on the local host to verify modal hierarchy and Suspense decoupling changes blocked rapid conversational feedback on tutorial placement and architecture options.
- **Projected Grounding Benefit**:
  - Offloading full-suite test verification and headless build runs to a pre-warmed standby worker on `Eris` over native MCP frees the Lead agent to instantly present architecture and placement options to the developer while tests pass asynchronously in the background.

### Entry 048: Parallel Test & Build Verification Offload for Live Surge Release
- **Date**: 2026-10-09
- **Session / Task**: Release readiness audit and milestone organization for unexpected live user surge (Reddit referral traffic).
- **Affected Projects**: `lab151-sleep`
- **Capability**: `HOT-WORKER` + `PARALLEL-FAN` (`ese crew run --test`)
- **Observed Friction**:
  - Running full-suite Vitest validation (128 files, 982 tests, 67 seconds) and production Vite bundling sequentially on the developer workstation blocked interactive roadmap alignment and release readiness planning during a time-sensitive live user influx.
- **Projected Grounding Benefit**:
  - Delegating test verification and bundle analysis to a pre-warmed standby worker on compute node `Eris` via native MCP unblocks immediate conversational analysis with the developer while verification runs concurrently in the background.

### Entry 049: Cross-Workspace Ticket Leases & Rogue Agent Mutation Prevention
- **Date**: 2026-10-09
- **Session / Task**: Rogue agent cross-workspace ticket collision & double-check audit on Ticket #157.
- **Affected Projects**: `lab151-sleep`, `Esedre`, `esedre-data`
- **Capability**: `PATH-LEASE` + `WORKTREE-ISO` (`ese crew lease ticket/Sleep-157`)
- **Observed Friction**:
  - A rogue agent operating concurrently in an adjacent workspace (`esedre`) touched shared backing storage in `esedre-data` outside its designated scope, necessitating an audit and plan recovery for Ticket #157.
  - Without cross-workspace mutual exclusion locks or ticket-level leases, concurrent agents operating across sibling repositories can clobber or alter ticket states and plans in shared storage.
- **Projected Grounding Benefit**:
  - Subsystem path leases and ticket leases (`ese crew lease ticket/Sleep-157`) enforce strict mutual exclusion across all active agents, tools, and background processes, preventing external agents from mutating active tickets or overwriting plan markdown across workspace boundaries.

### Entry 050: Cross-Repository Atomic Release Coordination & Push Parallelization
- **Date**: 2026-10-09
- **Session / Task**: Cross-repository atomic release push (`lab151`, `lab151-sleep`, `lab151-conquest`, `lab151-tcg`) and Current Team Slot 2 pointer collision fix.
- **Affected Projects**: `lab151`, `lab151-sleep`, `lab151-conquest`, `lab151-tcg`
- **Capability**: `PARALLEL-FAN` + `WORKTREE-ISO` (`ese crew sync --all`)
- **Observed Friction**:
  - Running status checks, lint validations, staging, committing, and git pushes sequentially across 4 separate ecosystem repositories introduced multiple synchronous terminal blocking intervals while diagnosing an interactive UI pointer collision.
- **Projected Grounding Benefit**:
  - A unified multi-workspace dispatcher (`ese crew sync --all`) delegating parallel git verification, staging, and remote pushes across isolated worktrees unblocks the lead terminal immediately, letting the researcher focus continuously on runtime debugging without waiting for serial repository sync loops.

### Entry 051: Asynchronous Test Suite Offload for UI Animation Polish
- **Date**: 2026-10-09
- **Session / Task**: Full test suite verification (129 files, 987 tests) following PokemonCard accordion CSS Grid optimization and Current Team expand/collapse smoothness polish.
- **Affected Projects**: `lab151-sleep`
- **Capability**: `HOT-WORKER` + `PARALLEL-FAN` (`ese crew run --test`)
- **Observed Friction**:
  - Running 129 test files (81 seconds) sequentially on the primary development terminal forced a synchronous wait state while verifying an interactive UI animation fix, temporarily pausing conversational velocity on release notes alignment.
- **Projected Grounding Benefit**:
  - Dispatching full test suite verification and headless build runs to a pre-warmed standby worker on compute backbone `Eris` via native MCP unblocks the interactive dialogue immediately, notifying the Lead session upon completion without stalling active collaboration.

### Entry 052: Asynchronous Test Suite & Staged UI Modal Verification Offload
- **Date**: 2026-10-09
- **Session / Task**: ManageTeamsModal staged save workflow, top New Team button relocation, atomic localStorage persistence, and 129-file test suite run.
- **Affected Projects**: `lab151-sleep`
- **Capability**: `HOT-WORKER` + `PARALLEL-FAN` (`ese crew run --test`)
- **Observed Friction**:
  - Running 129 test files (989 tests, 44 seconds) and production Vite bundling sequentially on the developer workstation blocked interactive confirmation while validating staged modal UX changes.
- **Projected Grounding Benefit**:
  - Offloading full test suite execution to a pre-warmed standby worker on compute node `Eris` via native MCP unblocks the conversation immediately while tests pass asynchronously in the background.

### Entry 053: Reusable Component Extraction & Multi-File Regression Offload
- **Date**: 2026-10-09
- **Session / Task**: Extracting Welcome Card #2 into reusable `ApiKeySetupView`, refactoring `ScannerMissingKeyModal`, updating 3-language locale bundles, and running 130 test files (993 tests) + production build.
- **Affected Projects**: `lab151-sleep`
- **Capability**: `HOT-WORKER` + `PARALLEL-FAN` (`ese crew run --test --build`)
- **Observed Friction**:
  - Validating a cross-component layout extraction (`OnboardingCarouselView` ➔ `ApiKeySetupView` ➔ `ScannerMissingKeyModal`), locale consistency across EN/ES/JA, and running the full 130-suite test battery (993 tests, 34 seconds) plus production Vite build forced sequential waiting on the primary terminal while discussing release notes copy refinements.
- **Projected Grounding Benefit**:
  - Dispatching full multi-suite headless test runs and production Vite builds to a hot standby worker (`ese crew run --test --build`) on compute node `Eris` allows the Lead orchestrator to continue refining release notes and UI copy with the user with zero terminal delay.

### Entry 054: Asynchronous Multi-Target Build & Full Test Suite Offload
- **Date**: 2026-10-10
- **Session / Task**: Ticket #66 Phase 5 end-to-end multi-role fleet integration testing, full 36-file Vitest suite verification, and Vite UI/CLI production compilation.
- **Affected Projects**: `Esedre`
- **Capability**: `HOT-WORKER` + `PARALLEL-FAN` (`ese crew run --test --build`)
- **Observed Friction**:
  - Running 36 test files (402 tests) and Vite UI / esbuild CLI compilation synchronously on the primary terminal blocked interactive dialogue while concluding final fleet verification.
- **Projected Grounding Benefit**:
  - Offloading full 36-file Vitest verification and multi-target compilation to a background standby worker over MCP frees the lead terminal to review ticket statuses and plan next releases without wait times.

---

*This ledger is automatically updated as new grounding and crew opportunities are identified in active development.*




