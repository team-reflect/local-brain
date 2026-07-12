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

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as JsonValue};
use tauri::State;

use crate::error::{AppError, AppResult};
use query::{bind, run_query};

/// The currently open brain: its durable connection plus the path it was opened
/// from. Kept together so a brain switch swaps both atomically under one lock.
struct Active {
    conn: Connection,
    paths: brain_schema::BrainPaths,
}

/// The process-wide active brain, serialized behind a mutex so the desktop's
/// command thread pool can share one writer safely. Switching brains (see
/// [`crate::brains`]) replaces the connection in place. Unguarded work follows
/// that active connection; identity-guarded work prepared earlier is rejected.
pub struct DbState {
    active: Mutex<Option<Active>>,
    generation: AtomicU64,
    startup_error: Mutex<Option<String>>,
}

/// Stable identity of one open database connection. The generation changes on
/// every swap/close, so switching away and back to the same path cannot make an
/// old asynchronous write appear current again.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveDatabaseIdentity {
    pub database_path: String,
    pub generation: u64,
}

pub(crate) trait IntoActivePaths {
    fn into_active_paths(self) -> brain_schema::BrainPaths;
}

impl IntoActivePaths for brain_schema::BrainPaths {
    fn into_active_paths(self) -> brain_schema::BrainPaths {
        self
    }
}

impl IntoActivePaths for PathBuf {
    fn into_active_paths(self) -> brain_schema::BrainPaths {
        let root = self
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| self.clone());
        let mut paths = brain_schema::BrainPaths::for_root(root);
        paths.database_path = self;
        paths
    }
}

impl IntoActivePaths for &std::path::Path {
    fn into_active_paths(self) -> brain_schema::BrainPaths {
        self.to_path_buf().into_active_paths()
    }
}

impl IntoActivePaths for &PathBuf {
    fn into_active_paths(self) -> brain_schema::BrainPaths {
        self.to_path_buf().into_active_paths()
    }
}

impl DbState {
    pub fn new(conn: Connection, paths: impl IntoActivePaths) -> Self {
        Self {
            active: Mutex::new(Some(Active {
                conn,
                paths: paths.into_active_paths(),
            })),
            generation: AtomicU64::new(1),
            startup_error: Mutex::new(None),
        }
    }

    pub fn empty() -> Self {
        Self {
            active: Mutex::new(None),
            generation: AtomicU64::new(0),
            startup_error: Mutex::new(None),
        }
    }

    pub fn empty_with_startup_error(message: impl Into<String>) -> Self {
        Self {
            active: Mutex::new(None),
            generation: AtomicU64::new(0),
            startup_error: Mutex::new(Some(message.into())),
        }
    }

