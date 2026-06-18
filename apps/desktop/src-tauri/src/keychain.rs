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

/// `security` exit code for `errSecItemNotFound` — the only non-zero status that
/// means "no such item" rather than a real keychain failure (locked, denied, …).
#[cfg(target_os = "macos")]
const ERR_SEC_ITEM_NOT_FOUND: i32 = 44;

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
        } else if out.status.code() == Some(ERR_SEC_ITEM_NOT_FOUND) {
            // No item stored — the only non-zero status that means "no key".
            Ok(None)
        } else {
            // A locked keychain or denied access must surface, not look like "no key".
            Err(AppError::io(format!(
                "keychain read failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )))
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
        if out.status.success() || out.status.code() == Some(ERR_SEC_ITEM_NOT_FOUND) {
            // Deleted, or nothing was stored — both leave the account with no key.
            Ok(())
        } else {
            // A real failure (locked, denied) would leave the secret behind; surface it
            // so a "Clear key" action can't silently appear to succeed.
            Err(AppError::io(format!(
                "keychain delete failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )))
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = account;
        Ok(())
    }
}
