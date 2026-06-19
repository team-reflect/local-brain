//! `brain add asset` — import a binary file into the content-addressed asset
//! store. The file bytes are SHA-256 hashed for dedupe; identical content is
//! stored once and re-linked. The manifest row and links commit in one
//! transaction, and the on-disk object is reconciled so the database and the
//! `assets/` tree never disagree.

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde_json::json;

use super::text::{normalize_optional, safe_filename};
use crate::commands::LinkRef;
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;
use crate::text::sha256_hex;

pub struct AddAssetArgs<'a> {
    pub file: &'a Path,
    pub kind: &'a str,
    pub mime_type: Option<&'a str>,
    pub original_filename: Option<&'a str>,
    pub original_url: Option<&'a str>,
    pub role: &'a str,
    pub caption: Option<&'a str>,
    pub links: Vec<LinkRef>,
    pub allow_duplicate: bool,
}

struct DuplicateAsset {
    id: String,
    storage_path: String,
}

fn find_duplicate_asset(conn: &Connection, hash: &str) -> Result<Option<DuplicateAsset>, CliError> {
    let asset = conn
        .query_row(
            "SELECT id, storage_path FROM assets WHERE content_hash = ?1 AND archived_at IS NULL LIMIT 1",
            params![hash],
            |row| {
                Ok(DuplicateAsset {
                    id: row.get(0)?,
                    storage_path: row.get(1)?,
                })
            },
        )
        .ok();
    Ok(asset)
}

fn storage_path_exists(conn: &Connection, storage_path: &str) -> Result<bool, CliError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM assets WHERE storage_path = ?1",
        params![storage_path],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn asset_destination(assets_path: &Path, storage_path: &str) -> Result<PathBuf, CliError> {
    let relative = storage_path.strip_prefix("assets/").ok_or_else(|| {
        CliError::Runtime(format!(
            "invalid asset storage path '{storage_path}' (expected assets/...)"
        ))
    })?;
    Ok(assets_path.join(relative))
}

fn ensure_asset_file(assets_path: &Path, storage_path: &str, bytes: &[u8]) -> Result<(), CliError> {
    let destination = asset_destination(assets_path, storage_path)?;
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            CliError::Runtime(format!("could not create {}: {e}", parent.display()))
        })?;
    }
    let needs_write = match std::fs::read(&destination) {
        Ok(existing) => existing != bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => true,
        Err(e) => {
            return Err(CliError::Runtime(format!(
                "could not read {}: {e}",
                destination.display()
            )));
        }
    };
    if needs_write {
        std::fs::write(&destination, bytes).map_err(|e| {
            CliError::Runtime(format!("could not write {}: {e}", destination.display()))
        })?;
    }
    Ok(())
}

fn insert_asset_links(
    conn: &Connection,
    asset_id: &str,
    links: &[LinkRef],
    role: &str,
    caption: Option<&str>,
) -> Result<usize, CliError> {
    let mut inserted = 0;
    for link in links {
        let changed = conn.execute(
            "INSERT OR IGNORE INTO asset_links
             (id, asset_id, record_type, record_id, role, caption)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                new_id(),
                asset_id,
                link.kind.as_str(),
                link.id,
                normalize_optional(Some(role)),
                normalize_optional(caption),
            ],
        )?;
        inserted += changed;
    }
    Ok(inserted)
}

pub fn add_asset(
    conn: &mut Connection,
    assets_path: Option<&Path>,
    json: bool,
    args: AddAssetArgs,
) -> Result<(), CliError> {
    let Some(assets_path) = assets_path else {
        return Err(CliError::Runtime(
            "asset import requires a brain root; pass --brain <dir> or set BRAIN_ROOT".into(),
        ));
    };
    let bytes = std::fs::read(args.file)
        .map_err(|e| CliError::Runtime(format!("could not read {}: {e}", args.file.display())))?;
    let hash = sha256_hex(&bytes);
    if let Some(existing) = find_duplicate_asset(conn, &hash)? {
        if !args.allow_duplicate {
            ensure_asset_file(assets_path, &existing.storage_path, &bytes)?;
            let tx = conn.transaction()?;
            let linked =
                insert_asset_links(&tx, &existing.id, &args.links, args.role, args.caption)?;
            tx.commit()?;
            return report_asset(json, &existing.id, true, linked);
        }
    }

    let id = new_id();
    let original_filename = normalize_optional(args.original_filename).or_else(|| {
        args.file
            .file_name()
            .and_then(|name| name.to_str())
            .map(ToOwned::to_owned)
    });
    let filename = safe_filename(original_filename.as_deref().unwrap_or("asset"));
    let prefix = hash.get(0..2).unwrap_or("00");
    let default_storage_path = format!("assets/objects/{prefix}/{hash}-{filename}");
    let needs_unique_name =
        args.allow_duplicate || storage_path_exists(conn, &default_storage_path)?;
    let stored_name = if needs_unique_name {
        format!("{hash}-{id}-{filename}")
    } else {
        format!("{hash}-{filename}")
    };
    let relative_path = format!("assets/objects/{prefix}/{stored_name}");

    let original_path = args
        .file
        .canonicalize()
        .ok()
        .map(|path| path.display().to_string());
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO assets (
           id, kind, mime_type, byte_size, content_hash, storage_path,
           original_filename, original_path, original_url
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            id,
            args.kind,
            normalize_optional(args.mime_type),
            bytes.len() as i64,
            hash,
            relative_path,
            original_filename,
            original_path,
            normalize_optional(args.original_url),
        ],
    )?;
    let linked = insert_asset_links(&tx, &id, &args.links, args.role, args.caption)?;
    tx.commit()?;
    if let Err(err) = ensure_asset_file(assets_path, &relative_path, &bytes) {
        if let Err(cleanup_err) = conn.execute("DELETE FROM assets WHERE id = ?1", params![&id]) {
            return Err(CliError::Runtime(format!(
                "{err}; additionally could not remove asset manifest {id}: {cleanup_err}"
            )));
        }
        return Err(err);
    }
    report_asset(json, &id, false, linked)
}

fn report_asset(json: bool, id: &str, duplicate: bool, linked: usize) -> Result<(), CliError> {
    if json {
        print_json(&json!({
            "kind": "asset",
            "id": id,
            "isDuplicate": duplicate,
            "linkCount": linked,
        }))
    } else {
        if duplicate {
            println!("asset {id} (duplicate, linked {linked})");
        } else {
            println!("asset {id} (linked {linked})");
        }
        Ok(())
    }
}
