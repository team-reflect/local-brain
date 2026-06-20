# Local Brain — Launch Guide

Local Brain is a private, local-first personal CRM and knowledge base. Each brain
lives in a folder on your machine, with SQLite plus assets stored side by side;
nothing is uploaded. The desktop app is for browsing and correction; the `brain`
CLI + agent skill are the primary way agents (e.g. Codex) read and write your
brain.

> Audience: agent-native technical users. Launch target: **macOS desktop**.

## Install

### From a build

1. Build the app (see [Building](#building-from-source)) or open the produced
   `Local Brain.app`.
2. On first launch, macOS Gatekeeper may warn that the app is from an
   unidentified developer (alpha builds are **unsigned** — see
   [checklist.md](checklist.md) for the signing plan). Right-click → Open, or
   `xattr -dr com.apple.quarantine "Local Brain.app"`.
3. On first launch, choose the folder that should hold this brain. The app
   creates `brain.sqlite`, `assets/`, and `.local-brain/` inside that folder.

### Building from source

```bash
pnpm install
pnpm --filter @local-brain/desktop tauri build
```

This stages the `brain` CLI sidecar (`pnpm sidecar`), builds the frontend, and
compiles the macOS app. The runnable bundle is
`target/release/bundle/macos/Local Brain.app`, with the `brain` sidecar embedded
at `Contents/MacOS/brain`. (DMG packaging needs a GUI session; see
[checklist.md](checklist.md).)

## Local storage

Each **brain** is one root folder — your top-level workspace:

```text
Personal Brain/
  brain.sqlite
  brain.sqlite-wal
  brain.sqlite-shm
  assets/
  .local-brain/
```

The desktop app opens `$BRAIN_ROOT` when set, otherwise the last brain you opened
from its registry. If neither exists, it shows the folder chooser. The `brain`
CLI resolves storage as:

1. `--db <path>` (advanced exact-file override)
2. `--brain <dir>`
3. `$BRAIN_DB` (advanced exact-file override)
4. `$BRAIN_ROOT`
5. the legacy platform data path for diagnostics/dev workflows

The active brain folder is shown in **Settings → Brain**.
Migrations run automatically when a brain is opened and the schema is versioned.

## Importing your first record

In the app: press the **Add** button (or ⌘K → "Create document/interaction"),
then paste text or point at a file/folder path. A meeting/call/note becomes an
**interaction**; reference material becomes a **document**. Both are chunked for
search and dedupe by content hash.

From the CLI:

```bash
brain add interaction --kind meeting --title "Kickoff" --text-file ./notes.md --json
brain add document --title "Pricing model" --text "..." --json
```

## Using it with Codex (or another agent)

The agent contract is the `brain` CLI plus the skill at
[`skills/brain/SKILL.md`](../../skills/brain/SKILL.md). Point your agent at the
skill; it teaches the nouns, query-before-write, the stdout/stderr contract, and
daily-automation recipes. Core commands:

```bash
brain search "northwind" --json
brain today --json
brain report daily --json
brain tasks plan-day --json
brain graph --center self --json
brain doctor --json     # health: database and schema
```

For question answering, the desktop **Ask** surface uses the Vercel AI SDK with the
configured BYOK provider and persists chat history in SQLite. Agents using the CLI
combine `brain search`, `brain show`, and report commands, then reason over the
returned records themselves; the CLI does not call an LLM or synthesize answers.

## Model boundaries (BYOK)

Local Brain bundles no model. Model-backed extraction calls **your own** AI provider
key:

- The desktop stores the key in the **macOS keychain** (Settings → AI providers) —
  never in app settings or the export.
- Ask fetches the selected key into webview memory only for the duration of a
  user-approved request.
- With no key, extraction is a no-op. Lexical (FTS5) search always works.

External model payloads are minimal and visible: only the source text needed for
extraction is sent through the provider boundary.

## Troubleshooting

- **"no brain database" (CLI exit 4):** no database at the resolved path. Run an
  `brain add …` with `--brain <dir>`, open the app and choose a folder, or pass
  the advanced `--db` override.
- **Gatekeeper blocks the app:** unsigned alpha build; right-click → Open.
- **Search finds nothing after a bulk delete:** derived indexes rebuild
  automatically after deletes; if needed, the maintenance rebuild runs on next
  ingest.
- **General health:** `brain doctor --json`.
