# UI Direction

Local Brain should borrow heavily from `/Users/alex/repos/picardo-internal-ui`, while
translating the corporate CRM parts into a consumer personal-memory product.

The target feel is:

> A calm local data tool for your life and agents; more research notebook than chat app.

## What to Borrow from Picardo Internal UI

- **Persistent left sidebar:** grouped navigation, brand block, icon + label items,
  collapsed icon rail, mobile drawer, keyboard toggle.
- **Thin topbar:** sidebar toggle, command/search trigger, small utility controls.
- **Dense data surfaces:** compact rows, sticky headers, mono metadata, fast scanning.
- **List/detail rhythm:** list pages lead to rich detail pages.
- **Detail aside:** entity/source/detail pages use a right rail for identity, metadata,
  provenance, quick links, and actions.
- **Command palette:** global jump/search should feel central, not secondary.
- **Editorial data styling:** quiet paper/ink palette, serif for headings/prose, sans for
  UI, mono for IDs, dates, confidence, and source keys.
- **Semantic primitives:** badges, tags, chips, link rows, key/value grids, virtualized
  tables, prose blocks, empty states.
- **Graph as a real surface:** graph view is a navigation and sensemaking tool, not a
  decorative visualization.

## What Not to Copy

- Corporate CRM language.
- Partnership/integration-specific workflows.
- Admin-heavy framing.
- Auth/account chrome as a central product idea.
- Read-only posture; Local Brain is a writeable local memory app.
- Raw database or SQL affordances in the main UI.

## Navigation Model

Use grouped sidebar navigation, closer to Picardo than the earlier simple sketch.

```text
+---------------------------+-----------------------------------------------+
| Local Brain               |  [=]  Search or ask anything...      Cmd-K * |
| personal memory           +-----------------------------------------------+
|                           |                                               |
| WORKSPACE                 |  Current route                                 |
|  Today                    |                                               |
|  Tasks                    |  Dense lists, feeds, tables, graph, or detail |
|  People                   |  pages live here.                             |
|  Projects                 |                                               |
|  Places                   |                                               |
|                           |                                               |
| MEMORY                    |                                               |
|  Sources                  |                                               |
|  Memories                 |                                               |
|  Conversations            |                                               |
|  Graph                    |                                               |
|                           |                                               |
| AI                        |                                               |
|  Ask                      |                                               |
|  Agent activity           |                                               |
|                           |                                               |
| SYSTEM                    |                                               |
|  Backup & export          |                                               |
|  Settings                 |                                               |
|                           |                                               |
|  You / local brain status |                                               |
+---------------------------+-----------------------------------------------+
```

The collapsed rail should preserve icons and tooltips. On mobile, it becomes an
off-canvas drawer.

## Core Screens

### Today

Today should feel like Picardo's dashboard/attention center, adapted for a person.

```text
+--------------------------------------------------------------------------+
| TODAY                                                       Wed Jun 17    |
+--------------------------------------------------------------------------+
| +---------------------------+ +----------------------------------------+ |
| | Attention                 | | Upcoming                               | |
| | overdue / due / waiting   | | calls, events, deadlines               | |
| | compact actionable rows   | | compact chronological rows             | |
| +---------------------------+ +----------------------------------------+ |
|                                                                          |
| +---------------------------+ +----------------------------------------+ |
| | Recent memory             | | Agent activity                         | |
| | facts, decisions, notes   | | imports, writes, model calls           | |
| +---------------------------+ +----------------------------------------+ |
+--------------------------------------------------------------------------+
```

No review queue. If something is wrong, the correction action lives on the row/detail.

### Sources

Sources are the evidence catalog. This should be table-first.

```text
+--------------------------------------------------------------------------+
| SOURCES                                       [Import] [Folder] [Paste]    |
| Filter sources...                                         1,284 sources    |
+--------------------------------------------------------------------------+
| Type        Title                         When        Memories  Privacy    |
| transcript  Call with Sarah               Today       12        local      |
| file        investor-notes.md             Yesterday   8         sensitive  |
| chat        Agent session                 Jun 12      5         local      |
+--------------------------------------------------------------------------+
```

Source detail should use a main body plus aside:

```text
+-----------------------------------------------+--------------------------+
| Source content / chunks / extracted memories  | Evidence                 |
|                                               | Type: transcript         |
| Link rows to memories, tasks, people, events  | Privacy: local           |
|                                               | Hash / path / importer   |
|                                               | Agent event              |
+-----------------------------------------------+--------------------------+
```

### People, Projects, Places, Topics

Entity pages should follow Picardo detail pages:

- identity header,
- summary/prose section,
- linked memories,
- tasks,
- events/interactions,
- sources,
- right-side metadata rail.

### Memories

Memories should be browsable, not hidden inside chat.

Rows should show kind, title/body, linked entity, confidence, source, observed date, and
privacy. The detail view should make correction and source inspection obvious.

### Ask

Ask should use the same shell, not a full-screen chatbot. Treat it like a query and
answer workspace with citations.

```text
+--------------------------------------------------------------------------+
| ASK                                                                      |
| What did I promise Sarah last week?                                      |
+--------------------------------------------------------------------------+
| Answer                                                                   |
| You promised to send Sarah the revised deck by Friday.                   |
|                                                                          |
| Citations                                                                |
| [1] Call transcript, Jun 12                                               |
| [2] Memory: Follow-up commitment                                         |
|                                                                          |
| Context                                                                  |
| 2 sources | 3 memories | cloud model used | never_external excluded      |
+--------------------------------------------------------------------------+
```

### Agent Activity

Agent activity replaces the old review/inbox idea. It is not a triage queue; it is an
audit log.

```text
+--------------------------------------------------------------------------+
| AGENT ACTIVITY                                                           |
| Agent        Action        Target        Confidence  When                 |
| Codex        remembered    3 memories    0.86        2m ago               |
| Importer     ingested      transcript    -           14m ago              |
| Local AI     extracted     9 memories    0.78        14m ago              |
+--------------------------------------------------------------------------+
```

## Visual Defaults

- Warm neutral background with a slightly lighter panel surface.
- Dark mode should be deep ink, not blue-black.
- Accent should be restrained: rust/amber or another warm accent, not purple-blue.
- Row height around 32px for dense lists.
- Cards are simple panels, not marketing cards.
- Use mono uppercase section labels for navigation groups and table headers.
- Use badges for privacy, memory kind, task status, source type, and confidence bands.
- Use stable layout dimensions so counts, badges, and row actions do not shift the UI.

## Product Translation

Picardo is corporate and remote-data oriented. Local Brain is personal and local. The
translation is:

- Organizations -> People / Projects / Places / Topics.
- Documents -> Sources.
- AI notes / extracted facts -> Memories.
- Tasks -> Tasks.
- Search -> Ask/Search.
- Graph -> Graph.
- Sources/Admin -> System / Backup / Settings.
- User auth footer -> local brain status / device identity.

The result should feel like a serious personal operating surface, not a consumer toy and
not a generic database browser.
