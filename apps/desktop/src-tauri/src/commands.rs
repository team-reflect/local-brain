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
/// wrapper in `@local-brain/core`. It is the only command in Plan 01; real
/// domain commands (`db_query`, record CRUD) arrive with Plan 02.
#[tauri::command]
pub fn app_version() -> AppResult<AppInfo> {
    Ok(AppInfo {
        name: "Local Brain".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
    })
}
