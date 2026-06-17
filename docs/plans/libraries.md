# Libraries

This document records intended dependency choices for the implementation plans. Prefer
Reflect Open's proven stack unless Local Brain has a product-specific reason to diverge.

## Desktop and Frontend

- **Tauri 2:** desktop shell and native bridge. Chosen instead of Electron for lower
  overhead and stronger native integration.
- **React:** app UI.
- **TypeScript:** frontend and product logic.
- **Vite:** frontend build tooling through Tauri.
- **Tailwind/Radix/shadcn-style primitives:** practical UI foundation consistent with
  Reflect Open's direction.
- **Lucide React:** icons.
- **Zod:** runtime validation at external boundaries and JSON parsing.
- **Kysely:** typed SQL query construction from TypeScript.

## Rust and Native Layer

- **rusqlite:** SQLite access from Rust.
- **bundled SQLite with FTS5:** lexical search support without relying on system SQLite.
- **sqlite-vec or equivalent:** local vector search when packaging is reliable.
- **keyring/keychain-compatible crate:** OS keychain access for provider secrets.
- **serde/serde_json:** IPC and CLI JSON.
- **clap:** CLI command parsing.

## Search and AI

- **FTS5:** first lexical search path.
- **Local embeddings runtime:** follow Reflect Open's Rust-side embedding direction when
  possible.
- **BYOK model adapters:** direct calls to user-approved providers. Do not add a hosted
  Local Brain model proxy for MVP.

## Tooling

- **pnpm:** package manager.
- **Turborepo:** workspace task orchestration.
- **Cargo workspace:** Rust crate orchestration.
- **Vitest or equivalent:** TypeScript unit tests.
- **Rust tests:** migration, CLI, and native behavior tests.

## Deferred

- Hosted sync dependencies.
- Browser extension tooling.
- Calendar/email OAuth libraries.
- Mobile-specific packaging.
- Generic plugin marketplace tooling.
