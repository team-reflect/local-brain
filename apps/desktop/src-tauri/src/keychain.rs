//! Provider-key storage in the OS keychain (Plan 08 privacy boundary).
//!
//! Provider keys belong in the OS keychain, never in a `settings` row. On macOS
//! (the launch target) we shell out to the built-in `security` tool — no extra
//! crate, no network. The key is read into memory only when a model call is
//! about to be made (the desktop registers the provider from it at startup).
//!
//! The service is the app identifier; the account is the provider id (e.g.
//! `anthropic`), so multiple providers can each hold a key.

use std::process::Command;

use crate::error::{AppError, AppResult};

const SERVICE: &str = "app.localbrain.desktop";

#[cfg(target_os = "macos")]
fn run_security(args: &[&str]) -> AppResult<std::process::Output> {
    Command::new("security")
        .args(args)
        .output()
        .map_err(|e| AppError::io(format!("could not run the macOS keychain tool: {e}")))
}

/// Store (or replace) a provider key. `-U` updates an existing item in place.
#[tauri::command]
pub fn keychain_set(account: String, secret: String) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        let out = run_security(&[
            "add-generic-password",
            "-U",
            "-s",
            SERVICE,
            "-a",
            &account,
            "-w",
            &secret,
        ])?;
        if !out.status.success() {
            return Err(AppError::io(format!(
                "keychain write failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )));
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (account, secret);
        Err(AppError::io(
            "keychain storage is only implemented on macOS",
        ))
    }
}

/// Read a provider key. Returns `None` when no key is stored for the account.
#[tauri::command]
pub fn keychain_get(account: String) -> AppResult<Option<String>> {
    #[cfg(target_os = "macos")]
    {
        let out = run_security(&["find-generic-password", "-s", SERVICE, "-a", &account, "-w"])?;
        if out.status.success() {
            let secret = String::from_utf8_lossy(&out.stdout).trim_end().to_string();
            Ok(if secret.is_empty() {
                None
            } else {
                Some(secret)
            })
        } else {
            // A missing item exits non-zero; treat that as "no key", not an error.
            Ok(None)
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = account;
        Ok(None)
    }
}

/// Whether a key is stored for the account.
#[tauri::command]
pub fn keychain_has(account: String) -> AppResult<bool> {
    Ok(keychain_get(account)?.is_some())
}

/// Delete a provider key. Succeeds even if no key was stored.
#[tauri::command]
pub fn keychain_delete(account: String) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        let out = run_security(&["delete-generic-password", "-s", SERVICE, "-a", &account])?;
        let _ = out; // a missing item is fine
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = account;
        Ok(())
    }
}
