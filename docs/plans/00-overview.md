# Plan 00 - Overview

**Goal:** Define the implementation roadmap for Local Brain: a Tauri desktop app with
SQLite as durable local storage, a human UI, and a CLI/skill contract for agents.

**Depends on:** Existing product docs in `docs/`.

**Unlocks:** All implementation plans.

## Scope

**In:** plan order, dependencies, status, and shared principles.

**Out:** code scaffolding, migrations, UI implementation, release packaging.

## Context

Read these first:

- [Product Thesis](../product-thesis.md)
- [Reflect Open Technology Base](../reflect-open-technology-base.md)
- [Launch Schema](../launch-schema.md)
- [Agent Interface](../agent-interface.md)
- [MVP Plan](../mvp-plan.md)
- [Open Questions](../open-questions.md)

Reflect Open is the technology base: Tauri, React, Rust native capabilities, SQLite in
Rust, Kysely over IPC, local embeddings, BYOK AI, keychain secrets, and sidecar CLIs.

The core divergence is storage truth: Reflect Open stores durable knowledge in markdown
and uses SQLite as a projection. Local Brain stores durable structured memory in SQLite.

## Plan Order

1. [Foundation and Toolchain](01-foundation-and-toolchain.md)
2. [SQLite Schema and DB Layer](02-sqlite-schema-and-db-layer.md)
3. [Desktop Shell and Core UI](03-desktop-shell-and-core-ui.md)
4. [Source Ingestion](04-source-ingestion.md)
5. [Memory Extraction and Correction](05-memory-extraction-and-correction.md)
6. [Search, Retrieval, and AI](06-search-retrieval-and-ai.md)
7. [CLI and Agent Skills](07-cli-and-agent-skills.md)
8. [Backup, Export, and Privacy](08-backup-export-and-privacy.md)
9. [Packaging and Launch](09-packaging-and-launch.md)

Support docs:

- [Architecture Conventions](architecture-conventions.md)
- [Libraries](libraries.md)

## Key Decisions

- The initial app targets macOS desktop.
- The implementation starts as a Local Brain repo scaffold, not a direct Reflect Open
  fork.
- SQLite is the durable local store.
- Raw sources may be preserved for auditability, but product state lives in SQLite.
- The first audience is agent-native technical users.
- The first user-visible surfaces are Today, Ask/Search, Sources, and Entities.
- The first agent interface is the `brain` CLI plus local skills.
- No hosted Local Brain service is required for the core product.

## Implementation Steps

1. Keep plans and docs in sync as decisions are made.
2. Implement plans in numerical order unless a later plan explicitly only depends on a
   subset of earlier work.
3. When implementation begins, create code in the structure described by
   [Architecture Conventions](architecture-conventions.md).
4. Preserve the distinction between durable data and derived/search/vector data in every
   plan.

## Acceptance Criteria

- Every MVP phase in [MVP Plan](../mvp-plan.md) maps to at least one numbered plan.
- No plan assumes markdown is the durable source of truth.
- Every numbered plan has Goal, Depends on / unlocks, Scope, Key decisions,
  Implementation steps, Acceptance criteria, Tests or verification, and Open questions.
- The roadmap is usable by another engineer or agent without asking for plan order.

## Tests or Verification

- Verify all links in this directory resolve locally.
- Run `git diff --check` after editing.
- Confirm `docs/README.md` links to this overview.

## Open Questions

- Product name remains working title: Local Brain.
- The exact initial repo/package names can be finalized in Plan 01.
