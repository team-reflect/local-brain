mod brains;
mod commands;
mod db;
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
    // Resolve which brain to open: the registry's last active brain (or
    // `$BRAIN_DB` / the default) — see `brains::BrainState`. The default path
    // only fixes where `registry.sqlite` lands when no platform data dir resolves.
    let default_db_path = resolve_db_path();
    let brains = brains::BrainState::load(&default_db_path);
    let active = brains.active_candidate(&default_db_path);
    let conn =
        brain_schema::open_and_migrate(&active).expect("could not open the Local Brain database");
    let canonical = active.canonicalize().unwrap_or(active);
    // Record the opened brain in the catalogue (non-fatal if it can't persist).
    let _ = brains.register_active(&canonical, None);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(db::DbState::new(conn, canonical))
        .manage(brains)
        .invoke_handler(tauri::generate_handler![
            commands::app_version,
            commands::database_path,
            db::db_query,
            db::db_execute,
            db::db_batch,
            brains::list_brains,
            brains::active_brain,
            brains::open_brain,
            brains::create_brain,
            brains::rename_brain,
            brains::set_brain_color,
            brains::forget_brain,
            brains::reveal_brain,
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
