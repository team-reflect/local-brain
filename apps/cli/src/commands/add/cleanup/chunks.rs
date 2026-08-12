//! Safe maintenance for the rebuildable `content_chunks` projection.

use std::collections::HashSet;

use rusqlite::Connection;
use serde_json::json;

use super::super::links::{dedupe_exact_chunks_for_record, ExactChunkDedupeStats};
use super::super::record_ref::{parse_record_ref, require_record};
use crate::error::CliError;
use crate::output::print_json;

pub struct RepairExactChunksArgs<'a> {
    /// Optional `kind:id` scope. Empty means every record with chunks.
    pub records: Vec<&'a str>,
    /// Preview is the default; mutations require this explicit opt-in.
    pub apply: bool,
}

fn record_keys(conn: &Connection, requested: &[&str]) -> Result<Vec<(String, String)>, CliError> {
    if !requested.is_empty() {
        let mut seen = HashSet::new();
        let mut keys = Vec::new();
        for raw in requested {
            let key = parse_record_ref(raw, "--record")?;
            if !seen.insert(key.clone()) {
                continue;
            }
            require_record(conn, &key.0, &key.1)?;
            keys.push(key);
        }
        keys.sort();
        return Ok(keys);
    }

    let mut stmt = conn.prepare(
        "SELECT DISTINCT record_type, record_id
         FROM content_chunks
         ORDER BY record_type ASC, record_id ASC",
    )?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[derive(Default)]
struct RepairSummary {
    records_scanned: usize,
    records_with_duplicates: usize,
    stats: ExactChunkDedupeStats,
}

fn summarize(
    conn: &Connection,
    keys: &[(String, String)],
    apply: bool,
) -> Result<RepairSummary, CliError> {
    let mut summary = RepairSummary {
        records_scanned: keys.len(),
        ..RepairSummary::default()
    };
    for (record_type, record_id) in keys {
        let stats =
            dedupe_exact_chunks_for_record(conn, record_type.as_str(), record_id.as_str(), apply)?;
        if stats.duplicate_chunks > 0 {
            summary.records_with_duplicates += 1;
        }
        summary.stats.duplicate_chunks += stats.duplicate_chunks;
        summary.stats.evidence_refs_repointed += stats.evidence_refs_repointed;
        summary.stats.embeddings_deleted += stats.embeddings_deleted;
        summary.stats.hashes_refreshed += stats.hashes_refreshed;
    }
    Ok(summary)
}

/// Preview or apply exact-text chunk de-duplication in one transaction.
/// Durable record bodies and raw provider metadata are never modified.
pub fn repair_exact_chunks(
    conn: &mut Connection,
    json_output: bool,
    args: RepairExactChunksArgs<'_>,
) -> Result<(), CliError> {
    let tx = conn.transaction()?;
    let keys = record_keys(&tx, &args.records)?;
    let before = summarize(&tx, &keys, args.apply)?;
    let after = if args.apply {
        summarize(&tx, &keys, false)?
    } else {
        RepairSummary {
            records_scanned: before.records_scanned,
            ..RepairSummary::default()
        }
    };

    if args.apply {
        tx.commit()?;
    } else {
        tx.rollback()?;
    }

    let result = json!({
        "mode": if args.apply { "applied" } else { "preview" },
        "applied": args.apply,
        "recordsScanned": before.records_scanned,
        "recordsWithDuplicatesBefore": before.records_with_duplicates,
        "recordsWithDuplicatesAfter": after.records_with_duplicates,
        "duplicateChunksBefore": before.stats.duplicate_chunks,
        "duplicateChunksAfter": after.stats.duplicate_chunks,
        "projectedDuplicateChunksAfterApply": 0,
        "chunksRemoved": if args.apply { before.stats.duplicate_chunks } else { 0 },
        "chunksToRemove": before.stats.duplicate_chunks,
        "evidenceRefsRepointed": if args.apply { before.stats.evidence_refs_repointed } else { 0 },
        "evidenceRefsToRepoint": before.stats.evidence_refs_repointed,
        "embeddingsDeleted": if args.apply { before.stats.embeddings_deleted } else { 0 },
        "embeddingsToDelete": before.stats.embeddings_deleted,
        "hashesRefreshed": if args.apply { before.stats.hashes_refreshed } else { 0 },
        "hashesToRefresh": before.stats.hashes_refreshed,
        "durableBodiesChanged": false,
        "backupGuidance": "Before --apply, close Local Brain and back up the whole brain folder (including brain.sqlite, SQLite sidecars, and assets).",
    });
    if json_output {
        print_json(&result)
    } else {
        let action = if args.apply {
            "removed"
        } else {
            "would remove"
        };
        println!(
            "{action} {} exact duplicate chunks across {} records ({} evidence refs {})",
            before.stats.duplicate_chunks,
            before.records_with_duplicates,
            before.stats.evidence_refs_repointed,
            if args.apply {
                "repointed"
            } else {
                "would be repointed"
            }
        );
        if !args.apply {
            println!(
                "preview only; close Local Brain, back up the brain folder, then rerun with --apply"
            );
        }
        Ok(())
    }
}
