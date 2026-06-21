# Local Brain — Launch Guide

Local Brain is a private, local-first personal CRM and knowledge base. Each brain
lives in a folder on your machine, with SQLite plus assets stored side by side;
nothing is uploaded. The desktop app is for browsing and correction; the `brain`
CLI + agent skill are the primary way local agents read and write your brain.

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

### Installing the `brain` command and agent skill

From the app, open **Settings → CLI & agents** and install the command and the
agent skills. The app symlinks the bundled sidecar to `~/.local/bin/brain`,
installs the managed skills at `~/.agents/skills/brain` and
`~/.agents/skills/brain-backfill`, and writes the known brain list to
`~/.agents/skills/brain/brains.json`; it never needs sudo and does not edit
shell profile files. If `~/.local/bin` is not already on your `PATH`, add this
line to your shell profile:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

For source/development checkouts, install directly from Cargo instead:

```bash
cargo install --path apps/cli --locked
```

If you need to install the skills manually, copy `skills/brain` to
`~/.agents/skills/brain` and `skills/brain-backfill` to
`~/.agents/skills/brain-backfill`. The app-generated `brains.json` is optional
but lets local agents pick the active brain without asking.

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
CLI does not guess a default brain root; it resolves storage as:

1. `--db <path>` (advanced exact-file override)
2. `--brain <dir>`
3. `$BRAIN_ROOT`
4. `$BRAIN_DB` (advanced exact-file override)

For automations, prefer setting `BRAIN_ROOT` to the chosen brain folder.

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

## Using it with a local agent

The agent contract is the `brain` CLI plus the agent skills installed from
[`skills/brain`](../../skills/brain) and
[`skills/brain-backfill`](../../skills/brain-backfill). The main skill teaches
the nouns, query-before-write, the stdout/stderr contract, and daily-automation
recipes; the backfill skill guides first-run and large historical imports. Core
commands:

```bash
brain search "northwind" --json
brain today --json
brain report daily --json
brain tasks plan-day --json
brain graph --center self --json
brain doctor --json     # health: database and schema
```

After installing the command, verify the agent path with `brain doctor --json`.

For question answering, the desktop **Chat** surface uses the Vercel AI SDK with the
configured BYOK provider and persists chat history in SQLite. Chat can perform
core CRM writes only after the user approves the specific tool call. Agents using
the CLI combine `brain search`, `brain show`, and report commands, then reason
over the returned records themselves; the CLI does not call an LLM or synthesize
answers.

## Model boundaries (BYOK)

Local Brain bundles no model. Model-backed extraction calls **your own** AI provider
key:

- The desktop stores the key in the **macOS keychain** (Settings → AI providers) —
  never in app settings or the export.
- Chat fetches the selected key into webview memory only for the duration of a
  user-approved request.
- With no key, extraction is a no-op. Lexical (FTS5) search always works.

External model payloads are minimal and visible: only the source text needed for
extraction is sent through the provider boundary.

## Troubleshooting

- **"no brain selected" (CLI exit 4):** no brain target was provided. Pass
  `--brain <dir>`, set `BRAIN_ROOT`, or use the advanced `--db` / `BRAIN_DB`
  override.
- **"no brain database" (CLI exit 4):** a target was provided, but no database
  exists there. Run `brain add …` with `--brain <dir>` or open the app and choose
  that folder.
- **Gatekeeper blocks the app:** unsigned alpha build; right-click → Open.
- **Search finds nothing after a bulk delete:** derived indexes rebuild
  automatically after deletes; if needed, the maintenance rebuild runs on next
  ingest.
- **General health:** `brain doctor --json`.
