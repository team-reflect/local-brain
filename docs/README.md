# Local Brain Docs

Working name: **Local Brain**.

This repo is currently a planning space for a consumer version of Company Brain built
on Reflect Open's local-first desktop technology. The product direction is:

> A private, local memory layer for a person and their AI agents.

Unlike Reflect Open, this product does not use markdown as the durable source of truth.
SQLite is the durable local store. The user-facing experience should still feel simple:
add sources, extract useful memory, review uncertain claims, then ask questions across
work and life with citations.

## Docs

- [Product Thesis](product-thesis.md)
- [Reflect Open Technology Base](reflect-open-technology-base.md)
- [Launch Schema](launch-schema.md)
- [Agent Interface](agent-interface.md)
- [MVP Plan](mvp-plan.md)
- [Implementation Plans](plans/00-overview.md)
- [Open Questions](open-questions.md)

## Core Bet

People will soon have multiple local agents operating on their behalf. Those agents
need a shared, trusted, inspectable memory layer. Local Brain gives them one without
requiring a hosted account, cloud database, or proprietary API.

The app should be useful to a human first, but designed so local agents can ingest,
query, and cite the user's private context safely.