    fn lock(&self) -> AppResult<MutexGuard<'_, Option<Active>>> {
        self.active
            .lock()
            .map_err(|_| AppError::io("the database lock was poisoned by an earlier panic"))
    }

    fn no_active() -> AppError {
        AppError::no_database("choose a Local Brain folder to open a database")
    }

    /// The startup brain-load failure, if the remembered brain could not open.
    pub fn startup_error(&self) -> AppResult<Option<String>> {
        self.startup_error
            .lock()
            .map(|message| message.clone())
            .map_err(|_| {
                AppError::io("the startup database error lock was poisoned by an earlier panic")
            })
    }

    /// The paths of the currently open brain.
    pub fn active_paths(&self) -> AppResult<brain_schema::BrainPaths> {
        self.lock()?
            .as_ref()
            .map(|active| active.paths.clone())
            .ok_or_else(Self::no_active)
    }

    /// The database path of the currently open brain.
    pub fn active_database_path(&self) -> AppResult<PathBuf> {
        Ok(self.active_paths()?.database_path)
    }

    /// The path plus monotonic connection generation used to bind asynchronous
    /// derived-index work to the brain it was prepared against.
    pub fn active_database_identity(&self) -> AppResult<ActiveDatabaseIdentity> {
        let guard = self.lock()?;
        let active = guard.as_ref().ok_or_else(Self::no_active)?;
        Ok(ActiveDatabaseIdentity {
            database_path: active.paths.database_path.display().to_string(),
            generation: self.generation.load(Ordering::SeqCst),
        })
    }

    fn ensure_expected_identity(
        &self,
        active: &Active,
        expected_database_path: &str,
        expected_generation: u64,
    ) -> AppResult<()> {
        let current_generation = self.generation.load(Ordering::SeqCst);
        if active.paths.database_path.as_path() != Path::new(expected_database_path)
            || current_generation != expected_generation
        {
            return Err(AppError::stale(
                "the active brain changed while database work was in flight",
            ));
        }
        Ok(())
    }

    /// The root path of the currently open brain.
    pub fn active_root_path(&self) -> AppResult<PathBuf> {
        Ok(self.active_paths()?.root_path)
    }

    /// The applied schema version of the open brain.
    pub fn schema_version(&self) -> AppResult<i64> {
        let guard = self.lock()?;
        let active = guard.as_ref().ok_or_else(Self::no_active)?;
        brain_schema::schema_version(&active.conn).map_err(AppError::from)
    }

    /// Run `before_swap` while holding the active database lock, then replace
    /// the open connection. This lets callers that must coordinate another
    /// durable store fail before mutating that store when the DB lock itself is
    /// unavailable.
    pub fn swap_after<F>(
        &self,
        conn: Connection,
        paths: impl IntoActivePaths,
        before_swap: F,
    ) -> AppResult<()>
    where
        F: FnOnce() -> AppResult<()>,
    {
        let mut guard = self.lock()?;
        before_swap()?;
        self.generation.fetch_add(1, Ordering::SeqCst);
        *guard = Some(Active {
            conn,
            paths: paths.into_active_paths(),
        });
        if let Ok(mut startup_error) = self.startup_error.lock() {
            *startup_error = None;
        }
        Ok(())
    }

    /// Run `before_clear` while holding the active database lock, then close the
    /// open brain. This is the active-brain counterpart to [`swap_after`]: a
    /// caller can persist its registry update first, and a persistence failure
    /// leaves the live connection untouched.
    pub fn clear_after<F>(&self, before_clear: F) -> AppResult<()>
    where
        F: FnOnce() -> AppResult<()>,
    {
        let mut guard = self.lock()?;
        before_clear()?;
        *guard = None;
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut startup_error) = self.startup_error.lock() {
            *startup_error = None;
        }
        Ok(())
    }

    /// Run a transaction only if the active database still has the exact
    /// identity captured by the caller. The comparison and mutation share the
    /// same active-state lock, closing the check/write race with brain switches.
    pub fn with_expected_connection_mut<T>(
        &self,
        expected_database_path: &str,
        expected_generation: u64,
        f: impl FnOnce(&Connection) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut guard = self.lock()?;
        let active = guard.as_mut().ok_or_else(Self::no_active)?;
        self.ensure_expected_identity(active, expected_database_path, expected_generation)?;
        let tx = active.conn.transaction()?;
        let result = f(&tx)?;
        tx.commit()?;
        Ok(result)
    }

    #[cfg(test)]
    pub fn active_path(&self) -> AppResult<PathBuf> {
        self.active_database_path()
    }

    #[cfg(test)]
    pub fn poison_for_test(&self) {
        let _ = std::panic::catch_unwind(|| {
            let _guard = self.active.lock().unwrap();
            panic!("poison database lock for test");
        });
    }
}

