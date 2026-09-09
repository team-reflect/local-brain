//! Helpers for provider-neutral typed record references such as
//! `person:01ABC` or `interaction_transcript:01XYZ`.

use rusqlite::{params, Connection};

use crate::error::CliError;

/// Durable table and archive behavior shared by references and import identity.
pub(super) struct RecordTable {
    pub table: &'static str,
    pub has_archived_at: bool,
}

/// Resolve a canonical record type; CLI aliases are normalized by the parser.
pub(super) fn record_table(kind: &str) -> Option<RecordTable> {
    let (table, has_archived_at) = match kind {
        "person" => ("people", true),
        "organization" => ("organizations", true),
        "organization_profile" => ("organization_profiles", false),
        "project" => ("projects", true),
        "task" => ("tasks", true),
        "document" => ("documents", true),
        "interaction" => ("interactions", true),
        "interaction_transcript" => ("interaction_transcripts", false),
        "ai_note" => ("ai_notes", false),
        "extracted_fact" => ("extracted_facts", true),
        "memory" => ("memories", true),
        "asset" => ("assets", true),
        _ => return None,
    };
    Some(RecordTable {
        table,
        has_archived_at,
    })
}

/// Parse a typed reference and normalize the short `org` and `doc` aliases.
pub(super) fn parse_record_ref(raw: &str, label: &str) -> Result<(String, String), CliError> {
    let (kind, id) = raw
        .split_once(':')
        .ok_or_else(|| CliError::Runtime(format!("invalid {label} '{raw}' (expected kind:id)")))?;
    let kind = match kind {
        "org" => "organization",
        "doc" => "document",
        other => other,
    };
    if record_table(kind).is_none() {
        return Err(CliError::Runtime(format!("unknown {label} kind '{kind}'")));
    }
    if id.trim().is_empty() {
        return Err(CliError::Runtime(format!(
            "invalid {label} '{raw}' (empty id)"
        )));
    }
    Ok((kind.to_string(), id.to_string()))
}

/// Check for a live record, excluding archived rows where the table supports them.
pub(super) fn record_exists(conn: &Connection, kind: &str, id: &str) -> Result<bool, CliError> {
    let Some(record) = record_table(kind) else {
        return Ok(false);
    };
    let table = record.table;
    let archived_filter = if record.has_archived_at {
        "AND archived_at IS NULL"
    } else {
        ""
    };
    let sql = format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id = ?1 {archived_filter})");
    Ok(conn.query_row(&sql, params![id], |row| row.get::<_, bool>(0))?)
}

/// Reject references to unknown types, missing records, or archived records.
pub(super) fn require_record(conn: &Connection, kind: &str, id: &str) -> Result<(), CliError> {
    if record_exists(conn, kind, id)? {
        Ok(())
    } else {
        Err(CliError::NotFound(format!("{kind} {id} not found")))
    }
}
