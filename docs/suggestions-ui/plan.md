# Suggestions UI — plan (revised after review)

> **Status: implemented** in this PR — Phase 1 + Phase 2 via the in-core route below
> (no `brain-ops` crate). Core getter/setters + hooks + a Today section, all tested.

Surface the suggestions **curation queue** in the desktop app so a user can see open
project/organization proposals and accept or dismiss them — closing the loop the
importer opens, without dropping to the CLI.

> **Review note:** the first draft routed `accept` through a new shared `brain-ops` crate
> (extract the CLI's write logic, add native Tauri commands). A code check killed that:
> the desktop already has every primitive needed — `createProject` (core), the
> record→join-table map (`relations/setters.ts`), project-link inserts
> (`extraction/source-links.ts`), `normalizeName` (core), and `db_batch` which **executes
> a batch as a Rust transaction**. Extracting `brain-ops` would mean surgery on a
> 6,352-LOC `add/` tree for two buttons. So accept/dismiss are now composed **in core**
> from existing pieces — no new crate, no native command, no sidecar. (A `brain-ops`
> crate to single-source CLI↔core write logic is a reasonable *future* refactor if drift
> bites, but it should not gate this UI.)

## Current state

- **Exists**: `suggestions` + `suggestion_links` tables (migration `0011`) and Kysely
  types in `schema.gen.ts`; the CLI (`brain suggest list|accept|dismiss`); the agent
  surfaces open ones via `brain import-context`.
- **Missing on desktop**: any core getter/setter, IPC, or UI for suggestions (confirmed
  by grep). Purely additive — no schema/migration.

## Architecture (settled)

- **Reads** go through the read-only `db_query` Kysely bridge, like `listTasks`.
- **Writes** compose existing core setters and run the multi-table part through
  `batch()` (`packages/core/src/db/commands.ts` → Rust `db_batch`, one transaction) —
  satisfying the rule "multi-table writes run in Rust transactions." Product logic lives
  in `packages/core` per the architecture.

## Phase 1 — read-only Suggestions surface

1. **Core getter** — `packages/core/src/domains/suggestions/getters.ts`:
   `listOpenSuggestions()` → `suggestions` where `status='open'`, ordered by `createdAt`
   desc, **with each row's evidence links resolved to `{recordType, recordId, title}`**.
   Resolve titles by reusing the typed-record title lookups already in
   `relations/getters.ts` (it returns `{id, title, subtitle}` per linked record); don't
   defer titles — they're the point of the card. Export from `packages/core/src/index.ts`.
2. **Hook** — `apps/desktop/src/lib/queries/suggestions.ts`: `useOpenSuggestions()`
   (`queryKey: ['suggestions','open']`).
3. **Component** — `apps/desktop/src/components/suggestions-list.tsx`: a `Section`
   ("Suggestions") of cards — `kind` badge (project/org), `title`, `rationale`, and each
   evidence link as a clickable row → `navigate({kind: recordType, id: recordId})`
   (all six record types are valid `Route` targets). Reuse `Section`/`Badge`/`Button`.
4. **Placement** — a "Suggestions" section on **Today** (`surfaces/today.tsx`), below
   "Open tasks", with a count. **Render nothing when there are no open suggestions** —
   a perpetually-empty section is daily noise; do *not* show an EmptyState here (unlike
   the tasks section). Conditional render on `data.length > 0`.
5. **Tests** — getter test in a real-SQLite `*.test.mjs` (seed suggestions with raw
   `INSERT`s — there is no core creator for suggestions, the CLI owns creation); a
   `suggestions-list.dom.test.tsx` mirroring `corrections.dom.test.tsx`.

## Phase 2 — accept / dismiss, composed in core

1. **`dismissSuggestion(id)`** (`domains/suggestions/setters.ts`): one guarded
   `execute(db.updateTable('suggestions').set({status:'dismissed', resolvedAt}).where('id','=',id).where('status','=','open'))`.
   Affected-count `0` ⇒ already resolved → throw a typed "already resolved" error.
2. **`acceptSuggestion(id)`** (same file):
   - Read the suggestion + its links + status (`db_query`); reject if not `open`.
   - **Find-or-create the project case-insensitively**: load projects, match on
     `normalizeName(title)` (the core twin already used by dedupe); reuse the match or
     `createProject({ name: title, summary, status: 'active' })`.
   - `batch([` *(one Rust transaction)* `…relink statements, update suggestion]`:
     - relink each cited record to the project via a small `projectLinkStatement(projectId,
       link)` helper — `interaction→projectInteractions`, `document→projectDocuments`,
       `person→projectPeople`, `organization→projectOrganizations`,
       `task→tasks.project_id` update (mirror `insert_project_links`; reuse the existing
       insert pattern in `extraction/source-links.ts`);
     - `update suggestions set status='accepted', resolvedRecordType/Id, resolvedAt where
       id=? and status='open'` (the guard keeps a concurrent accept/dismiss from
       double-resolving).
   - When creating a new project, fold its INSERT into the batch so create+relink+resolve
     commit atomically.
3. **Export** the two from `core/index.ts`; add `useAcceptSuggestion()` /
   `useDismissSuggestion()` (mirror `useArchiveMemory`/`useUnlinkMemory`). On success
   **invalidate `['suggestions']` plus tasks/projects/Today queries** (accept creates a
   project and moves cited tasks into it).
4. **UI** — Accept (primary) / Dismiss (ghost) buttons per card (mirror
   `memory-list.tsx`); surface the "already resolved" error via the existing alert path.
5. **Tests** — a real-SQLite test of `acceptSuggestion` (project created/reused, links
   relinked, status flips, guard prevents double-accept) and `dismissSuggestion`; a dom
   test that the buttons fire the mutations and the list refetches.

## Decisions (revised)

- **Accept/dismiss**: composed in **core** (existing setters + `db_batch` Rust tx) — NOT
  a shared crate / native command / sidecar.
- **Placement**: a "Suggestions" section on Today, hidden when empty.

## Risks / honest trade-offs

- **Relink mapping duplication.** The record→join-table map now exists in both the CLI
  (Rust `insert_project_links`) and core. Mitigation: core *already* owns this mapping
  (`relations/setters.ts` unlink map, `source-links.ts` inserts) — we reuse it rather
  than inventing a second one — and a test pins parity. This bounded duplication is the
  price of not doing the `brain-ops` extraction; revisit the crate only if it spreads.
- **Project-dedup race.** Find-then-create-project isn't atomic (the case-insensitive
  match needs JS `normalizeName`, not SQL, so it can't sit inside the batch). For a
  deliberate Accept click this is acceptable; the relink+resolve themselves are atomic.
- **Live refresh.** A suggestion the CLI/agent writes while the app is open appears only
  on refetch (react-query focus refetch / navigation) — same as all desktop data; fine
  for v1.
- **Scope guard.** Keep it a review surface; don't grow it into an agent-activity feed
  (the `AGENTS.md` guardrail).

## Suggested build order

Phase 1 end-to-end (getter → hook → component → Today, with tests) and ship/verify; then
Phase 2 (`dismiss` first — trivial — then `accept`). Each phase is independently
shippable and low-risk.