fn expected_identity(
    expected_database_path: Option<String>,
    expected_generation: Option<u64>,
) -> AppResult<Option<(String, u64)>> {
    match (expected_database_path, expected_generation) {
        (None, None) => Ok(None),
        (Some(path), Some(generation)) => Ok(Some((path, generation))),
        _ => Err(AppError::parse(
            "expectedDatabasePath and expectedGeneration must be provided together",
        )),
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

/// Capture the exact active connection for an asynchronous guarded operation.
#[tauri::command]
pub fn active_database_identity(state: State<'_, DbState>) -> AppResult<ActiveDatabaseIdentity> {
    state.active_database_identity()
}

/// Run a read-only Kysely query. When the expected path and generation are
/// supplied as a pair, reject the query if that brain is no longer active.
#[tauri::command]
pub fn db_query(
    state: State<'_, DbState>,
    sql: String,
    params: Vec<JsonValue>,
    expected_database_path: Option<String>,
    expected_generation: Option<u64>,
) -> AppResult<Vec<Map<String, JsonValue>>> {
    let guard = state.lock()?;
    let active = guard.as_ref().ok_or_else(DbState::no_active)?;
    if let Some((path, generation)) =
        expected_identity(expected_database_path, expected_generation)?
    {
        state.ensure_expected_identity(active, &path, generation)?;
    }
    run_query(&active.conn, &sql, &params)
}

/// Run one write statement. An optional expected path + generation pair binds
/// the transaction to the captured brain and rejects stale work.
#[tauri::command]
pub fn db_execute(
    state: State<'_, DbState>,
    sql: String,
    params: Vec<JsonValue>,
    expected_database_path: Option<String>,
    expected_generation: Option<u64>,
) -> AppResult<usize> {
    match expected_identity(expected_database_path, expected_generation)? {
        Some((path, generation)) => state.with_expected_connection_mut(&path, generation, |conn| {
            run_execute(conn, &sql, &params)
        }),
        None => {
            let guard = state.lock()?;
            let active = guard.as_ref().ok_or_else(DbState::no_active)?;
            run_execute(&active.conn, &sql, &params)
        }
    }
}

/// Run a transaction-scoped write batch, optionally rejecting it unless the
/// expected path + generation still identifies the active brain.
#[tauri::command]
pub fn db_batch(
    state: State<'_, DbState>,
    statements: Vec<DbStatement>,
    expected_database_path: Option<String>,
    expected_generation: Option<u64>,
) -> AppResult<Vec<usize>> {
    let mut guard = state.lock()?;
    let active = guard.as_mut().ok_or_else(DbState::no_active)?;
    if let Some((path, generation)) =
        expected_identity(expected_database_path, expected_generation)?
    {
        state.ensure_expected_identity(active, &path, generation)?;
    }
    run_batch(&mut active.conn, &statements)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn db() -> Connection {
        brain_schema::open_in_memory().expect("in-memory database")
    }

    fn paths(root: PathBuf) -> brain_schema::BrainPaths {
        brain_schema::BrainPaths::for_root(root)
    }

    #[test]
    fn swap_switches_the_active_brain() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first.sqlite");
        let second = dir.path().join("second.sqlite");
        let state = DbState::new(
            brain_schema::open_and_migrate(&first).unwrap(),
            paths(first.parent().unwrap().join("first")),
        );

        // A row written to the first brain.
        {
            let guard = state.lock().unwrap();
            insert_person(&guard.as_ref().unwrap().conn, "p1", "Ada").unwrap();
        }
        assert_eq!(
            state.active_root_path().unwrap(),
            first.parent().unwrap().join("first")
        );

        // After switching, the second brain is empty and the path updates.
        state
            .swap_after(
                brain_schema::open_and_migrate(&second).unwrap(),
                paths(second.parent().unwrap().join("second")),
                || Ok(()),
            )
            .unwrap();
        assert_eq!(
            state.active_root_path().unwrap(),
            second.parent().unwrap().join("second")
        );
        let guard = state.lock().unwrap();
        let rows = run_query(
            &guard.as_ref().unwrap().conn,
            "SELECT count(*) AS n FROM people",
            &[],
        )
        .unwrap();
        assert_eq!(rows[0]["n"], json!(0), "the new brain has no rows");
    }

    #[test]
    fn expected_connection_rejects_switches_and_same_path_reopens() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("brain");
        let paths = paths(root.clone());
        let state = DbState::new(db(), paths.clone());
        let first = state.active_database_identity().unwrap();

        state
            .with_expected_connection_mut(&first.database_path, first.generation, |conn| {
                insert_person(conn, "p1", "Ada")?;
                Ok(())
            })
            .unwrap();

        // Reopening even the same path gets a new generation. Path-only guards
        // would accept this ABA switch and let old async work mutate the new
        // connection.
        state.swap_after(db(), paths, || Ok(())).unwrap();
        let second = state.active_database_identity().unwrap();
        assert_eq!(second.database_path, first.database_path);
        assert_ne!(second.generation, first.generation);

        let stale =
            state.with_expected_connection_mut(&first.database_path, first.generation, |_conn| {
                Ok(())
            });
        assert!(matches!(stale, Err(AppError::Stale { .. })));
    }

    #[test]
    fn swap_clears_startup_error() {
        let state = DbState::empty_with_startup_error("could not open remembered brain");
        assert_eq!(
            state.startup_error().unwrap().as_deref(),
            Some("could not open remembered brain")
        );

        state
            .swap_after(db(), paths(PathBuf::from("/tmp/remembered")), || Ok(()))
            .unwrap();

        assert_eq!(state.startup_error().unwrap(), None);
    }

    #[test]
    fn clear_after_closes_active_brain_and_clears_startup_error() {
        let state = DbState::new(db(), paths(PathBuf::from("/tmp/active")));

        state.clear_after(|| Ok(())).unwrap();

        assert!(state.active_paths().is_err());
        assert_eq!(state.startup_error().unwrap(), None);
    }

    #[test]
    fn clear_after_keeps_active_brain_when_callback_fails() {
        let state = DbState::new(db(), paths(PathBuf::from("/tmp/active")));

        let result = state.clear_after(|| Err(AppError::io("registry write failed")));

        assert!(result.is_err());
        assert_eq!(
            state.active_root_path().unwrap(),
            PathBuf::from("/tmp/active")
        );
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
