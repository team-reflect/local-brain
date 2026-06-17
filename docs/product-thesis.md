# Product Thesis

Local Brain is a consumer memory app for people and their local AI agents.

It should help a user answer questions about their work and personal life:

- What did I promise someone?
- What decisions did I make last week?
- What projects are stuck?
- Who should I follow up with today?
- What do I know about this person, company, trip, doctor, school, house, product, or idea?
- What have I repeatedly said I care about?
- What private context should my local agents know before helping me?

## Positioning

Local Brain is not a generic database editor, a traditional CRM, or another notes app.
It is:

> A local-first personal database that turns sources into trustworthy memory.

The product should hide the database by default and expose it only as an advanced
inspection surface. The main UI is a Picardo-inspired local data tool: grouped sidebar,
thin command topbar, dense lists, rich detail pages, graph/search surfaces, and clear
correction controls.

## Mental Model

Everything starts as a source.

```text
source
  -> chunks
  -> extracted memories
  -> linked entities, tasks, events, and relationships
  -> trusted context with provenance
  -> answers with citations
```

The system should keep evidence separate from belief:

- **Sources** are raw evidence: files, transcripts, emails, notes, webpages, chats,
  calendar events, audio, screenshots, manual entries.
- **Memories** are extracted beliefs: facts, decisions, preferences, commitments,
  summaries, risks, ideas, reminders.
- **Entities** are the nouns that memories attach to: people, organizations, projects,
  places, topics, products, accounts, files.
- **Tasks and events** are day-to-day operational objects derived from sources and
  memories.

The product becomes trustworthy when every memory can answer: where did this come from?

## Principles

### Local by Default

The user's data lives on their machine. The app should not require a hosted account,
cloud database, or vendor-owned memory API.

### SQLite as the Durable Store

Unlike Reflect Open, SQLite is not just a rebuildable projection over markdown files.
SQLite is the source of truth for structured memory.

Raw imported files may stay on disk for portability and auditability, but the canonical
product data model is SQLite.

### Human UI, Agent Contract

The UI should be friendly enough for a person to use every day. The CLI and local agent
skills should be stable enough that Codex, Claude Code, Cursor, and scripts can read and
write memories without learning the whole schema.

### Provenance Before Cleverness

The app should prefer a cited, modest answer over a magical answer with no audit trail.
Memories should preserve source links, excerpts, timestamps, creator, and confidence.

### Make Correction Easy

The app should trust AI extraction enough to write useful memory directly. The safety
mechanism is provenance, confidence, audit history, easy correction, and easy deletion.

### Simple First Screen

The first screen should not be a database browser or a chat landing page. It should feel
like a calm operating dashboard and answer:

- What needs my attention?
- What did the system learn?
- What can I ask?
- What should I follow up on?

### Dense Personal Data Tool

Local Brain should look more like Picardo Internal UI than a lightweight consumer notes
app. Borrow the grouped sidebar, compact topbar, table/list density, detail aside,
badges, command palette, and graph/search posture. Translate corporate CRM language into
personal-memory language.

## Non-Goals for the First Version

- Team collaboration.
- Hosted sync service.
- Generic Postgres/TablePlus competitor.
- Email/calendar/browser integrations before the core loop works.
- A broad plugin marketplace.
- A full task manager replacement.
- A perfect ontology for all human life.

## Relationship to Existing Projects

### Reflect Open

Reflect Open is the closest technology base: Tauri desktop shell, React UI, Rust native
capabilities, local SQLite, FTS5, local embeddings, BYOK AI, OS keychain secrets, and an
open-source local-first posture.

The product difference is that Reflect is markdown-first personal writing. Local Brain
is SQLite-first structured memory.

### Company Brain

Company Brain provides the durable ideas around people, organizations, interactions,
tasks, extracted facts, provenance, and embeddings.

The product difference is that Company Brain is organizational and CRM-shaped. Local
Brain is personal and life-shaped.

### Picardo Internal UI

The internal UI proves that structured memory benefits from a readable browser. Local
Brain should inherit the inspection idea, but the default UI should be simpler and more
personal.
