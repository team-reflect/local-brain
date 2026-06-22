//! Database resolution and opening for the CLI. The CLI opens the SQLite file
//! directly (no Tauri IPC) via the shared `brain-schema` crate, so it runs with
//! the desktop app closed and always at the same migration version. WAL + a busy
//! timeout (set by `open_and_migrate`) let it tolerate a concurrent desktop
//! writer.

use std::path::{Path, PathBuf};

use rusqlite::functions::FunctionFlags;
use rusqlite::Connection;

use crate::commands::add::text::normalize_phone;
use crate::error::CliError;

#[derive(Debug, Clone)]
pub struct StoragePaths {
    pub root_path: Option<PathBuf>,
    pub database_path: PathBuf,
    pub assets_path: Option<PathBuf>,
}

/// Resolve storage paths: `--db` wins as an exact-file override, then `--brain`
/// / `$BRAIN_ROOT` derive the standard folder layout, then the advanced
/// `$BRAIN_DB` exact-file override remains available for dev and diagnostics.
pub fn resolve_storage(
    brain_flag: Option<&Path>,
    db_flag: Option<&Path>,
) -> Result<StoragePaths, CliError> {
    if let Some(path) = db_flag {
        return Ok(StoragePaths {
            root_path: None,
            database_path: path.to_path_buf(),
            assets_path: None,
        });
    }

    if let Some(root) = brain_flag
        .map(Path::to_path_buf)
        .or_else(brain_schema::resolve_brain_root)
    {
        let paths = brain_schema::bootstrap_brain_root(&root)?;
        return Ok(StoragePaths {
            root_path: Some(paths.root_path),
            database_path: paths.database_path,
            assets_path: Some(paths.assets_path),
        });
    }

    let database_path = brain_schema::resolve_db_path().ok_or_else(|| {
        CliError::NoDatabase(
            "no brain selected; pass --brain <dir>, set BRAIN_ROOT, pass --db <path>, or set BRAIN_DB"
                .to_string(),
        )
    })?;
    Ok(StoragePaths {
        root_path: None,
        database_path,
        assets_path: None,
    })
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
    let conn = brain_schema::open_and_migrate(path)?;
    register_sql_functions(&conn)?;
    Ok(conn)
}

/// Register CLI-side SQL helper functions on the connection. `normalize_phone`
/// mirrors the Rust [`normalize_phone`] exactly, so ownership/dedup checks can
/// normalize the denormalized `people.primary_phone` column (which has no stored
/// normalized form) without drifting from the handle table's `normalized_phone`.
fn register_sql_functions(conn: &Connection) -> Result<(), CliError> {
    conn.create_scalar_function(
        "normalize_phone",
        1,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            let raw = ctx.get::<Option<String>>(0)?;
            Ok(normalize_phone(raw.as_deref()))
        },
    )?;
    Ok(())
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
