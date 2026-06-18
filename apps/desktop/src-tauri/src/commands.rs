use serde::Serialize;

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

/// The resolved durable database path, for Settings → Local database / Diagnostics.
#[tauri::command]
pub fn database_path() -> AppResult<String> {
    Ok(crate::resolve_db_path().display().to_string())
}
