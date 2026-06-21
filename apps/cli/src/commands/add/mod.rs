//! Write commands: `brain add person|asset|document|interaction|task` and
//! `brain remember`. Each write runs in a single transaction (record + derived
//! chunks + links), mirroring the app's ingest paths so provenance and dedupe
//! behave identically regardless of which tool wrote the record.
//!
//! Module layout:
//! - [`text`] — pure string normalization shared across writers.
//! - [`identity`] — sources, content-hash dedupe, and `external_identities`.
//! - [`links`] — chunk + typed-link writers for documents/interactions.
//! - [`person`] / [`person_import`] — person writes and untrusted-name guardrails.
//! - [`asset`], [`document`], [`interaction`], [`project`], [`task`],
//!   [`memory`] — one entity per module, each with its own tests.

mod affiliation;
mod asset;
mod document;
mod identity;
mod interaction;
mod links;
mod memory;
mod organization;
mod person;
mod person_import;
mod project;
mod suggestion;
mod task;
mod text;

use rusqlite::{types::Value as SqlValue, Connection};
use serde_json::json;

use crate::error::CliError;
use crate::output::print_json;

/// Fill blank (`NULL` or whitespace-only) columns on the row `id` in `table` from
/// optional new values, leaving already-set columns untouched, and bump
/// `updated_at` only when at least one column was actually blank. Each
/// `(column, value)` pair fills `column` when it is currently blank and `value`
/// is `Some`; a `None` value contributes neither a SET clause nor an `updated_at`
/// term. A no-op when every value is `None`.
///
/// This is the single source of the blank-only enrichment idiom the duplicate
/// import paths share, so the per-column fill rule and the `updated_at` bump can
/// never drift out of sync the way the hand-written `CASE` statements could.
/// Values must already be normalized (a `Some("")` would be written verbatim).
pub(super) fn fill_blanks(
    conn: &Connection,
    table: &str,
    id: &str,
    fields: &[(&str, Option<String>)],
) -> Result<(), CliError> {
    // A `None` value can never fill anything, so drop it before building the SQL:
    // every remaining value is real, which means each column's `?n IS NOT NULL`
    // guard is implied and the `updated_at` term reduces to the blank check alone.
    let present: Vec<(&str, &str)> = fields
        .iter()
        .filter_map(|(column, value)| value.as_deref().map(|value| (*column, value)))
        .collect();
    if present.is_empty() {
        return Ok(());
    }
    let mut set_clauses: Vec<String> = Vec::with_capacity(present.len() + 1);
    let mut blank_checks: Vec<String> = Vec::with_capacity(present.len());
    let mut params: Vec<SqlValue> = Vec::with_capacity(present.len() + 1);
    for (index, (column, value)) in present.iter().enumerate() {
        let blank = format!("({column} IS NULL OR trim({column}) = '')");
        set_clauses.push(format!(
            "{column} = CASE WHEN {blank} THEN ?{} ELSE {column} END",
            index + 1
        ));
        blank_checks.push(blank);
        params.push(SqlValue::from((*value).to_string()));
    }
    set_clauses.push(format!(
        "updated_at = CASE WHEN {} THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE updated_at END",
        blank_checks.join(" OR ")
    ));
    params.push(SqlValue::from(id.to_string()));
    let sql = format!(
        "UPDATE {table} SET {} WHERE id = ?{}",
        set_clauses.join(", "),
        present.len() + 1
    );
    conn.execute(&sql, rusqlite::params_from_iter(params))?;
    Ok(())
}

pub use affiliation::{affiliate, AffiliateArgs};
pub use asset::{add_asset, set_asset_text, AddAssetArgs};
pub use document::{add_document, AddDocumentArgs};
pub use interaction::{add_interaction, AddInteractionArgs};
pub use memory::{remember, RememberArgs};
pub use organization::{add_organization, AddOrganizationArgs};
pub use person::{
    add_person, add_person_from_email, set_self, show_self, AddPersonArgs, AddPersonFromEmailArgs,
    SetSelfArgs,
};
pub use project::{add_project, AddProjectArgs};
pub use suggestion::{
    accept_suggestion, dismiss_suggestion, list_suggestions, suggest, SuggestArgs, SuggestionKind,
};
pub use task::{add_task, AddTaskArgs};

/// Find the first active (non-archived) row in `table` whose `name_col`,
/// normalized by `normalize`, equals the normalized `target`. Rows are scanned in
/// creation order so the oldest match wins. Used for name-based dedupe where the
/// comparison key can't be expressed in SQL (diacritic folding, whitespace
/// squishing), so candidates are normalized in Rust. Returns `None` when `target`
/// normalizes to empty or no row matches.
///
/// Note: this is an O(active rows) scan on every name-deduped write; acceptable at
/// current scale, but a stored indexed normalized-name column is the eventual fix.
pub(super) fn find_by_normalized_name(
    conn: &Connection,
    table: &str,
    name_col: &str,
    target: &str,
    normalize: impl Fn(&str) -> String,
) -> Result<Option<String>, CliError> {
    let key = normalize(target);
    if key.is_empty() {
        return Ok(None);
    }
    let sql = format!(
        "SELECT id, {name_col} FROM {table}
         WHERE archived_at IS NULL
         ORDER BY created_at ASC, id ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (id, candidate) = row?;
        if normalize(&candidate) == key {
            return Ok(Some(id));
        }
    }
    Ok(None)
}

/// Report a freshly-written or deduped typed record (person/organization/
/// project): `{kind, id, isDuplicate}` JSON, or a one-line human summary.
/// `dup_suffix` is the parenthetical for a duplicate, e.g. "duplicate, skipped"
/// or "duplicate, enriched".
pub(super) fn report_entity(
    json: bool,
    kind: &str,
    id: &str,
    duplicate: bool,
    dup_suffix: &str,
) -> Result<(), CliError> {
    if json {
        print_json(&json!({
            "kind": kind,
            "id": id,
            "isDuplicate": duplicate,
        }))
    } else {
        if duplicate {
            println!("{kind} {id} ({dup_suffix})");
        } else {
            println!("{kind} {id}");
        }
        Ok(())
    }
}

/// Report a freshly-written or deduped record (document/interaction): JSON on the
/// data channel, or a one-line human summary.
pub(super) fn report_record(
    json: bool,
    kind: &str,
    id: &str,
    duplicate: bool,
    chunk_count: usize,
) -> Result<(), CliError> {
    if json {
        print_json(&json!({
            "kind": kind,
            "id": id,
            "isDuplicate": duplicate,
            "chunkCount": chunk_count,
        }))
    } else {
        if duplicate {
            println!("{kind} {id} (duplicate, skipped)");
        } else {
            println!("{kind} {id} ({chunk_count} chunks)");
        }
        Ok(())
    }
}
