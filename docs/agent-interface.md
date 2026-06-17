# Agent Interface

Local Brain should be useful even when the user never opens the app. Local agents should
be able to ingest, query, and cite the user's local memory through stable commands.

The app should not ask every agent to understand the raw SQLite schema. Instead, ship a
small CLI and local skills.

## CLI Shape

Working command name: `brain`.

```bash
brain status
brain ingest ./meeting-notes.md
brain ingest-folder ~/Documents/Transcripts
brain remember "Alex prefers concise investor updates"
brain search "what did I promise Sarah?"
brain ask "what projects are blocked?"
brain today
brain entity "Sarah Chen"
brain task add "Follow up with Sarah about the deck"
brain export --format json
```

## Skill Shape

Install skills for local agents such as Codex, Claude Code, and Cursor.

The skill should teach agents:

- Search Local Brain before answering questions that depend on user context.
- Use `brain remember` only when the user asks to remember something or when a workflow
  clearly creates durable facts.
- Use `brain ingest` for files, transcripts, meeting notes, and summaries.
- Prefer cited answers.
- Respect privacy fields.
- Avoid writing raw SQL unless the user explicitly asks.
- Leave uncertain extractions in the review inbox instead of silently confirming them.

## Agent Write Policy

Agent writes should be visible and reversible.

Every write should record:

- agent name,
- action,
- source,
- created records,
- confidence,
- whether the user reviewed it.

The default write path should create `suggested` memories or inbox items. Confirmed
memory should require either explicit user action or a high-confidence local rule.

## Agent Read Policy

Agents should retrieve through high-level commands:

```bash
brain search "query"
brain context --about "project name"
brain today --json
brain entity "person or project" --json
```

The CLI should return compact JSON with citations:

```json
{
  "answer": "You promised Sarah a revised deck by Friday.",
  "citations": [
    {
      "source_id": "src_...",
      "memory_id": "mem_...",
      "excerpt": "Alex: I'll send the revised deck by Friday."
    }
  ]
}
```

## Local API

The desktop app can expose an optional localhost API later, but the first stable agent
contract should be the CLI. CLI contracts are easier for local agents, shell scripts, and
skills to discover.

## Privacy

The CLI should expose privacy-aware modes:

```bash
brain search "query" --local-only
brain ask "query" --cloud-ok
brain ask "query" --never-external
```

Default behavior should be conservative. If a command might send retrieved context to a
cloud model, it should be explicit in either the command or user settings.

## Installation

The Tauri app should install:

- the `brain` CLI sidecar,
- local agent skills,
- shell PATH instructions if needed,
- a simple `brain doctor` diagnostic command.

The user should be able to see which agents have been configured.

## Minimal First Skill

The first Codex-oriented skill can be extremely small:

```text
Use Local Brain when the user asks about personal context, prior decisions, people,
projects, commitments, preferences, or asks you to remember something.

Before answering, run:
  brain search "<query>" --json

When the user asks you to remember something, run:
  brain remember "<memory>" --source agent --json

Never send `never_external` context to cloud tools.
Prefer answers with citations.
```

That is enough to prove whether agents can become the product's daily acquisition loop.
