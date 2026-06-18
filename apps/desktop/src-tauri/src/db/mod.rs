//! The Tauri-owned SQLite bridge.
//!
//! Rust owns the single durable connection (WAL + busy timeout, configured by
//! `brain-schema`). The frontend's Kysely instance compiles SQL and sends it
//! here: reads via [`db_query`], single writes via [`db_execute`], and
//! multi-table writes via [`db_batch`], which wraps every statement in one
//! transaction so a partial failure rolls back. All commands return the shared
//! serializable [`AppError`](crate::error::AppError).

mod convert;
mod query;

use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{Map, Value as JsonValue};
use tauri::State;

use crate::error::{AppError, AppResult};
use query::{bind, run_query};

/// The process-wide durable connection, serialized behind a mutex so the
/// desktop's command thread pool can share one writer safely.
pub struct DbState {
    conn: Mutex<Connection>,
}

impl DbState {
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }

    fn lock(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|_| AppError::io("the database lock was poisoned by an earlier panic"))
    }
}

/// One statement in a [`db_batch`] request: compiled SQL plus its JSON params.
#[derive(Debug, Deserialize)]
pub struct DbStatement {
    sql: String,
    #[serde(default)]
    params: Vec<JsonValue>,
}

/// Execute a single write statement and return the number of affected rows.
pub(super) fn run_execute(conn: &Connection, sql: &str, params: &[JsonValue]) -> AppResult<usize> {
    let bound = bind(params)?;
    Ok(conn.execute(sql, rusqlite::params_from_iter(bound))?)
}

/// Execute a sequence of write statements in one transaction. Any error rolls
/// the whole batch back. Returns the affected-row count per statement.
pub(super) fn run_batch(
    conn: &mut Connection,
    statements: &[DbStatement],
) -> AppResult<Vec<usize>> {
    let tx = conn.transaction()?;
    let mut affected = Vec::with_capacity(statements.len());
    for statement in statements {
        let bound = bind(&statement.params)?;
        affected.push(tx.execute(&statement.sql, rusqlite::params_from_iter(bound))?);
    }
    tx.commit()?;
    Ok(affected)
}

/// Run a read-only Kysely query against the durable database.
#[tauri::command]
pub fn db_query(
    state: State<'_, DbState>,
    sql: String,
    params: Vec<JsonValue>,
) -> AppResult<Vec<Map<String, JsonValue>>> {
    let conn = state.lock()?;
    run_query(&conn, &sql, &params)
}

/// Run a single write statement against the durable database.
#[tauri::command]
pub fn db_execute(
    state: State<'_, DbState>,
    sql: String,
    params: Vec<JsonValue>,
) -> AppResult<usize> {
    let conn = state.lock()?;
    run_execute(&conn, &sql, &params)
}

/// Run a transaction-scoped batch of write statements.
#[tauri::command]
pub fn db_batch(state: State<'_, DbState>, statements: Vec<DbStatement>) -> AppResult<Vec<usize>> {
    let mut conn = state.lock()?;
    run_batch(&mut conn, &statements)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn db() -> Connection {
        brain_schema::open_in_memory().expect("in-memory database")
    }

    fn insert_person(conn: &Connection, id: &str, name: &str) -> AppResult<usize> {
        run_execute(
            conn,
            "INSERT INTO people (id, full_name) VALUES (?1, ?2)",
            &[json!(id), json!(name)],
        )
    }

    #[test]
    fn execute_inserts_and_query_reads_back() {
        let conn = db();
        let affected = insert_person(&conn, "p1", "Ada Lovelace").unwrap();
        assert_eq!(affected, 1);

        let rows = run_query(
            &conn,
            "SELECT id, full_name, is_self FROM people WHERE id = ?1",
            &[json!("p1")],
        )
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], json!("p1"));
        assert_eq!(rows[0]["full_name"], json!("Ada Lovelace"));
        // Booleans come back as the underlying integer (matches the Kysely types).
        assert_eq!(rows[0]["is_self"], json!(0));
    }

    #[test]
    fn query_rejects_write_statements() {
        let conn = db();
        let result = run_query(
            &conn,
            "INSERT INTO people (id, full_name) VALUES ('x', 'Mallory')",
            &[],
        );
        assert!(
            result.is_err(),
            "db_query must refuse to mutate the database"
        );
    }

    #[test]
    fn null_and_missing_columns_serialize_as_json_null() {
        let conn = db();
        insert_person(&conn, "p1", "Grace Hopper").unwrap();
        let rows = run_query(
            &conn,
            "SELECT headline FROM people WHERE id = ?1",
            &[json!("p1")],
        )
        .unwrap();
        assert_eq!(rows[0]["headline"], JsonValue::Null);
    }

    #[test]
    fn json_params_round_trip_as_text() {
        let conn = db();
        run_execute(
            &conn,
            "INSERT INTO people (id, full_name, important_dates_json) VALUES (?1, ?2, ?3)",
            &[
                json!("p1"),
                json!("Alan Turing"),
                json!({ "birthday": "06-23" }),
            ],
        )
        .unwrap();
        let rows = run_query(
            &conn,
            "SELECT important_dates_json FROM people WHERE id = ?1",
            &[json!("p1")],
        )
        .unwrap();
        assert_eq!(
            rows[0]["important_dates_json"],
            json!("{\"birthday\":\"06-23\"}")
        );
    }

    #[test]
    fn batch_commits_every_statement_atomically() {
        let mut conn = db();
        let affected = run_batch(
            &mut conn,
            &[
                DbStatement {
                    sql: "INSERT INTO organizations (id, name) VALUES (?1, ?2)".into(),
                    params: vec![json!("o1"), json!("Acme")],
                },
                DbStatement {
                    sql: "INSERT INTO people (id, full_name, current_organization_id) VALUES (?1, ?2, ?3)".into(),
                    params: vec![json!("p1"), json!("Wile E."), json!("o1")],
                },
            ],
        )
        .unwrap();
        assert_eq!(affected, vec![1, 1]);

        let count = run_query(&conn, "SELECT count(*) AS n FROM people", &[]).unwrap();
        assert_eq!(count[0]["n"], json!(1));
    }

    #[test]
    fn batch_rolls_back_on_failure() {
        let mut conn = db();
        let result = run_batch(
            &mut conn,
            &[
                DbStatement {
                    sql: "INSERT INTO people (id, full_name) VALUES (?1, ?2)".into(),
                    params: vec![json!("p1"), json!("Real Person")],
                },
                // Foreign-key violation: organization 'ghost' does not exist.
                DbStatement {
                    sql: "INSERT INTO affiliations (id, person_id, organization_id) VALUES (?1, ?2, ?3)".into(),
                    params: vec![json!("a1"), json!("p1"), json!("ghost")],
                },
            ],
        );
        assert!(
            result.is_err(),
            "a failing statement must roll the batch back"
        );

        let rows = run_query(&conn, "SELECT count(*) AS n FROM people", &[]).unwrap();
        assert_eq!(rows[0]["n"], json!(0), "the first insert must not persist");
    }
}
