# Libraries

This document records intended dependency choices for the implementation plans. Prefer
Reflect Open's proven stack unless Local Brain has a product-specific reason to diverge.
Before finalizing implementation dependencies, compare against
`/Users/alex/repos/reflect-open/docs/plans/libraries.md`.

## Desktop and Frontend

- **Tauri 2:** desktop shell and native bridge. Chosen instead of Electron for lower
  overhead and stronger native integration.
- **React 19:** app UI, matching Reflect Open unless a compatibility issue appears.
- **TypeScript:** frontend and product logic.
- **Vite with `@vitejs/plugin-react`:** frontend build tooling through Tauri.
- **Tailwind CSS v4 with `@tailwindcss/vite`:** utility layer and layout helpers.
- **shadcn/ui:** generated UI primitives for buttons, inputs, dialogs, popovers,
  command palette, tabs, badges, sheets, cards, and tables.
- **Radix:** behavior layer used through shadcn components.
- **Lucide React:** icons.
- **Zod:** runtime validation at external boundaries and JSON parsing.
- **Kysely:** typed SQL query construction from TypeScript.
- **@tanstack/react-query:** IPC/server-state cache, invalidation, and async data
  coordination.
- **@tanstack/react-virtual:** dense/large table virtualization.
- **cmdk:** command palette via shadcn Command.
- **react-hook-form:** forms where validation and controlled state become nontrivial.
- **date-fns:** UI date formatting and local date helpers.
- **ulidx:** stable sortable client-side IDs when needed.

Theme shadcn through CSS variables and app-level component classes in `globals.css`.
See [Design System](../design-system.md).

## Rust and Native Layer

- **rusqlite:** SQLite access from Rust.
- **bundled SQLite with FTS5:** lexical search support without relying on system SQLite.
- **sqlite-vec:** local vector search, following Reflect Open if packaging remains
  reliable.
- **fastembed:** local embeddings, with packaging/notarization caveats inherited from
  Reflect Open.
- **keyring:** OS keychain access for provider secrets.
- **serde/serde_json:** IPC and CLI JSON.
- **clap:** CLI command parsing.
- **jiff:** CLI local date/time handling for Today and daily reports.
- **blake3:** content hashing for imported documents/interactions and duplicate
  detection.
- **tempfile:** safe temporary files for tests and import operations.
- **trash:** OS trash integration for user-facing destructive file operations.
- **ulid:** Rust-side sortable IDs when generated outside SQLite.
- **notify / notify-debouncer-full:** optional folder watching if folder import becomes
  live rather than one-shot.

## Search and AI

- **FTS5:** first lexical search path.
- **Local embeddings runtime:** follow Reflect Open's Rust-side embedding direction when
  possible.
- **Vercel AI SDK:** BYOK provider calls and streaming from the desktop Chat
  surface (`ai`, `@ai-sdk/react`, `@ai-sdk/openai`, `@ai-sdk/anthropic`,
  `@ai-sdk/google`). Do not add a hosted Local Brain model proxy for MVP.

## Tooling

- **pnpm:** package manager.
- **Turborepo:** workspace task orchestration.
- **Cargo workspace:** Rust crate orchestration.
- **Vitest:** TypeScript unit tests.
- **@testing-library/react + jsdom:** React component tests.
- **Rust tests:** migration, CLI, and native behavior tests.
- **Tauri updater/window-state plugins:** follow Reflect Open for packaging once launch
  reaches auto-update/window persistence.

## Deferred

- Hosted sync dependencies.
- Browser extension tooling.
- Calendar/email OAuth libraries.
- Markdown editor dependencies such as meowdown/ProseKit unless Local Brain adds rich
  first-party note editing.
- Mobile-specific packaging.
- Generic plugin marketplace tooling.
