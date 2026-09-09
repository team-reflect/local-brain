#!/usr/bin/env python3
"""Read-only task snapshots and reconciliation coverage checks (Python stdlib only)."""

import argparse
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import sys


ACTIVE = {"open", "in_progress", "waiting", "blocked"}
OUTCOMES = {"done", "cancelled", "duplicate", "updated", "kept", "unresolved"}


def digest(value):
    """Hash a task's durable state, including its source links and evidence."""
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def snapshot(brain):
    """Read all tasks in one SQLite snapshot without creating or changing the DB."""
    path = (Path(brain).expanduser().resolve() / "brain.sqlite")
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only = ON")
        conn.execute("BEGIN")
        tasks = []
        for row in conn.execute("SELECT * FROM tasks ORDER BY created_at, id"):
            task = dict(row)
            task["sourceRefs"] = sorted({
                f"{kind}:{source_id}"
                for kind, source_id in conn.execute(
                    "SELECT 'interaction', interaction_id FROM task_interactions WHERE task_id = ? "
                    "UNION SELECT 'document', document_id FROM task_documents WHERE task_id = ?",
                    (task["id"], task["id"]),
                )
            } | {
                f"{kind}:{task[key]}"
                for kind, key in [("interaction", "origin_interaction_id"),
                                  ("document", "origin_document_id")]
                if task.get(key)
            } | ({f"{task['source_record_type']}:{task['source_record_id']}"}
                 if task.get("source_record_type") and task.get("source_record_id") else set()))
            task["evidence"] = [dict(e) for e in conn.execute(
                "SELECT e.id, e.chunk_id, e.note, c.record_type, c.record_id, c.chunk_index, "
                "c.text FROM evidence_refs e LEFT JOIN content_chunks c ON c.id = e.chunk_id "
                "WHERE e.subject_type = 'task' AND e.subject_id = ? ORDER BY e.id",
                (task["id"],),
            )]
            task["stateDigest"] = digest(task)
            tasks.append(task)
    active = [t for t in tasks if t["status"] in ACTIVE and not t["archived_at"]]
    return {"version": 1, "brainRoot": str(path.parent),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "activeCount": len(active), "activeIds": [t["id"] for t in active], "tasks": tasks}


def audit(before, current, ledger):
    """Verify coverage and readback; this validates receipts, not semantic judgment."""
    if before.get("version") != 1 or current.get("version") != 1:
        raise ValueError("unsupported snapshot version")
    if before["brainRoot"] != current["brainRoot"]:
        raise ValueError("snapshot targets a different brain")
    if not isinstance(ledger, list):
        raise ValueError("ledger must be a JSON array")
    required = set(before["activeIds"]) | set(current["activeIds"])
    original = {t["id"]: t for t in before["tasks"]}
    live = {t["id"]: t for t in current["tasks"]}
    seen = set()
    errors = []
    counts = Counter()
    for entry in ledger:
        task_id = entry.get("taskId")
        outcome = entry.get("outcome")
        if task_id in seen or task_id not in required:
            errors.append(f"{task_id}: duplicate or unexpected ledger task")
            continue
        seen.add(task_id)
        task = live.get(task_id)
        if task is None:
            errors.append(f"{task_id}: task is missing; hard deletion is not reconciliation")
            continue
        entry_errors = []
        if outcome not in OUTCOMES:
            entry_errors.append("invalid outcome")
        if not isinstance(entry.get("reason"), str) or not entry["reason"].strip():
            entry_errors.append("missing reason")
        if entry.get("stateDigest") != task["stateDigest"]:
            entry_errors.append("readback digest missing or stale")
        sources = entry.get("checkedSources")
        if not isinstance(sources, list) or not all(isinstance(s, str) and s.strip() for s in sources):
            entry_errors.append("checkedSources must be a list of source refs or provider queries")
        elif not sources and outcome != "unresolved":
            entry_errors.append("no sources checked")
        if outcome == "unresolved" and not entry.get("gap"):
            entry_errors.append("unresolved requires an explicit gap")
        if outcome in {"done", "cancelled", "duplicate"}:
            expected = "done" if outcome == "done" else "cancelled"
            if task["status"] != expected or task["archived_at"]:
                entry_errors.append(f"expected non-archived status {expected}")
        elif task["status"] not in ACTIVE or task["archived_at"]:
            entry_errors.append("expected an active task")
        if outcome == "done" and not task["completed_at"]:
            entry_errors.append("done task has no completion timestamp")
        if outcome in {"done", "cancelled", "duplicate", "updated"}:
            evidence_refs = {
                f"{e['record_type']}:{e['record_id']}#{e['chunk_index']}"
                for e in task["evidence"] if e.get("text") and e.get("record_id")
            }
            decision_evidence = entry.get("decisionEvidence")
            if (not isinstance(decision_evidence, list) or not decision_evidence
                    or not all(isinstance(ref, str) and ref in evidence_refs
                               for ref in decision_evidence)):
                entry_errors.append("decisionEvidence must cite stored chunks attached to the task")
        if outcome in {"kept", "unresolved"} and task_id in original:
            if task["stateDigest"] != original[task_id]["stateDigest"]:
                entry_errors.append("task changed; use updated or a terminal outcome")
        if outcome == "updated" and task_id in original:
            if task["stateDigest"] == original[task_id]["stateDigest"]:
                entry_errors.append("updated task is unchanged")
        if outcome == "duplicate":
            canonical = live.get(entry.get("canonicalTaskId"))
            if (not canonical or canonical["id"] == task_id or canonical["archived_at"]
                    or canonical["status"] == "cancelled"):
                entry_errors.append("missing or invalid canonical task")
        errors.extend(f"{task_id}: {error}" for error in entry_errors)
        if not entry_errors:
            counts[outcome] += 1
    missing = sorted(required - seen)
    return {"brainRoot": current["brainRoot"], "activeBefore": before["activeCount"],
            "activeAfter": current["activeCount"], "required": len(required),
            "accountedFor": sum(counts.values()),
            "reviewed": sum(counts.values()) - counts["unresolved"],
            "outcomes": dict(counts), "missingTaskIds": missing, "errors": errors,
            "complete": not missing and not errors and not counts["unresolved"]}


def main():
    """Print a snapshot or a fresh coverage audit as JSON; incomplete audits exit 1."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--brain", required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("snapshot")
    check = sub.add_parser("audit")
    check.add_argument("--before", required=True, type=Path)
    check.add_argument("--ledger", required=True, type=Path)
    args = parser.parse_args()
    try:
        current = snapshot(args.brain)
        if args.command == "snapshot":
            result = current
        else:
            result = audit(json.loads(args.before.read_text()), current,
                           json.loads(args.ledger.read_text()))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result.get("complete", True) else 1
    except (OSError, sqlite3.Error, ValueError, KeyError, TypeError, AttributeError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
