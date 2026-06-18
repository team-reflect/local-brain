# Reflect Graph Picker → Local Brain "Brain" Picker

Port Reflect Next / Reflect Open's top-level **graph** picker/switcher capability into
Local Brain, choosing deliberate, non-ambiguous terminology.

## Terminology decision (the central product call)

In Reflect, a **graph** is the top-level user workspace/brain/container. In Local Brain,
**Graph** already means the Network graph *visualization*. Reusing "graph" for the
container would be ambiguous.

Decision: the top-level container is a **Brain**.

- The product is literally *Local Brain*, so "your brains", "switch brain", "new brain"
  read naturally and need no glossary.
- **Graph** stays reserved exclusively for the Network graph visualization (the
  `network` surface's `graph` tab). Nothing about that surface changes.
- A **Brain** is one self-contained local SQLite database file on disk. Multiple brains
  = multiple `.sqlite` files. This matches Local Brain's "SQLite is the durable source of
  truth" model and Reflect Open's "graph = a user-chosen folder" boundary, adapted to
  Local Brain's single-file store.

Mapping from the references:

| Reflect concept            | Local Brain port                              |
| -------------------------- | --------------------------------------------- |
| graph (top-level)          | **brain** (top-level)                         |
| graph root (folder)        | brain path (a `.sqlite` file)                 |
| `RecentGraph`              | brain registry entry                          |
| `GraphColor` (9 ids)       | `BrainColor` (same 9 ids)                     |
| `GraphSwatch`              | `BrainSwatch`                                  |
| graph switcher footer      | **brain switcher** (sidebar, top brand slot)  |
| graph chooser screen       | **brain chooser** (no-active-brain fallback)  |
| Preferences → Graphs       | **Settings → Brain**                          |
| `graph map` (viz)          | unchanged — Local Brain's Network → Graph tab |

## Architecture

### Durable data model — brain registry (Rust-owned, outside any brain)

A brain's own `settings` table lives *inside* that brain, so it cannot hold the
cross-brain catalogue (the switcher must render brains that aren't open). Following
Reflect Open (recents in OS app-config, not in a graph), Local Brain adds a **brain
registry** JSON file owned by Rust at `<data_dir>/local-brain/brains.json`:

```jsonc
{
  "version": 1,
  "activePath": "/abs/.../brain.sqlite",
  "brains": [
    { "path": "...", "name": "My brain", "color": "indigo",
      "createdMs": 0, "lastOpenedMs": 0 }
  ]
}
```

- Rust owns it: atomic write (temp file + rename), path canonicalisation, traversal
  guards, OS-native semantics — consistent with the file-safety conventions.
- Name + color are catalogue metadata so the switcher can render any known brain.
- On startup: load registry; if empty, seed it from the existing `resolve_db_path()`
  default as "My brain" (backward compatible — today's single brain just works).

### Runtime switching (real, not relaunch)

`DbState` already holds `Mutex<Connection>`. Add the active path and a `swap()` that
locks, `open_and_migrate`s the new path, and replaces the connection. A failed open
leaves the current brain intact. The frontend remounts the shell keyed by the active
brain path and invalidates the TanStack Query cache, so all reads hit the new brain.

### Layers

- **crates/brain-schema**: unchanged open/migrate helpers (reused for every brain).
- **apps/desktop/src-tauri/src/brains.rs**: registry + `BrainInfo` + commands
  `list_brains`, `active_brain`, `open_brain`, `create_brain`, `rename_brain`,
  `set_brain_color`, `forget_brain`, `reveal_brain` (best-effort, via opener). Update
  `database_path` to report the active path. `DbState` gains `swap()`.
- **packages/core/src/domains/brains/**: zod `brainColorSchema`, `brainInfoSchema`,
  typed IPC bindings, index exports.
- **apps/desktop/src/lib/brain-colors.ts**: 9-color CSS map + options (indigo = accent).
- **apps/desktop/src/components/brain-swatch.tsx**: presentational color square.
- **apps/desktop/src/lib/queries/brains.ts**: TanStack hooks; switch invalidates cache.
- **apps/desktop/src/components/brain-switcher.tsx**: sidebar brand-slot button + custom
  accessible dropdown (switch brain, new brain, open another, reveal, brain settings).
- **apps/desktop/src/components/brain-dialog.tsx**: small path-input dialog for
  create/open (no native picker dependency yet — see deferred).
- **apps/desktop/src/components/brain-chooser.tsx**: no-active-brain fallback screen.
- **app-shell.tsx**: brain switcher in the top brand slot; `brain.*` commands.
- **App.tsx**: gate on active brain; remount keyed by brain path.
- **surfaces/settings.tsx**: new **Brain** section (identity, color, rename, list,
  switch, forget, create/open); Diagnostics + Local database reference the active brain.

## Acceptance criteria

1. Brain picker: list/select current brain, create/open/switch, visible sidebar
   affordance, keyboard-accessible dropdown + palette commands.
2. Settings/diagnostics for top-level brain identity/location/state.
3. Durable multi-brain storage model (registry) with real runtime switching; native
   OS file picker deferred and documented (path-input used meanwhile — fully functional).
4. Terminology aligned: **Brain** (container) vs **Graph** (network viz) across UI/docs.
5. Tests: Rust registry/switch, core schemas/bindings, switcher + settings DOM, colors,
   commands.
6. Docs: this plan, status, final-report, plus design-system / ui-direction /
   architecture-conventions / README terminology updates.

## Risks & caveats

- Connection swap mid-query: the mutex serialises; remount + cache invalidation refetch
  against the new brain. Low risk.
- No native file/folder picker dependency yet → path-input dialog (real, validated by
  Rust). Native picker is a documented follow-up.
- `reveal_brain` uses the opener plugin from Rust; best-effort and isolated so it can be
  dropped if the API differs.
- Cannot launch the full Tauri app in this environment; verification is `pnpm check`,
  desktop build, vitest (incl. jsdom DOM tests), `cargo fmt/check/test`.

## Verification

`git diff --check` · `pnpm check` · `pnpm --filter @local-brain/desktop build` ·
`cargo fmt --all -- --check` · `cargo check --workspace` · `cargo test --workspace`.
