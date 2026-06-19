# Open Questions

These questions should stay small and decision-oriented. The core schema direction is
settled for launch: Local Brain is a personal CRM over SQLite, with documents and
interactions as first-class records and hidden atomic memories.

## Product

1. What is the product name?
2. Should the first launch optimize for work context, personal life context, or an even
   split?
3. How much direct note-writing should exist in v1 versus import/paste-first capture?
4. Should Today include a lightweight calendar-like view before real calendar
   integration exists?
5. How dense should the first Graph view be: beautiful demo surface, practical
   navigation surface, or both?
6. Which relationship-intelligence signals are worth showing in Today: stale
   relationships, important dates, recent changes, or explicit reconnect cadence?

## Schema

1. Do we need `person_aliases` and `organization_aliases` in launch, or can matching use
   normalized names and notes first?
2. Should projects support parent/child hierarchy in launch?
3. Should tasks support recurrence in launch, or only one-off due/scheduled dates?
4. Should `content_chunks` stay limited to documents and interactions?

## AI

1. Which extraction model is good enough for direct application without mandatory
   review?
2. Which embedding backend is easiest to package on macOS?
3. How should the app explain external model calls without making the product feel
   scary?

## Distribution

1. Do we sign/notarize the first macOS build?
2. Should the CLI install into the user's PATH automatically or show a copyable command?
