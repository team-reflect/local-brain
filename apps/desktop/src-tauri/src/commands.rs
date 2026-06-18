use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::error::AppResult;

/// Basic app identity, surfaced to the foundation UI. Serialized camelCase to
/// match the zod schema the frontend validates against.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
}

/// Diagnostic command exercised by the foundation UI through the typed IPC
/// wrapper in `@local-brain/core`.
#[tauri::command]
pub fn app_version() -> AppResult<AppInfo> {
    Ok(AppInfo {
        name: "Local Brain".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
    })
}

/// The path of the currently open brain, for Settings → Local database /
/// Diagnostics. Reads the live active path so it stays correct after a brain
/// switch (rather than recomputing the startup default).
#[tauri::command]
pub fn database_path(db: State<'_, DbState>) -> AppResult<String> {
    Ok(db.active_path()?.display().to_string())
}
