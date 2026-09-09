---
name: brain-task-review
description: Reconcile Local Brain tasks against newer evidence, retire resolved or obsolete work, consolidate duplicates, and audit full backlog coverage. Use during daily imports or when asked to clean up stale tasks.
---

# Task Reconciliation

Read the installed `brain` skill and verify the intended brain with `brain
--brain <root> --json doctor` and `brain --brain <root> path`. All task writes
use the CLI. The Python 3 stdlib helper below opens SQLite read-only for a
complete snapshot and a readback audit; it never mutates tasks or infers closure.
Local Brain installs this skill and its audit helper through Settings -> CLI &
agents at `~/.agents/skills/brain-task-review`. For a manual installation, copy
this whole directory, including `scripts/`, into the agent's skills directory.

## Review The Whole Backlog

At the start of a daily import, snapshot the backlog into that run's scratch
directory. Resolve `scripts/task_review.py` relative to this skill directory:

```bash
python3 <skill-dir>/scripts/task_review.py --brain <root> snapshot > tasks-before.json
```

`activeIds` contains every open, in-progress, waiting, and blocked task, without
a top-N limit. `tasks` also includes terminal records for duplicate lookup and
readback, with task fields, source links, evidence chunks, and `stateDigest`.
Keep these private artifacts inside the brain's import scratch directory.

Before creating an action, compare it against active AND terminal tasks by the
underlying obligation, participants, project, source thread, and relevant event,
invoice, or billing period. Similar titles alone are not proof of duplication;
different invoices, recurring periods, or distinct deliverables remain separate.
Repeated reminders should add evidence to the existing task. Do not resurrect
completed/cancelled work unless newer evidence clearly creates a fresh obligation.

After importing fresh evidence, review every initially active task and every
new task created during the run. This includes undated and waiting tasks, old
threads outside the daily source window, and tasks omitted by `plan-day` limits.
Read the original obligation and newer relevant source text, not just task titles
or AI summaries. Search across related conversations and records, not only the
original thread. Follow linked source identities to live providers when needed.

- **Done:** evidence establishes the actual requested outcome. A direct external
  reply can resolve a reply task; a forward to a colleague does not. Sending a
  reply does not prove payment, delivery, signature, or implementation.
- **Cancelled:** evidence establishes abandonment, replacement, or that the
  action's specific opportunity has passed. An arrival instruction for a past
  stay can expire; an unpaid bill remains actionable after its due date. Record
  the event/date or decision supporting cancellation. Age alone is insufficient.
- **Duplicate:** confirm the same obligation, keep one canonical task, add any
  missing source links/evidence to it, and cancel the others. Put the canonical
  task ID and consolidation reason in each cancelled task's description.
- **Updated:** preserve the task's identity while advancing its next action or
  status. Preserve unrelated description details and links.
- **Kept:** the inspected evidence still supports the existing obligation.
- **Unresolved:** evidence or source access is insufficient. Leave it active and
  record exactly what could not be checked. Do not claim it was fully reviewed.

Use `brain --brain <root> --json tasks complete <id> --evidence ...` for done
and `tasks update <id> --status cancelled --description ... --evidence ...` for
cancellation. Each mutation cites stored source chunks. Use `tasks update` to
attach newer evidence/links to the canonical task. Do not hard-delete tasks.
Read back changes before recording their outcome.

## Coverage And Readback

Write `task-review.json` as a JSON array with one entry for every task reviewed:

```json
[
  {
    "taskId": "<id>",
    "outcome": "duplicate",
    "canonicalTaskId": "<kept-task-id>",
    "reason": "Same account, risk scenario and obligation as the canonical task.",
    "checkedSources": ["interaction:<id>#0", "provider query and window checked"],
    "decisionEvidence": ["interaction:<id>#0"],
    "stateDigest": "<digest from a fresh snapshot after CLI writes>"
  }
]
```

Allowed outcomes are `done`, `cancelled`, `duplicate`, `updated`, `kept`, and
`unresolved`. Unresolved entries also require `gap`. Use actual inspected source
refs/queries, not planned searches. Copy each final `stateDigest` from a fresh
snapshot, including for unchanged tasks; do not manufacture it.
Every changed task also needs `decisionEvidence`: source chunk refs in `kind:id#index`
form that support the decision and are attached to that task by the CLI write.

```bash
python3 <skill-dir>/scripts/task_review.py --brain <root> snapshot > tasks-after.json
python3 <skill-dir>/scripts/task_review.py --brain <root> audit \
  --before tasks-before.json --ledger task-review.json > task-review-audit.json
```

The audit re-reads the live database and checks initially active, currently active,
and newly created tasks (even if already closed), unique coverage, state digests, outcome/status
consistency, and valid canonical tasks. Exit 0 means complete coverage with no
unresolved entries; exit 1 means incomplete reconciliation; exit 2 means a helper
or input error. Read the JSON even on exit 1. Fix missing/invalid entries; preserve
real source gaps. This is a receipt check, not proof that an agent's reasoning is
correct. Do not count a blanket unresolved disposition as a reviewed task.

Report active before/after, done/cancelled/consolidated/updated/kept counts,
reviewed versus required coverage, and unresolved gaps. If bounded source access
prevents full review, say which tasks remain unchecked and why. A successful
import audit does not imply successful task reconciliation. Regenerate the daily
brief only after this pass so it uses current task state. Follow the existing
automation's delivery rules; this skill does not authorize sending messages.
