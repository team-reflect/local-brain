//! Durable SQLite schema and open/migrate helpers, shared by the desktop app
//! and the `brain` CLI so the writer and reader can never skew on schema or
//! SQLite version.
//!
//! Unlike Reflect Open's index (a disposable projection of markdown), this
//! database is durable user data. Only derived tables (content chunks, FTS,
//! vectors) are rebuildable; the product tables are the source of truth.

use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};

/// Bumped whenever a migration is appended below. Asserted against the applied
/// `user_version` in tests so the constant can never drift from the list.
pub const LATEST_SCHEMA_VERSION: usize = 1;

/// Ordered schema migrations, embedded from `migrations/*.sql`.
static MIGRATIONS: LazyLock<Migrations<'static>> =
    LazyLock::new(|| Migrations::new(vec![M::up(include_str!("../migrations/0001_init.sql"))]));

/// A schema/open/migrate failure, surfaced to the desktop app and CLI.
#[derive(Debug)]
pub enum SchemaError {
    Open(String),
    Pragma(String),
    Migration(String),
}

impl std::fmt::Display for SchemaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SchemaError::Open(message) => write!(f, "could not open the database: {message}"),
            SchemaError::Pragma(message) => {
                write!(f, "could not configure the database: {message}")
            }
            SchemaError::Migration(message) => {
                write!(f, "could not migrate the database: {message}")
            }
        }
    }
}

impl std::error::Error for SchemaError {}

/// Apply the connection settings the desktop app and CLI must share so they can
/// safely coexist on the same database file (WAL + a busy timeout).
fn configure(conn: &Connection) -> Result<(), SchemaError> {
    conn.busy_timeout(Duration::from_millis(5000))
        .map_err(|err| SchemaError::Pragma(err.to_string()))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;\
         PRAGMA foreign_keys = ON;\
         PRAGMA synchronous = NORMAL;",
    )
    .map_err(|err| SchemaError::Pragma(err.to_string()))?;
    Ok(())
}

/// Bring a connection up to the latest schema version (a no-op if current).
pub fn migrate(conn: &mut Connection) -> Result<(), SchemaError> {
    MIGRATIONS
        .to_latest(conn)
        .map_err(|err| SchemaError::Migration(err.to_string()))
}

/// Open (creating if needed) and migrate the durable brain database at `path`.
pub fn open_and_migrate(path: &Path) -> Result<Connection, SchemaError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| SchemaError::Open(err.to_string()))?;
    }
    let mut conn = Connection::open(path).map_err(|err| SchemaError::Open(err.to_string()))?;
    configure(&conn)?;
    migrate(&mut conn)?;
    Ok(conn)
}

/// Open an in-memory database migrated to the latest schema. Test helper.
pub fn open_in_memory() -> Result<Connection, SchemaError> {
    let mut conn =
        Connection::open_in_memory().map_err(|err| SchemaError::Open(err.to_string()))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|err| SchemaError::Pragma(err.to_string()))?;
    migrate(&mut conn)?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_well_formed() {
        assert!(MIGRATIONS.validate().is_ok());
    }

    #[test]
    fn migrates_empty_database() {
        let conn = open_in_memory().unwrap();
        let value: String = conn
            .query_row(
                "SELECT value FROM schema_meta WHERE key = 'app'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(value, "local-brain");
    }

    #[test]
    fn latest_version_matches_migrations() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, LATEST_SCHEMA_VERSION as i64);
    }

    #[test]
    fn migrate_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        migrate(&mut conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM schema_meta", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn open_and_migrate_creates_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("brain.sqlite");
        let _conn = open_and_migrate(&path).unwrap();
        assert!(path.exists());
    }
}
