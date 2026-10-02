---
name: git_branching_and_release_workflow
description: Standard Git branching strategy, release/upcoming staging integration workflow, ticket child branch lifecycles, and production release PR standards.
---

# Git Branching & Release Workflow

This repository strictly adheres to the **`release/upcoming` integration trunk** branching strategy (identical to the standard established in Sleep Lab 151).

---

## 1. Branch Hierarchy & Roles

```
               [ Pull Request ]
release/upcoming  ──────────────>  main (Production)
      ▲                              │
      │ [merge back]                 │ [post-release sync]
      │                              ▼
ticket/<Code>-<id>-<slug>     release/upcoming
```

1. **`main` (Production Branch)**:
   - Canonical production-ready code.
   - **Main Branch Lockdown**: Direct pushes to `origin/main` or direct merges into `main` are strictly forbidden (zero exceptions).
   - Deploys, package publication, and tags trigger exclusively from `main`.
   - Releases land in `main` exclusively through Pull Requests from `release/upcoming`.

2. **`release/upcoming` (Integration & Staging Trunk)**:
   - The central, persistent integration and staging branch across active development cycles.
   - All completed ticket and feature branches merge into `release/upcoming`.
   - Accumulates multiple completed tickets, enhancements, and fixes for the next release milestone.
   - Tested and verified holistically prior to production promotion.

3. **`ticket/<ProjectCode>-<id>-<slug>` (Child Work Branches)**:
   - Short-lived, isolated development branches dedicated to a specific ticket or fix.
   - Always created directly off `release/upcoming` (never off `main`).
   - All code edits, commits, and intermediate test cycles occur on this branch.

---

## 2. Standard Development Lifecycle

### Step 1: Branch Creation Off `release/upcoming`
Before touching code or starting work on a ticket, ensure your local `release/upcoming` is up-to-date, then branch:
```bash
git checkout release/upcoming
git pull --no-pager origin release/upcoming
git checkout -b ticket/<ProjectCode>-<id>-<slug>
```

### Step 2: Implementation & Verification
Implement the requested changes, strictly observing all codebase invariants:
- Zero em dashes (`\u2014`) in code, comments, or documentation.
- Run headless tests: `npm test`.
- Run full builds and linters: `npm run build` and `npm run lint`.
- Verify all tests pass with zero regressions.

### Step 3: Explicit Commit Authorization
- **NEVER** run `git add`, `git commit`, or `git push` without explicit, unambiguous permission from the user in that **specific turn** (must contain the word "commit" or "push").
- Zero turn-to-turn carryover for commit permissions.
- Pre-flight check: Verify that `README.md`, `AGENTS.md`, and relevant agent skills are completely up-to-date before committing.

### Step 4: Merge Child Branch into `release/upcoming`
Once the ticket's work is committed and approved by the user, merge the child branch into `release/upcoming`:
```bash
git checkout release/upcoming
git merge --no-ff ticket/<ProjectCode>-<id>-<slug>
```
Delete or archive the local child branch if requested by the user.

---

## 3. Production Release & PR Promotion Workflow

When a milestone or batch of tickets is ready for production release:

1. **Open Pull Request from `release/upcoming` to `main`**:
   - Source branch: `release/upcoming`
   - Target branch: `main`

2. **Pull Request Titles & Formatting (Clean High-Level Human Descriptions)**:
   - Always write clean, high-level, human-readable PR titles summarizing the release version, primary features, and referenced ticket numbers.
   - **Format**: `v<version>: <High-Level Summary> (#<ticket1>, #<ticket2>)`
   - **Example**: `v0.4.0: Support File and Detail in Ticket Updates (#49)`
   - **Example**: `v1.1.0: Multi-Project Allow-List and Milestone Enhancements (#33, #38)`
   - 🚨 **Strict Prohibition on Conventional Prefixes in PR Titles**: Conventional commit prefixes (such as `feat(...)`, `fix(...)`, `chore(...)`) are strictly prohibited in PR titles. Keep PR titles clean, descriptive, and professional for human review.

3. **Post-Release Alignment (`main` -> `release/upcoming`)**:
   - Immediately following the merge of a release PR into `main`, merge `main` back into `release/upcoming` (or pull/rebase) so that active development stays cleanly aligned with the latest production baseline:
   ```bash
   git checkout release/upcoming
   git merge main
   ```

---

## 4. Critical Operating Invariants

1. **Zero Em Dashes**: Never use em dashes anywhere in branch names, commit messages, PR descriptions, code, or documentation.
2. **Explicit Turn Authorization**: Commits and pushes require explicit turn-by-turn user instruction.
3. **Multi-Project Scope Clarification**: When working across sibling repositories (`esedre`, `esedre-data`, `esedre-web`), always verify the target repository scope before staging or committing.
4. **Mandatory Documentation Pre-Flight**: Never allow documentation (`README.md`, `AGENTS.md`, `.agents/skills/`) to become stale when shipping features or CLI updates.
