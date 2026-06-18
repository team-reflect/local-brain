# Local Brain Docs

Working name: **Local Brain**.

This repo holds a consumer version of Company Brain built on Reflect Open's
local-first desktop technology. It began as a planning space; the implementation
stack is now complete through Plan 09 (see [Current Product State](current-state.md)
for the as-built view). The product direction is:

> An agent-operated local brain with a private desktop UI.

Unlike Reflect Open, this product does not use markdown as the durable source of truth.
SQLite is the durable local store. The main operating path is AI agents writing to and
reading from the brain through a CLI and local skills. The UI exists for quick
browsing, correction, inspection, and showing someone else what the brain knows,
including a graph view centered on the user.

The implementation stack is complete through Plan 09. For a grounded, as-built
overview of what Local Brain currently is and how it works, start with
[Current Product State](current-state.md).

## Docs

- [Current Product State](current-state.md) — as-built overview (start here)
- [Product Thesis](product-thesis.md)
- [Reflect Open Technology Base](reflect-open-technology-base.md)
- [Launch Schema](launch-schema.md)
- [Agent Interface](agent-interface.md)
- [UI Direction](ui-direction.md)
- [Design System](design-system.md)
- [MVP Plan](mvp-plan.md)
- [Implementation Plans](plans/00-overview.md)
- [Open Questions](open-questions.md)

## Core Bet

People will soon have multiple local agents operating on their behalf. Those agents
need a shared, trusted, inspectable context layer. Local Brain gives them one without
requiring a hosted account, cloud database, or proprietary API.

The product should be useful through agents first. A Codex daily automation should be
able to update the brain, produce a report, and generate a todo list without requiring
the user to open the UI.
