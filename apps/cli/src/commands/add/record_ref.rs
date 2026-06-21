//! Helpers for provider-neutral typed record references such as
//! `person:01ABC` or `interaction_transcript:01XYZ`.

use rusqlite::{params, Connection};

use crate::error::CliError;

pub(super) const RECORD_TYPES: &[&str] = &[
    "person",
    "organization",
    "organization_profile",
    "project",
    "task",
    "document",
    "interaction",
    "interaction_transcript",
    "ai_note",
    "extracted_fact",
    "memory",
    "asset",
];

pub(super) fn parse_record_ref(raw: &str, label: &str) -> Result<(String, String), CliError> {
    let (kind, id) = raw
        .split_once(':')
        .ok_or_else(|| CliError::Runtime(format!("invalid {label} '{raw}' (expected kind:id)")))?;
    if !RECORD_TYPES.contains(&kind) {
        return Err(CliError::Runtime(format!("unknown {label} kind '{kind}'")));
    }
    if id.trim().is_empty() {
        return Err(CliError::Runtime(format!(
            "invalid {label} '{raw}' (empty id)"
        )));
    }
    Ok((kind.to_string(), id.to_string()))
}

pub(super) fn record_exists(conn: &Connection, kind: &str, id: &str) -> Result<bool, CliError> {
    let (table, archived) = match kind {
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
        _ => return Ok(false),
    };
    let archived_filter = if archived {
        "AND archived_at IS NULL"
    } else {
        ""
    };
    let sql = format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id = ?1 {archived_filter})");
    Ok(conn.query_row(&sql, params![id], |row| row.get::<_, bool>(0))?)
}

pub(super) fn require_record(conn: &Connection, kind: &str, id: &str) -> Result<(), CliError> {
    if record_exists(conn, kind, id)? {
        Ok(())
    } else {
        Err(CliError::NotFound(format!("{kind} {id} not found")))
    }
}
