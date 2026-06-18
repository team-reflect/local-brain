mod commands;
mod db;
mod embed;
mod error;
mod fs;
mod keychain;

use std::path::PathBuf;

pub use error::{AppError, AppResult};

/// Resolve the durable database path via the shared `brain-schema` helper, so the
/// desktop writer and the CLI reader always agree: `$BRAIN_DB`, then the platform
/// data directory.
pub(crate) fn resolve_db_path() -> PathBuf {
    brain_schema::resolve_db_path().expect("could not resolve a platform data directory")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = brain_schema::open_and_migrate(&resolve_db_path())
        .expect("could not open the Local Brain database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(db::DbState::new(conn))
        .manage(embed::EmbedState::default())
        .invoke_handler(tauri::generate_handler![
            commands::app_version,
            commands::database_path,
            db::db_query,
            db::db_execute,
            db::db_batch,
            embed::embed_status,
            embed::embed_ensure,
            embed::embed_texts,
            embed::embed_apply,
            embed::embed_delete,
            embed::embed_clear,
            fs::read_text_file,
            fs::read_text_folder,
            keychain::keychain_set,
            keychain::keychain_get,
            keychain::keychain_has,
            keychain::keychain_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Local Brain application");
}
