# Agent Notes

This repo is the planning and future implementation home for **Local Brain**: a
consumer, local-first memory layer for a person and their AI agents.

Before doing work here, read:

- `docs/README.md`
- `docs/product-thesis.md`
- `docs/reflect-open-technology-base.md`
- `docs/launch-schema.md`
- `docs/agent-interface.md`
- `docs/mvp-plan.md`
- `docs/open-questions.md`

You may also reference nearby repos when useful:

- `/Users/alex/repos/reflect-open` for the intended technology base.
- `/Users/alex/repos/company-brain` for the structured memory/CRM lineage.
- `/Users/alex/repos/picardo-internal-ui` for an example structured-memory browser.

Do not copy large chunks blindly from those repos. Borrow patterns deliberately and
adapt them to this product.

## What Local Brain Is

Local Brain is a private, local memory substrate for a person and their local agents.
The product loop is:

```text
sources -> chunks -> memories -> entities/tasks/events -> cited answers
```

The app should help users ask questions across work and personal life while preserving
provenance, privacy, and local ownership.

## Product Principles

- **SQLite is the durable source of truth.** This is the main divergence from Reflect
  Open. Reflect stores durable knowledge in markdown and uses SQLite as a projection.
  Local Brain stores durable structured memory in SQLite.
- **Everything starts as a source.** Sources are evidence. Memories are extracted
  beliefs. Keep that distinction crisp.
- **Provenance before cleverness.** Every important memory should point back to a
  source, chunk, excerpt, agent, timestamp, and confidence where possible.
- **Human UI, agent contract.** The app should feel simple for people, while exposing a
  stable CLI/skill contract for local agents.
- **Do not lead with a database editor.** Advanced inspection can exist later, but the
  front door is Today, Ask/Search, Sources, and entity pages.
- **Privacy is a product surface.** Retrieval and AI calls must know whether context is
  local-only, cloud-allowed, sensitive, or never-external.
- **Local-first, no hosted core API.** Do not assume a hosted Local Brain service for
  memory, sync, AI, ingestion, or search.
- **BYOK and local models.** Generative AI should use user-approved providers or local
  models. Secrets belong in the OS keychain.
- **Tauri, not Electron.** The desktop shell should follow Reflect Open's Tauri/Rust
  direction.
- **Open-source quality.** Write as if the repo will be public and reviewed closely.

## Current Repo State

This repo currently contains docs only. Until code exists:

- Keep planning docs in `docs/`.
- Prefer small, focused markdown files over one giant planning document.
- Update `docs/README.md` when adding important docs.
- Keep terminology consistent with `docs/launch-schema.md`.
- Use ASCII unless there is a clear reason to do otherwise.

## Intended Architecture

Use Reflect Open as the technical base:

```text
apps/
  desktop/            Tauri app
  cli/                brain CLI sidecar
packages/
  core/               product logic, ingestion, retrieval, AI policy
  db/                 generated SQLite types and Kysely bridge
  skills/             local agent skill templates
crates/
  index-schema/       SQLite migrations and schema codegen input
docs/
```

Key architecture rules once implementation begins:

- SQLite runs in Rust through `rusqlite`, not in the WebView.
- The TypeScript frontend may use Kysely as a typed SQL builder over a Tauri IPC bridge.
- SQLite migrations are shared by the desktop writer and CLI reader.
- Generated DB types must not drift from migrations.
- Use FTS5 for lexical search.
- Use local embeddings/vector search when distribution is reliable; FTS5-first is
  acceptable before vectors are stable.
- Store API keys and provider credentials in the OS keychain, not SQLite, Git, or docs.
- Keep durable tables separate from derived/search/vector tables.
- Rebuild/repair operations may rebuild derived tables, but must not casually wipe
  durable memory.

## Schema Rules

The launch schema should stay compact and provenance-heavy.

Core durable tables:

- `sources`
- `source_chunks`
- `entities`
- `entity_aliases`
- `memories`
- `memory_entities`
- `relationships`
- `tasks`
- `events`
- `event_entities`
- `agent_events`
- `chat_conversations`
- `chat_messages`
- `settings`

Derived or rebuildable surfaces:

- FTS tables
- embedding vectors
- denormalized search views
- import/extraction queues where safe

Avoid adding typed profile tables such as `people`, `organizations`, or `projects` until
the generic `entities` model proves insufficient.

## Agent Interface Rules

Do not require local agents to understand raw SQL as the primary interface. The intended
contract is a CLI named `brain` plus local skills.

Expected first commands:

```bash
brain status
brain ingest ./source.txt
brain remember "memory"
brain search "query" --json
brain ask "query"
brain today --json
brain entity "name" --json
```

Agent writes should be audited in `agent_events`. The default behavior is direct writes
with provenance and confidence, plus obvious correction/delete paths for the user.

## Development Workflow

When code exists, use the Reflect Open workflow unless this repo defines a replacement:

- Use `pnpm` for TypeScript/React/Tauri frontend commands.
- Use Cargo for Rust crates.
- Run `pnpm check` before declaring broad TypeScript work done.
- Run targeted tests for changed logic.
- For desktop builds, expect sidecar staging similar to Reflect Open.

This repo is currently on `master`.

## TypeScript Conventions

Follow Reflect Open's conventions:

- Strict TypeScript.
- No `any` or `as any`.
- Use Zod for runtime parsing at external boundaries.
- Normalize casing at boundaries; TypeScript types are camelCase.
- Prefer interfaces for object shapes and discriminated unions for variants.
- Keep modules small and testable.
- Use Kysely types for database rows and query signatures.
- Keep public APIs documented.

## React/UI Conventions

When UI code exists:

- Use React + TypeScript with the Reflect-derived design approach.
- Prefer existing shadcn/Radix/Tailwind primitives before custom interactive widgets.
- Use Lucide icons where appropriate.
- Keep the default surface simple and operational: Today, Ask/Search, Sources, Entities.
- Do not make a landing page inside the app.
- Do not put a raw table browser in the main path.

## Rust/Tauri Conventions

When native code exists:

- Define Tauri commands in the Rust app crate and register them explicitly.
- Keep SQLite writes transactional.
- Keep migrations ordered and reviewable.
- Keep file, keychain, model, and sidecar capabilities in Rust.
- Treat IPC payloads as an external boundary and validate them.

## Privacy and Safety

- Never commit real user data, database files, API keys, access tokens, embeddings from
  private data, or generated local brain exports.
- Any context marked `never_external` must not be sent to cloud model providers.
- Any context marked `sensitive` needs explicit policy before cloud use.
- Answers should preserve citations and expose which context was used.
- Deleting a source must have a clear story for derived memories, chunks, and embeddings.

## Documentation Style

- Be decisive, but mark true open questions in `docs/open-questions.md`.
- Prefer concrete schema/API examples over vague product language.
- When referencing Reflect Open, name the exact pattern being borrowed and the Local
  Brain divergence.
- Keep docs short enough that future implementation agents will actually read them.
