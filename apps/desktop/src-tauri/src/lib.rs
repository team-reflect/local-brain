mod commands;
mod db;
mod error;

use std::path::PathBuf;

pub use error::{AppError, AppResult};

/// Resolve the durable database path the same way the `brain` CLI does, so the
/// desktop writer and the CLI reader always agree: `$BRAIN_DB`, then the
/// platform data directory. First-run path selection lands in Plan 03/08.
fn resolve_db_path() -> PathBuf {
    if let Some(env) = std::env::var_os("BRAIN_DB") {
        if !env.is_empty() {
            return PathBuf::from(env);
        }
    }
    let base = dirs::data_dir().expect("could not resolve a platform data directory");
    base.join("local-brain").join("brain.sqlite")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = brain_schema::open_and_migrate(&resolve_db_path())
        .expect("could not open the Local Brain database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(db::DbState::new(conn))
        .invoke_handler(tauri::generate_handler![
            commands::app_version,
            db::db_query,
            db::db_execute,
            db::db_batch
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Local Brain application");
}
