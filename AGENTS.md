# Agent Notes

Local Brain is currently a docs-only planning repo for a consumer personal CRM and
local memory app. The implementation will use Reflect Open's desktop technology base,
but SQLite is the durable source of truth.

Before starting work, read `docs/README.md` and reference
`/Users/alex/repos/reflect-open`. Reflect Open has the closest app structure, style,
tooling, and implementation patterns; reuse its choices unless Local Brain has a
product-specific reason to diverge. In particular, check
`/Users/alex/repos/reflect-open/docs/plans/libraries.md` before choosing libraries or
tooling, and inspect the relevant Reflect Open app files before implementing similar
desktop, CLI, database, search, AI, or UI behavior.

Keep product docs, schema docs, and numbered plans aligned with each other.

Current product shape:

- Agent-operated local brain with a private desktop UI for browsing and correction.
- SQLite owns durable data. Markdown is not the storage format.
- Most writes should come from AI agents through the CLI/skill contract, for example a
  Codex daily automation that ingests context, updates tasks, and records memories.
- Most reads should also be agent-driven, for example daily reports, todo lists, and
  briefings generated from the CLI or database access.
- Main user surfaces are Today, Tasks, Network, Projects, Graph, and Settings.
- Network contains People and Organizations.
- Documents and Interactions are first-class records, but they are browsed inside
  person, organization, project, and task detail pages, and through search.
- The UI is still important, but mainly for quick browsing, correction, inspection,
  and demonstrating the power of the user's local brain.
- Relationship intelligence is part of the product model: recency, relationship
  strength, important dates, and task-linked context should feed Today and daily
  reports.
- Memories are hidden atomic claims linked to visible records and cited through
  evidence references.
- Provenance lives directly on documents, interactions, memories, tasks, and evidence
  links.

Schema guardrails:

- Do not reintroduce a user-facing ingestion bucket or table for raw material.
- Do not use a generic graph node table as the primary model. Prefer typed people,
  organizations, projects, tasks, documents, and interactions. The Graph surface should
  be derived from typed records and links, centered on the user's own person row.
- Do not add a separate automation log surface.
- Do not add row-level sensitivity labels for launch. Settings can own model keys,
  export, backup, diagnostics, and future privacy-adjacent configuration.

Documentation style:

- Keep plans decision-oriented and compact.
- Use ASCII diagrams where they clarify schema or UI.
- Prefer durable product language over implementation names unless the doc is a
  technical plan.

Implementation conventions:

- Use Tauri 2 for the desktop shell. Do not introduce Electron.
- Keep AI provider calls BYOK and direct to user-approved providers. Do not add a
  hosted Local Brain model proxy for MVP.
- Store model keys, credentials, and integration secrets in the OS keychain, not in
  SQLite, markdown, Git, logs, or local config files.
- Keep the CLI provider-neutral. It should expose typed Local Brain operations and
  generic source/external identity fields, but it should not know about `gws`, Gmail,
  Granola, Google Contacts, Apple Contacts, or any other upstream connector API. Codex
  or the user's import agent owns fetching, provider-specific filtering, pagination,
  transcript retrieval, credential handling, and translating source records into
  generic `brain` CLI calls.
- Keep the UI keyboard-friendly, sparse, and oriented around browsing, correction,
  inspection, Ask, and demonstration. Do not add surfaces that compete with the
  agent-operated workflow.
- For desktop IPC, define Tauri commands in the native layer, register them in the
  invoke handler, call them from the frontend through Tauri's `invoke`, and grant
  plugin permissions through Tauri capabilities.
- Use TypeScript strictly: no `any` or `as any`, prefer small testable modules, use
  kebab-case for files and directories, and keep shared public APIs clear.
- Use Zod at external and JSON boundaries. Normalize database/native snake_case to
  frontend camelCase once in a bridge layer.
- For UI work, follow the Local Brain design docs and Reflect Open's component
  patterns. Check existing shadcn/ui primitives before building custom interactive
  controls, overlays, dialogs, menus, popovers, or tooltips. If shadcn/ui already
  covers the needed primitive, install or generate it into the app's `components/ui`
  directory and use it instead of hand-rolling the control. Use Lucide icons where
  appropriate.
- For React, use named exports, one component per file by default, providers plus
  small hooks for shared state, and never call hooks conditionally.
- Before declaring implementation work done, run the focused checks that match the
  change: TypeScript typecheck/lint for frontend logic, targeted Vitest tests for
  TypeScript behavior, and targeted Rust tests for native, CLI, migration, or database
  behavior.
