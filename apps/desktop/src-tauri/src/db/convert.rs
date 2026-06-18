//! JSON <-> SQLite value conversion for the IPC bridge.
//!
//! Kysely compiles queries to `{ sql, params }` where params are JSON values;
//! Rust binds them to the statement and serializes result columns back to JSON.
//! Arrays and objects round-trip as JSON text so `json()`-valued columns work.

use rusqlite::types::{Value as SqlValue, ValueRef};
use serde_json::{Number, Value as JsonValue};

use crate::error::{AppError, AppResult};

/// Bind a JSON parameter to a SQLite value.
pub fn json_to_sql(value: &JsonValue) -> AppResult<SqlValue> {
    Ok(match value {
        JsonValue::Null => SqlValue::Null,
        JsonValue::Bool(flag) => SqlValue::Integer(i64::from(*flag)),
        JsonValue::Number(number) => {
            if let Some(int) = number.as_i64() {
                SqlValue::Integer(int)
            } else if let Some(float) = number.as_f64() {
                SqlValue::Real(float)
            } else {
                return Err(AppError::parse(format!(
                    "unsupported numeric parameter: {number}"
                )));
            }
        }
        JsonValue::String(text) => SqlValue::Text(text.clone()),
        JsonValue::Array(_) | JsonValue::Object(_) => SqlValue::Text(serde_json::to_string(value)?),
    })
}

/// Serialize a SQLite result column to JSON for the IPC response.
pub fn sql_to_json(value: ValueRef<'_>) -> AppResult<JsonValue> {
    Ok(match value {
        ValueRef::Null => JsonValue::Null,
        ValueRef::Integer(int) => JsonValue::Number(Number::from(int)),
        ValueRef::Real(float) => Number::from_f64(float)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        ValueRef::Text(bytes) => JsonValue::String(String::from_utf8_lossy(bytes).into_owned()),
        ValueRef::Blob(bytes) => JsonValue::Array(
            bytes
                .iter()
                .map(|b| JsonValue::Number((*b).into()))
                .collect(),
        ),
    })
}
