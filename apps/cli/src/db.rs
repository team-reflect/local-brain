//! Database resolution and opening for the CLI. The CLI opens the SQLite file
//! directly (no Tauri IPC) via the shared `brain-schema` crate, so it runs with
//! the desktop app closed and always at the same migration version. WAL + a busy
//! timeout (set by `open_and_migrate`) let it tolerate a concurrent desktop
//! writer.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::error::CliError;

/// Resolve the database path: an explicit `--db` flag wins; otherwise defer to
/// the shared `$BRAIN_DB`/platform-data-dir resolution the desktop app uses too.
pub fn resolve_db_path(flag: Option<&Path>) -> Result<PathBuf, CliError> {
    if let Some(path) = flag {
        return Ok(path.to_path_buf());
    }
    brain_schema::resolve_db_path()
        .ok_or_else(|| CliError::NoDatabase("could not resolve a data directory".to_string()))
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

/// The live schema version (`PRAGMA user_version`), via the shared helper.
pub fn schema_version(conn: &Connection) -> Result<i64, CliError> {
    Ok(brain_schema::schema_version(conn)?)
}
