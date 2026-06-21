# UI Direction

Local Brain uses the **Reflect Open / Reflect Local design system**: calm, dense, and
data-first, with cool greys, a single indigo accent, a fixed sunken left sidebar, and a
quiet command/search trigger. The UI is a window into a brain mostly written and read by
AI agents through the CLI and local skills. We translate Reflect's visual language, not
its product model — this is a personal CRM and memory surface, not a note editor.

The UI should support quick browsing, correction, inspection, and demonstration. It is
not the primary bulk-entry or reporting interface.

Use [Design System](design-system.md) for concrete tokens, typography, components, and
the Reflect reference paths.

## Startup

Before the main shell appears, Local Brain follows Reflect Open's graph chooser pattern:

- first run asks the user to choose or create a brain folder with the OS directory picker
- returning launches auto-open the newest recent brain folder
- failed opens return to the chooser with a clear error and recent folders still visible
- the chooser opens folders, never individual SQLite files

The chosen folder is the user's portable local brain root.

## Navigation

Sidebar:

```text
+------------------------------------------------------+
| Local Brain                                           |
+----------------------+-------------------------------+
| Today                |                               |
| Tasks                |  Current view                 |
| Network              |                               |
| Projects             |                               |
| Chat                 |                               |
| Settings             |                               |
+----------------------+-------------------------------+
```

Top-level sections:

- **Today:** AI daily brief with agenda, due tasks, waiting items, recent changes,
  relationship-linked context, and suggested next actions.
- **Tasks:** all open, waiting, scheduled, and completed tasks.
- **Network:** graph, people, and organizations, with Graph as the default tab.
- **Projects:** active, waiting, paused, done, and archived projects.
- **Chat:** grounded chat over local records, with approval-gated write tools for
  core CRM updates.
- **Settings:** about, the active brain's identity (name, color, location), forgetting
  the active brain from the local catalogue, AI providers, and semantic search.

A **brain** is the top-level workspace: a user-selected folder containing the local
SQLite database plus its app-managed assets directory. The sidebar
top holds a **brain switcher** (swatch + active brain name) to switch, create, or
open another brain. Settings can forget the current brain from Local Brain's local
catalogue without deleting its folder, database, assets, or support files. Do not
confuse a *brain* (the container) with the Network
**Graph** (a visualization of the records inside the current brain).

Document and interaction records are browsed inside Network, Project, and Task detail
pages, and found through global search or Chat.

## Information Architecture

```text
Today
  - AI daily brief
  - due and scheduled tasks
  - waiting items
  - recent interactions
  - active project changes

Tasks
  - task table
  - task detail
    - linked people
    - linked organizations
    - linked projects
    - related documents
    - related interactions
    - evidence

Network
  - Graph tab
    - user-centered graph
    - people, organizations, projects, tasks, and documents as nodes
    - interactions as weighted links between people, summarized by count and recency
    - optional filters by node type, interaction recency, relationship strength, and project
    - click a node to open the related detail page
  - People tab
    - people table
    - person detail
      - profile and affiliations
      - tasks
      - projects
      - interactions
      - documents
      - remembered facts
  - Organizations tab
    - organizations table
    - organization detail
      - profile and people
      - projects
      - tasks
      - interactions
      - documents

Projects
  - project table/board
  - project detail
    - overview
    - tasks
    - people and organizations
    - interactions
    - documents
    - remembered decisions and risks
Chat
  - grounded chat
  - durable conversations and messages
  - request-local retrieved sources
  - user-approved writes to people, organizations, projects, tasks, interactions, and memories
Settings
  - about (description and app version)
  - brain (identity: name, color, folder reveal)
  - AI providers
  - semantic search
```

## Visual Style

- Fixed 260px sunken left sidebar with compact navigation; active rows use a grey wash
  and an indigo icon. The brain switcher (swatch + active brain name) sits at the
  sidebar top in the brand slot; a quiet ⌘K search trigger sits in the topbar.
- Main surfaces favor dense tables, split panes, detail blocks, filters, and search on a
  white content area over a faint cool field.
- Use cards only for repeated summary items or modals, never as the default page layout;
  no nested cards.
- Keep density high enough for real work.
- Restrained color (cool grey + one indigo accent), crisp Inter typography (no serif),
  mono only for metadata and shortcuts, predictable 8px-based spacing.
- Prefer visible data over explanatory copy.
- Make it obvious what changed recently and which records support an AI-generated
  report or todo list.
- See the Graph note below; node and chrome colors derive from the same token palette.

## Core Screens

### Today

```text
+----------------------+----------------------------------------------+
| Today                | Today                                        |
| Tasks                | Search...                                    |
| Network              +----------------------------------------------+
| Projects             | Brief                                       |
| Graph                |  [ ] Send proposal follow-up     Project A  |
| Settings             |                                              |
|                      | Relationship context                        |
|                      |  Maya - waiting on contract comments        |
|                      |  Jordan - mentioned in product sync         |
|                      |                                              |
|                      | Waiting                                      |
|                      |  Waiting on Maya - contract comments         |
|                      |                                              |
|                      | Recent interactions                          |
|                      |  9:30 AM  Call with Jordan                   |
|                      |  Yesterday Email from Acme                   |
+----------------------+----------------------------------------------+
```

### Network

```text
+----------------------+----------------------------------------------+
| Today                | Network                                      |
| Tasks                | [People] [Organizations]          Search... |
| Network              +----------------------+-----------------------+
| Projects             | Name                 | Profile               |
| Settings             | Jordan Lee           | Product lead at Acme  |
|                      | Acme Corp            |                       |
|                      |                      | Tasks                 |
|                      |                      | Interactions          |
|                      |                      | Documents             |
+----------------------+----------------------------------------------+
```

### Project Detail

```text
+----------------------+----------------------------------------------+
| Today                | Project: Home renovation                     |
| Tasks                | Status: active                              |
| Network              +----------------------------------------------+
| Projects             | Tasks | People | Interactions | Documents    |
| Settings             | [ ] Confirm contractor schedule              |
|                      | [ ] Choose bathroom tile                     |
|                      |                                              |
|                      | Recent interaction                           |
|                      | Call with Alex - budget changed              |
+----------------------+----------------------------------------------+
```

### Graph

```text
+----------------------+----------------------------------------------+
| Today                | Graph                         Filter: All   |
| Tasks                |                                              |
| Network              |                 [Alex]                       |
| Projects             |              /    |    \\                    |
| Graph                |        Maya       Home Reno       Acme        |
| Settings             |       /    \\         |          /  \\       |
|                      | Budget 2x  Tile task   Jordan  Contract      |
|                      |                                              |
|                      | Selected: Home Reno                          |
|                      | Tasks | People | Interactions | Documents    |
+----------------------+----------------------------------------------+
```

## Interaction Rules

- Search should be global and available from all main surfaces.
- Chat should answer from local document and interaction chunks using the configured
  BYOK provider.
- Chat write tools should require explicit approval before creating or updating
  people, organizations, projects, tasks, interactions, or memories.
- A user should be able to correct a task, person link, project link, or remembered
  fact from the detail page where it appears.
- Graph should be a derived navigation and demonstration surface, not the storage
  model.
- Graph should not render every interaction as a node. Meetings, emails, calls, and
  messages should strengthen or annotate links between people, with individual
  interactions browsed from detail pages, search, Today, and Chat.
- Imported text should become a document or interaction immediately.
- No mandatory review queue for extracted data.
