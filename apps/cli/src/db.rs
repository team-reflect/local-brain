//! Database resolution and opening for the CLI. The CLI opens the SQLite file
//! directly (no Tauri IPC) via the shared `brain-schema` crate, so it runs with
//! the desktop app closed and always at the same migration version. WAL + a busy
//! timeout (set by `open_and_migrate`) let it tolerate a concurrent desktop
//! writer.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::error::CliError;

/// Resolve the database path: `--db` flag, then `$BRAIN_DB`, then the platform
/// data directory (`<data>/local-brain/brain.sqlite`).
pub fn resolve_db_path(flag: Option<&Path>) -> Result<PathBuf, CliError> {
    if let Some(path) = flag {
        return Ok(path.to_path_buf());
    }
    if let Some(env) = std::env::var_os("BRAIN_DB") {
        if !env.is_empty() {
            return Ok(PathBuf::from(env));
        }
    }
    let base = dirs::data_dir()
        .ok_or_else(|| CliError::NoDatabase("could not resolve a data directory".to_string()))?;
    Ok(base.join("local-brain").join("brain.sqlite"))
}

/// Open + migrate the database at `path`. Creates the file/parent dir if needed.
pub fn open(path: &Path) -> Result<Connection, CliError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| {
                CliError::NoDatabase(format!("could not create {}: {e}", parent.display()))
            })?;
        }
    }
    Ok(brain_schema::open_and_migrate(path)?)
}

/// Open a database that must already exist (read commands). Errors clearly when
/// there is no brain database rather than silently creating an empty one.
pub fn open_existing(path: &Path) -> Result<Connection, CliError> {
    if !path.is_file() {
        return Err(CliError::NoDatabase(format!(
            "no brain database at {} (run `brain add …` or open the app to create one)",
            path.display()
        )));
    }
    open(path)
}

/// The live schema version (`PRAGMA user_version`).
pub fn schema_version(conn: &Connection) -> Result<i64, CliError> {
    Ok(conn.query_row("PRAGMA user_version", [], |row| row.get(0))?)
}
