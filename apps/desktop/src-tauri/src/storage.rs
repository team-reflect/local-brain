//! Native storage primitives for Settings → Backup & Export (Plan 08).
//!
//! - [`backup_database`] makes a consistent, verified, atomically-published
//!   SQLite snapshot (see [`DbState::backup_to`](crate::db::DbState)).
//! - [`write_file_atomic`] writes a generated artifact (e.g. the JSON export
//!   assembled in TypeScript) via a temp file + rename, so a partial write can
//!   never leave a corrupt file at the destination.
//!
//! TypeScript owns *what* to export (it knows the schema); Rust owns the durable
//! connection and the atomic file write.

use std::path::PathBuf;

use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::error::{AppError, AppResult};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    path: String,
    schema_version: i64,
    size_bytes: u64,
}

/// Create a consistent SQLite backup at `dest`. The write is atomic and the
/// snapshot is integrity-checked before it is published.
#[tauri::command]
pub fn backup_database(state: State<'_, DbState>, dest: String) -> AppResult<BackupInfo> {
    let path = PathBuf::from(&dest);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let schema_version = state.backup_to(&path)?;
    let size_bytes = std::fs::metadata(&path)?.len();
    Ok(BackupInfo {
        path: path.display().to_string(),
        schema_version,
        size_bytes,
    })
}

/// Write `contents` to `dest` atomically (temp file + rename). Used by the JSON
/// export, which is assembled in TypeScript and handed here as a string.
#[tauri::command]
pub fn write_file_atomic(dest: String, contents: String) -> AppResult<u64> {
    let path = PathBuf::from(&dest);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let tmp = path.with_extension("export-tmp");
    std::fs::write(&tmp, contents.as_bytes())?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        AppError::from(e)
    })?;
    Ok(contents.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_publishes_full_contents_and_leaves_no_temp() {
        let dir = std::env::temp_dir().join(format!("lb-export-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("export.json");
        let n =
            write_file_atomic(dest.to_str().unwrap().to_string(), "{\"ok\":true}".into()).unwrap();
        assert_eq!(n, 11);
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "{\"ok\":true}");
        assert!(!dest.with_extension("export-tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
