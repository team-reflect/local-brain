//! Web Inspector access for the desktop shell.
//!
//! Tauri only exposes the inspector in release builds when the `tauri`
//! dependency enables the `devtools` feature. The keyboard shortcut and native
//! menu both call this command so there is one native toggle path.

use tauri::WebviewWindow;

use crate::AppResult;

/// Open the calling window's Web Inspector, or close it if it is already open.
#[tauri::command]
pub fn toggle_devtools(window: WebviewWindow) -> AppResult<()> {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
    Ok(())
}
