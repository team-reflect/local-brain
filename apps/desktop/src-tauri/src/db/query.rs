//! Read path for the IPC bridge.

use rusqlite::Connection;
use serde_json::{Map, Value as JsonValue};

use super::convert::{json_to_sql, sql_to_json};
use crate::error::{AppError, AppResult};

/// Bind a slice of JSON params to SQLite values.
pub(super) fn bind(params: &[JsonValue]) -> AppResult<Vec<rusqlite::types::Value>> {
    params.iter().map(json_to_sql).collect()
}

/// Run a read-only query and return its rows as JSON objects keyed by column
/// name. Rejects any statement that would write the durable database — the read
/// path must never mutate it (writes go through `db_execute`/`db_batch`).
pub fn run_query(
    conn: &Connection,
    sql: &str,
    params: &[JsonValue],
) -> AppResult<Vec<Map<String, JsonValue>>> {
    let mut stmt = conn.prepare(sql)?;
    if !stmt.readonly() {
        return Err(AppError::io("db_query only runs read-only statements"));
    }

    let columns: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|c| (*c).to_string())
        .collect();
    let bound = bind(params)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(bound))?;

    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut object = Map::with_capacity(columns.len());
        for (index, name) in columns.iter().enumerate() {
            object.insert(name.clone(), sql_to_json(row.get_ref(index)?)?);
        }
        out.push(object);
    }
    Ok(out)
}
