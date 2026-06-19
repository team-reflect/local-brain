# Product Thesis

Local Brain is an agent-operated local brain for a person's work and life. It gives
local AI agents a shared context layer they can read and write with citations, backed
by a private personal CRM schema.

The product should feel closer to an operating system for personal context than a
generic database browser. The schema matters because the schema is the product: the
system should know what a person, project, task, meeting, email, note, and document
are.

## Why Now

- Local desktop agents are becoming normal.
- Those agents need durable user context that survives any one chat thread.
- Users need inspectable memory, not opaque model recall.
- SQLite, Tauri, local embeddings, and BYOK extraction make a local-first product
  realistic.

## Core Loop

1. A local agent, daily automation, or user adds a document or interaction.
2. Local Brain stores the readable content directly in SQLite.
3. AI extracts useful tasks, people, organizations, existing project links, and hidden
   atomic memories.
4. Agents read from the brain to produce daily reports, todo lists, and briefings.
5. The UI lets the user browse, correct, inspect, and demonstrate the brain.

The app should not require reviewing every extraction. Corrections should happen where
the user naturally sees a mistake: a person page, project page, task, document, or
interaction.

## Product Model

- **People:** contacts, collaborators, friends, family, service providers, and anyone
  else the user may need to remember.
- **Relationship intelligence:** recency, cadence, strength, important dates, and
  follow-up suggestions derived from interactions and tasks.
- **Organizations:** companies, schools, teams, vendors, clubs, government bodies, and
  other groups.
- **Affiliations:** time-bound links between people and organizations.
- **Projects:** manually curated areas of active or archived work, from professional
  deals to home projects or travel planning.
- **Tasks:** commitments, follow-ups, reminders, waiting items, and scheduled actions.
- **Graph:** a derived visual map of the user's brain, with the user at the center and
  connected people, organizations, projects, tasks, documents, interactions, and
  memories around them.
- **Interactions:** human exchanges: meetings, calls, emails, messages, chats, voice
  notes, notes, and events.
- **Documents:** user-readable artifacts and reference material: notes, PDFs, text
  files, webpages, plans, specs, receipts, and imported transcripts when they are
  treated as artifacts.
- **Memories:** hidden atomic claims extracted from records: facts, preferences,
  decisions, commitments, instructions, risks, and ideas.
- **Settings:** AI providers, local paths, diagnostics, and skill setup.

## User Experience

The app should borrow the quiet density and navigation confidence of the Picardo
internal UI, while becoming more personal and less corporate.

The UI is not the primary write path. It is the visible window into a brain mostly
maintained and queried by local agents. It should make the product legible: what the
brain knows, why it knows it, what changed recently, and what the user can do next.

Top-level navigation:

- Today
- Tasks
- Network
- Projects
- Ask
- Settings

Documents and interactions are first-class data, but not top-level navigation. They
appear inside detail pages and through search or Ask.
The graph is the default Network tab, alongside People and Organizations.

## Technical Bet

Reflect Open is the technology base: Tauri, React, Rust native capabilities, SQLite,
local search, local embeddings where practical, keychain secrets, and sidecar tools.

Local Brain diverges in storage philosophy. Reflect Open treats markdown as durable
knowledge and SQLite as a projection. Local Brain treats SQLite as durable knowledge
and uses exports as portability features.

The most important integration is the local agent contract: a `brain` CLI and skills
that let Codex or other agents update records, search context, and produce recurring
reports.

## Non-Goals for Launch

- Hosted sync.
- Team accounts.
- A generic table editor.
- A browser extension.
- Fully automatic email/calendar integrations.
- A top-level automation log.
- Row-level sensitivity labels.
