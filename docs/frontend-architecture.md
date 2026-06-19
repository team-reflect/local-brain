# Desktop Frontend Architecture

Orientation for the React/TypeScript app in `apps/desktop/src`. For visual tokens
and components see [design-system.md](design-system.md); for product surfaces see
[ui-direction.md](ui-direction.md). For cross-cutting rules see the repo
[`AGENTS.md`](../AGENTS.md).

## Layering

```text
main.tsx → App.tsx
  └─ App: resolves the active brain, then mounts the workspace keyed by brain path
       └─ RouterProvider → AppShell
            ├─ sidebar nav + BrainSwitcher + Settings
            ├─ topbar search trigger → CommandPalette
            └─ <main> RouteContent → one surface per route
```

- **`App.tsx`** gates on the active brain. It deliberately keys `BrainWorkspace`
  on `active.data.rootPath` so switching brains starts a fresh router history and
  clean query state, and it gates on the *data* (not `isError`) so a transient IPC
  failure during a background refetch never drops the user back to the chooser.
- **Routing (`routing/`)** is an in-memory history stack mirrored to the URL
  (Reflect Open's pattern). `route.ts` owns the typed `Route` discriminated union
  and all serialization; `router.tsx` owns the stack/cursor and `popstate` sync.
  Adding a surface = add a `Route` variant, handle it in `routeToPath` /
  `routeFromPath` / `sectionForRoute`, and add a `case` in `route-content.tsx`.
  TypeScript's exhaustiveness checking enforces every switch is updated.
- **`route-content.tsx`** is the single place routes become surfaces — keep it a
  pure switch with no logic.

## Data: the bridge → queries → surfaces pipeline

1. **Bridge (`lib/ipc/tauri-bridge.ts`, `lib/db.ts`).** All native IPC goes through
   Tauri's `invoke`. snake_case from SQLite/Rust is normalized to camelCase here so
   the rest of the app speaks one casing. Zod validates at this boundary.
2. **Domain logic (`@local-brain/core`).** Shared with the CLI. Surfaces call core
   functions (`listTasks`, `searchRecords`, `getModelStatus`, …) rather than issuing
   raw SQL.
3. **Query hooks (`lib/queries/*`).** TanStack Query wrappers — one module per
   concern (`brains`, `records`, `search`, `settings`, `embeddings`,
   `corrections`, `ingest`). Surfaces consume hooks (`useActiveBrain`,
   `useEmbeddingsStatus`, …); mutations invalidate the query keys they affect.
   Re-exported through `lib/queries/index.ts`.
4. **Surfaces (`surfaces/*`)** and **components (`components/*`)** render. Surfaces
   own a screen; components are reusable pieces.

Keep this direction one-way: components/surfaces never reach past the query hooks
to the bridge, and the bridge never imports React.

## Component conventions

- Named exports, kebab-case files, **one component per file by default**. When a
  surface grows several sections, give it a directory (see `surfaces/settings/`):
  one file per section, a `*-surface.tsx` shell, and a barrel `index.ts` exporting
  the public surface.
- Strict TypeScript: no `any` / `as any`. Prefer deriving prop types from data
  (`NonNullable<ReturnType<typeof useX>['data']>`) over restating shapes.
- Hooks discipline: never call hooks conditionally; gate on data after the hooks
  run. Watch for stale closures in effects, especially event listeners and async
  mutations that close over route or query state.

## Overlays and primitives

shadcn/ui-style wrappers over `radix-ui` live in `components/ui/`:
`dialog.tsx`, `popover.tsx`, `dropdown-menu.tsx`. **Reach for these before
hand-rolling overlays.** Radix gives focus trap, focus restore, scroll lock, and
Escape / outside-click dismissal for free — a hand-rolled scrim does not.

- **Modal forms / command menus** → `Dialog` (`add-ai-provider-dialog`,
  `brain-dialog`, `command-palette`). Controlled via `open` + `onOpenChange`; map
  `onOpenChange(false)` to your `onClose`. Provide a `DialogTitle` (wrap in
  `VisuallyHidden` if it should not show) so the dialog has an accessible name.
- **Anchored transient menus** → `Popover` (brain color picker).
- **Action menus** → `DropdownMenu` (brain switcher).

In-repo primitives (`components/button.tsx`, `badge.tsx`) and shared class strings
(`lib/ui.ts`: `controlClass`, `sectionLabel`, `metaText`, `keycapClass`) keep
variants consistent. Use `Button` rather than re-styling a raw `<button>` with
`bg-primary`; use `cn()` for conditional classes; theme through tokens in
`app/globals.css`, not per-component class forks.

## Commands and shortcuts

`lib/commands/` holds a small command registry (`registry.ts`, `types.ts`),
declarative app commands (`app-commands.ts`), key matching (`keys.ts`), and the
global keydown binding (`use-shortcuts.ts`). The command palette lists the same
registry. `modal-guard.ts` ref-counts open *blocking* modals so global shortcuts
(including ⌘K) stay suppressed while one owns the screen.

## Testing

Vitest + Testing Library DOM tests live next to the code as `*.dom.test.tsx`.
`test/utils.tsx` provides `renderWithProviders` (query + router context) and
`installFakeBridge` (an in-memory IPC bridge — `db_query` returns supplied rows,
optionally chosen per compiled SQL). Test behavior through the rendered DOM and
the bridge boundary, not implementation details. Cover any extracted or
behavior-bearing logic (routing, command filtering, dialog dismissal, status
formatting).

Pure logic (`routing/route.ts`, `surfaces/graph-layout.ts`,
`lib/embeddings-coordinator.ts`, `lib/commands/registry.ts`) has plain unit tests.

## Verification

Run from the repo root: `pnpm check` (typecheck + oxlint + vitest). Desktop-only:
`pnpm --filter @local-brain/desktop {typecheck,test,build}`. The Tauri build needs
the staged `brain` sidecar — run `pnpm --filter @local-brain/desktop sidecar`
first (see the desktop build notes).
