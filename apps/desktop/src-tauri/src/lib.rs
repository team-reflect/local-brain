//! The Local Brain desktop shell (Tauri 2). Rust owns the durable SQLite
//! connection, the brain registry, the embedding runtime, and the keychain; the
//! React frontend reaches them only through the `#[tauri::command]` handlers
//! registered in [`run`]. The same `brain-schema` crate backs both this shell
//! and the `brain` CLI sidecar, so the desktop writer and CLI reader never skew
//! on schema or SQLite version.

mod brains;
mod commands;
mod db;
mod embed;
mod error;
mod fs;
mod keychain;

pub use error::{AppError, AppResult};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Resolve which brain root to open: `$BRAIN_ROOT`, then the registry's last
    // active root. If neither exists we start without a database and let the
    // chooser drive the first open, matching Reflect Open's startup lifecycle.
    let brains = brains::BrainState::load();
    let db_state = if let Some(active_root) = brains.active_root_candidate() {
        match brains::open_root_for_brain(&brains, &active_root) {
            Ok((paths, conn)) => {
                let _ = brains.register_active(&paths.root_path, None);
                db::DbState::new(conn, paths)
            }
            Err(_) => db::DbState::empty(),
        }
    } else {
        db::DbState::empty()
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(db_state)
        .manage(brains)
        .manage(embed::EmbedState::default())
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
