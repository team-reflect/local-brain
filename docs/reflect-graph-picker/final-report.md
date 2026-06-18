# Final report — Reflect graph picker → Local Brain brain picker

Ported Reflect Next / Reflect Open's top-level **graph** picker/switcher into
Local Brain, renamed to **Brain** so the word "Graph" stays reserved for the
Network visualization.

## What shipped

### Terminology (the central product call)

- Top-level container = **Brain** (one local SQLite database). Reflect's "graph".
- **Graph** is unchanged: the Network surface's user-centered visualization.
- Disambiguation documented in `docs/plans/architecture-conventions.md`
  (Product Nouns), `docs/ui-direction.md`, `docs/design-system.md`, and
  `docs/launch/README.md`.

### Durable multi-brain model (real, not fake)

- **Brain registry** — a Rust-owned JSON file at `<app data dir>/brains.json`
  (`apps/desktop/src-tauri/src/brains.rs`): each brain's `path`, `name`, `color`,
  `createdMs`, `lastOpenedMs`, plus the active brain. Atomic writes (temp +
  rename), canonical paths, resilient load (corrupt/missing → empty default).
- **Runtime switching** — `DbState` now bundles the connection with its active
  path and can `swap()` it in place (`apps/desktop/src-tauri/src/db/mod.rs`). A
  failed open leaves the current brain intact. Startup precedence: `$BRAIN_DB`
  (CLI parity / explicit pin) → last active brain (if its file exists) → default.
- **Commands**: `list_brains`, `active_brain`, `open_brain`, `create_brain`,
  `rename_brain`, `set_brain_color`, `forget_brain`, `reveal_brain`.
  `database_path` now reports the live active brain. `brain-schema` gained
  `app_data_dir()`.

### Core (`packages/core/src/domains/brains/`)

- `brainColorSchema` (9-color enum, lenient `.catch` to default), `brainInfoSchema`.
- Typed IPC bindings for every brain command; exported from the core index.

### Desktop UI

- **BrainSwitcher** (`components/brain-switcher.tsx`) in the sidebar brand slot:
  active brain swatch + name, opening a keyboard-navigable menu (arrow keys,
  Escape, click-outside) to switch brain, create/open another, reveal the file,
  or open brain settings.
- **BrainSwatch** + `lib/brain-colors.ts` (indigo = app accent; 8 fixed colors).
- **BrainDialog** — path-based create/open (validated by Rust).
- **BrainChooser** — no-active-brain fallback screen.
- **App gating** (`App.tsx`): resolves the active brain and remounts the shell
  keyed by its path; switch hooks invalidate the whole query cache so every
  surface refetches against the new brain.
- **Settings → Brain** section: identity (name rename, color picker, location +
  reveal, schema version, created/last-opened), the list of other brains
  (switch/forget), and create/open. Local database + Diagnostics now report the
  active brain. New `go.brain` command (`Mod-Shift-B`).

### Tests

- Rust: registry round-trip/persistence, rename/color, forget-keeps-active,
  corrupt-fallback, active-candidate precedence, and a `DbState::swap` test that
  proves queries hit the new brain. (`cargo test` — 16 lib tests.)
- Core: brain IPC binding arg/shape tests + lenient color parse.
- Desktop DOM: `BrainSwitcher` (shows active brain, switches, opens new-brain
  dialog) and `Settings → Brain` (identity, color picker, other-brains list). The
  shared fake bridge gained a non-db command responder.

## Verification (all green)

| Check | Result |
| --- | --- |
| `git diff --check` | clean |
| `pnpm check` (typecheck + lint + test) | pass — 14 desktop / 20 core / 1 db test files |
| `pnpm --filter @local-brain/desktop build` | pass (built `dist/`) |
| `pnpm --filter @local-brain/desktop sidecar` | built (required before Rust checks) |
| `cargo fmt --all -- --check` | clean |
| `cargo check --workspace` | pass |
| `cargo test --workspace` | pass (16 desktop-lib + schema/cli tests) |

## Caveats / deferred (honest scope)

- **No native OS file picker.** Local Brain doesn't bundle the Tauri dialog
  plugin, so create/open use an absolute-path input (fully functional — Rust
  validates the path). Wiring `@tauri-apps/plugin-dialog` for a native folder
  picker is a clean follow-up.
- **`reveal_brain`** uses the opener plugin from Rust (best-effort), isolated so
  it can be dropped if the API differs across platforms.
- **CLI is still single-brain** (`$BRAIN_DB`/default). Teaching the CLI to target
  a registry brain is a documented follow-up; the desktop registry is the
  multi-brain source of truth for now.
- **Demo seeding** runs per brain (existing `useEnsureSeed`), so a brand-new empty
  brain gets the same first-run demo data the default brain does.
- Could not launch the full Tauri app in this environment; verification relied on
  the build, vitest jsdom DOM tests, and the Rust test suite (incl. a real
  connection-swap test) rather than a manual click-through.

## Repo state

- Branch `codex/local-brain-reflect-graph-picker`, base `58c801f`.
- Commits: docs/plan → Rust registry+swap → desktop+core UI → docs terminology →
  this report.
- PR: see below.
