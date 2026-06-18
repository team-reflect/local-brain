# Local Brain — Launch Guide

Local Brain is a private, local-first personal CRM and knowledge base. Everything
lives in a single SQLite database on your machine; nothing is uploaded. The
desktop app is for browsing and correction; the `brain` CLI + agent skill are the
primary way agents (e.g. Codex) read and write your brain.

> Audience: agent-native technical users. Launch target: **macOS desktop**.

## Install

### From a build

1. Build the app (see [Building](#building-from-source)) or open the produced
   `Local Brain.app`.
2. On first launch, macOS Gatekeeper may warn that the app is from an
   unidentified developer (alpha builds are **unsigned** — see
   [checklist.md](checklist.md) for the signing plan). Right-click → Open, or
   `xattr -dr com.apple.quarantine "Local Brain.app"`.
3. The app creates its database on first run and shows a short welcome.

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

Local Brain keeps everything in one SQLite file. The path is resolved as:

1. `--db <path>` (CLI only)
2. `$BRAIN_DB`
3. the platform data directory: `~/Library/Application Support/local-brain/brain.sqlite`

The desktop app and the `brain` CLI resolve the **same** path, so the CLI works
whether or not the app is running. The path is shown in **Settings → Local
database** and **Settings → Diagnostics**. Migrations run automatically at
startup and the schema is versioned.

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
brain ask "what did we decide about pricing?" --json
brain today --json
brain report daily --json
brain tasks plan-day --json
brain relationships followups --json
brain graph --center self --json
brain doctor --json     # health: schema version, model, curl
```

`brain ask` always returns the cited evidence it retrieved; if a model is
configured (`ANTHROPIC_API_KEY`) it also synthesizes a cited answer. Either way,
the answer is grounded in your documents and interactions.

## Backup & export

In **Settings → Backup & export**:

- **Create backup** — a consistent, restorable copy of the SQLite database,
  written atomically and integrity-checked.
- **Export JSON** — a versioned, inspectable dump of your records.

Neither includes provider keys. To **restore**, replace the database file (path
in Settings → Local database) with a backup and reopen the app; derived search
indexes rebuild from the durable records. Keep backups out of cloud-synced
folders unless that folder has a tested SQLite locking story.

## Model boundaries (BYOK)

Local Brain bundles no model. Ask and model-backed extraction call **your own**
provider key:

- The desktop stores the key in the **macOS keychain** (Settings → Model keys) —
  never in app settings or the export.
- The CLI reads `ANTHROPIC_API_KEY` from the environment.
- A master **kill switch** (Settings → Model keys) disables all external calls.
- With no key, the AI surface degrades cleanly: Ask shows "not configured" and
  extraction is a no-op. Lexical (FTS5) search always works.

External model payloads are minimal and visible: only the retrieved, cited chunks
needed to answer are sent, assembled through one checked helper.

## Troubleshooting

- **"no brain database" (CLI exit 4):** no database at the resolved path. Run an
  `brain add …`, open the app once, or pass `--db`.
- **Ask says "not configured":** add a provider key (Settings → Model keys) or set
  `ANTHROPIC_API_KEY` for the CLI. Check the kill switch isn't off.
- **`brain ask` returns evidence but no prose:** no model configured — the cited
  chunks are returned for your agent to reason over.
- **Gatekeeper blocks the app:** unsigned alpha build; right-click → Open.
- **Search finds nothing after a bulk delete:** derived indexes rebuild
  automatically after deletes; if needed, the maintenance rebuild runs on next
  ingest. See Settings → Diagnostics for FTS status.
- **General health:** `brain doctor --json` or Settings → Diagnostics.
