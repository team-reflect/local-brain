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
use crate::text::{content_hash, normalize_text, sha256_hex};

pub struct AddAssetArgs<'a> {
    pub file: &'a Path,
    pub kind: &'a str,
    pub mime_type: Option<&'a str>,
    pub original_filename: Option<&'a str>,
    pub original_url: Option<&'a str>,
    pub text: Option<String>,
    pub text_source: &'a str,
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

fn validate_asset_text_source(raw: &str) -> Result<&str, CliError> {
    match raw {
        "importer" | "local_extraction" | "manual" => Ok(raw),
        other => Err(CliError::Runtime(format!(
            "invalid asset text source '{other}' (expected importer, local_extraction, or manual)"
        ))),
    }
}

fn is_text_like_asset(mime_type: Option<&str>, filename: Option<&str>) -> bool {
    let mime = mime_type.unwrap_or("").trim().to_ascii_lowercase();
    if mime.starts_with("text/") {
        return true;
    }
    if matches!(
        mime.as_str(),
        "application/json"
            | "application/ld+json"
            | "application/xml"
            | "application/csv"
            | "application/ics"
            | "text/calendar"
    ) || mime.ends_with("+json")
        || mime.ends_with("+xml")
    {
        return true;
    }
    let Some(filename) = filename else {
        return false;
    };
    let lower = filename.to_ascii_lowercase();
    matches!(
        lower.rsplit_once('.').map(|(_, ext)| ext),
        Some("txt" | "md" | "csv" | "json" | "jsonl" | "ics" | "vcf" | "xml" | "html" | "htm")
    )
}

fn asset_text_from_bytes(bytes: &[u8]) -> Option<String> {
    std::str::from_utf8(bytes)
        .ok()
        .map(normalize_text)
        .filter(|text| !text.is_empty())
}

fn resolved_asset_text<'a>(
    explicit_text: Option<String>,
    explicit_source: &'a str,
    mime_type: Option<&str>,
    filename: Option<&str>,
    bytes: &[u8],
) -> Result<Option<(String, &'a str)>, CliError> {
    let source = validate_asset_text_source(explicit_source)?;
    if let Some(text) = explicit_text
        .map(|text| normalize_text(&text))
        .filter(|text| !text.is_empty())
    {
        return Ok(Some((text, source)));
    }
    if is_text_like_asset(mime_type, filename) {
        if let Some(text) = asset_text_from_bytes(bytes) {
            return Ok(Some((text, "local_extraction")));
        }
    }
    Ok(None)
}

fn upsert_asset_text(
    conn: &Connection,
    asset_id: &str,
    text: &str,
    source: &str,
) -> Result<bool, CliError> {
    validate_asset_text_source(source)?;
    let normalized = normalize_text(text);
    if normalized.is_empty() {
        return Ok(false);
    }
    let hash = content_hash(&normalized);
    let changed = conn.execute(
        "INSERT INTO asset_texts (asset_id, text, text_source, content_hash)
         VALUES (?1,?2,?3,?4)
         ON CONFLICT(asset_id) DO UPDATE SET
           text = excluded.text,
           text_source = excluded.text_source,
           content_hash = excluded.content_hash,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE asset_texts.content_hash IS NULL
            OR asset_texts.content_hash <> excluded.content_hash
            OR asset_texts.text_source <> excluded.text_source",
        params![asset_id, normalized, source, hash],
    )?;
    Ok(changed > 0)
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
    let original_filename = normalize_optional(args.original_filename).or_else(|| {
        args.file
            .file_name()
            .and_then(|name| name.to_str())
            .map(ToOwned::to_owned)
    });
    let asset_text = resolved_asset_text(
        args.text,
        args.text_source,
        args.mime_type,
        original_filename.as_deref(),
        &bytes,
    )?;
    if let Some(existing) = find_duplicate_asset(conn, &hash)? {
        if !args.allow_duplicate {
            ensure_asset_file(assets_path, &existing.storage_path, &bytes)?;
            let tx = conn.transaction()?;
            let linked =
                insert_asset_links(&tx, &existing.id, &args.links, args.role, args.caption)?;
            if let Some((text, source)) = asset_text.as_ref() {
                upsert_asset_text(&tx, &existing.id, text, source)?;
            }
            tx.commit()?;
            return report_asset(json, &existing.id, true, linked);
        }
    }

    let id = new_id();
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
    if let Some((text, source)) = asset_text.as_ref() {
        upsert_asset_text(&tx, &id, text, source)?;
    }
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

pub fn set_asset_text(
    conn: &mut Connection,
    json: bool,
    asset_id: &str,
    text: &str,
    source: &str,
) -> Result<(), CliError> {
    let active: i64 = conn.query_row(
        "SELECT COUNT(*) FROM assets WHERE id = ?1 AND archived_at IS NULL",
        params![asset_id],
        |row| row.get(0),
    )?;
    if active == 0 {
        return Err(CliError::NotFound(format!("asset {asset_id} not found")));
    }
    let tx = conn.transaction()?;
    let changed = upsert_asset_text(&tx, asset_id, text, source)?;
    tx.commit()?;
    if json {
        print_json(&json!({
            "kind": "assetText",
            "assetId": asset_id,
            "updated": changed,
        }))
    } else {
        println!(
            "asset text {}",
            if changed { "updated" } else { "unchanged" }
        );
        Ok(())
    }
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
