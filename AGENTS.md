# Agent Notes

## Dev lifecycle

1. Before starting work, read `docs/README.md`. For comparable desktop, CLI, database,
   search, AI, or UI behavior, inspect `/Users/alex/repos/reflect-open` — especially
   `docs/plans/libraries.md` and the relevant app files — and reuse its patterns unless
   Local Brain has a product-specific reason to diverge.
2. Create a plan first, then get signoff before proceeding.
3. Make your changes. Keep product docs, schema docs, and numbered plans aligned when
   you touch durable product or schema behavior.
4. Run focused checks for what you changed:
   - TypeScript: `pnpm typecheck`, `pnpm lint` (or `pnpm lint:fix`)
   - Vitest: `pnpm test --run path/to/test`
   - Rust: `cargo test -p brain-cli`, `cargo test -p brain-schema`, or other relevant
     crate targets — do not run the full workspace test suite by default
5. Before declaring work done, run `pnpm check` (typecheck + lint + test). For native,
   CLI, migration, or database changes, also run the relevant `cargo fmt`, `cargo
   clippy`, and `cargo test` targets.
6. Before any `cargo` build/check/test that compiles the desktop crate, stage the CLI
   sidecar once per checkout:

   ```bash
   pnpm --filter @local-brain/desktop sidecar
   ```

   `pnpm tauri dev` and `pnpm tauri build` stage it automatically.

Common commands (repo root):

```bash
pnpm dev              # turbo dev across packages
pnpm tauri dev        # full desktop app with hot reload
pnpm check            # typecheck + lint + test
pnpm --filter @local-brain/desktop sidecar
```

Local Brain is an agent-operated local-first personal CRM and memory app. The repo is
a Tauri monorepo on Reflect Open's desktop technology base: a `brain` CLI and skills
for agent writes/reads, a desktop UI for browsing and correction, and SQLite as the
durable source of truth.

Current product shape:

- Agent-operated local brain with a private desktop UI for browsing and correction.
- SQLite owns durable data. 
- Most writes should come from AI agents through the CLI/skill contract, for example a
  Codex daily automation that ingests context, updates tasks, and records memories.
- Most reads should also be agent-driven, for example daily reports, todo lists, and
  briefings generated from the CLI or database access.
- Main user surfaces are Today, Tasks, Network, Projects, Graph, Ask, and Settings.
- Network contains People and Organizations.
- Documents and Interactions are first-class records, but they are browsed inside
  person, organization, project, and task detail pages, and through search or Ask.
- The UI is still important, but mainly for quick browsing, correction, inspection,
  and demonstrating the power of the user's local brain.
- Relationship intelligence is part of the product model: recency, relationship
  strength, important dates, and task-linked context should feed Today and daily
  reports.
- Provenance lives directly on documents, interactions, memories, tasks, and evidence
  links.

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
- Ask uses the Vercel AI SDK from the desktop webview. Provider keys stay in the
  OS keychain at rest, but are fetched into webview memory for the duration of a
  user-approved Ask request.
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
- For UI work, follow [`docs/design-system.md`](docs/design-system.md) and Reflect
  Open's component patterns. Check existing shadcn/ui primitives before building custom interactive
  controls, overlays, dialogs, menus, popovers, or tooltips. If shadcn/ui already
  covers the needed primitive, install or generate it into the app's `components/ui`
  directory and use it instead of hand-rolling the control. Use Lucide icons where
  appropriate.
- For React, use named exports, one component per file by default, providers plus
  small hooks for shared state, and never call hooks conditionally.
