//! Write commands: `brain add document|interaction|task` and `brain remember`.
//! Each write runs in a single transaction (record + derived chunks + links),
//! mirroring the app's `ingestDocument`/`ingestInteraction` so provenance and
//! dedupe behave identically regardless of which tool wrote the record.

use std::path::Path;

use rusqlite::{params, Connection};
use serde_json::json;
use sha2::{Digest, Sha256};
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

use super::{now_iso, LinkKind, LinkRef};
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;
use crate::text::{chunk_text, content_hash, normalize_text};

fn normalize_optional(raw: Option<&str>) -> Option<String> {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

/// Collapse internal whitespace runs to single spaces and trim, preserving case.
/// The Rust twin of core `squish` (`packages/core/src/text/normalize.ts`), used
/// for short display labels like titles so the CLI and app store them identically.
fn squish(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Normalize a title to its storage form (squish), collapsing blank to `None`.
/// Mirrors the core `labelOrNull` used by `validateNewDocument`/`Interaction`.
fn normalize_title(raw: Option<&str>) -> Option<String> {
    raw.map(squish).filter(|value| !value.is_empty())
}

fn normalize_email(raw: Option<&str>) -> Option<String> {
    normalize_optional(raw).map(|value| value.to_lowercase())
}

fn normalize_name(raw: &str) -> String {
    raw.to_lowercase()
        .nfkd()
        .filter(|c| !is_combining_mark(*c))
        .map(|c| {
            if c.is_alphanumeric() || c.is_whitespace() {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn safe_filename(raw: &str) -> String {
    let cleaned = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches(['.', '-'])
        .to_string();
    if cleaned.is_empty() {
        "asset".to_string()
    } else {
        cleaned
    }
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Find a non-archived record in `table` with this content hash (dedupe).
fn find_duplicate(conn: &Connection, table: &str, hash: &str) -> Result<Option<String>, CliError> {
    let sql =
        format!("SELECT id FROM {table} WHERE content_hash = ?1 AND archived_at IS NULL LIMIT 1");
    let id = conn
        .query_row(&sql, params![hash], |row| row.get::<_, String>(0))
        .ok();
    Ok(id)
}

fn insert_chunks(
    conn: &Connection,
    record_type: &str,
    record_id: &str,
    body: &str,
) -> Result<usize, CliError> {
    let chunks = chunk_text(body);
    for (index, text) in chunks.iter().enumerate() {
        conn.execute(
            "INSERT INTO content_chunks (id, record_type, record_id, chunk_index, text) VALUES (?1,?2,?3,?4,?5)",
            params![new_id(), record_type, record_id, index as i64, text],
        )?;
    }
    Ok(chunks.len())
}

/// Insert the typed link rows for a document/interaction.
fn insert_links(
    conn: &Connection,
    owner: &str,
    owner_id: &str,
    links: &[LinkRef],
) -> Result<(), CliError> {
    for link in links {
        let (table, owner_col, other_col, other) = link_table(owner, link)?;
        let sql = format!(
            "INSERT OR IGNORE INTO {table} (id, {owner_col}, {other_col}) VALUES (?1,?2,?3)"
        );
        conn.execute(&sql, params![new_id(), owner_id, link.id])
            .map_err(|e| CliError::Runtime(format!("could not link {other}: {e}")))?;
    }
    Ok(())
}

/// Map (owner, link) to the join table + columns. `owner` is "document" | "interaction".
fn link_table(
    owner: &str,
    link: &LinkRef,
) -> Result<(&'static str, &'static str, &'static str, &'static str), CliError> {
    let table = match (owner, link.kind) {
        ("document", LinkKind::Person) => ("document_people", "document_id", "person_id", "person"),
        ("document", LinkKind::Organization) => (
            "document_organizations",
            "document_id",
            "organization_id",
            "organization",
        ),
        ("document", LinkKind::Project) => {
            ("project_documents", "document_id", "project_id", "project")
        }
        ("document", LinkKind::Task) => ("task_documents", "document_id", "task_id", "task"),
        ("interaction", LinkKind::Person) => (
            "interaction_participants",
            "interaction_id",
            "person_id",
            "person",
        ),
        ("interaction", LinkKind::Organization) => (
            "interaction_organizations",
            "interaction_id",
            "organization_id",
            "organization",
        ),
        ("interaction", LinkKind::Project) => (
            "project_interactions",
            "interaction_id",
            "project_id",
            "project",
        ),
        ("interaction", LinkKind::Task) => {
            ("task_interactions", "interaction_id", "task_id", "task")
        }
        _ => {
            return Err(CliError::Runtime(format!(
                "{owner} records cannot link to {}",
                record_type(link)
            )));
        }
    };
    Ok(table)
}

pub struct AddPersonArgs<'a> {
    pub full_name: &'a str,
    pub preferred_name: Option<&'a str>,
    pub primary_email: Option<&'a str>,
    pub primary_phone: Option<&'a str>,
    pub headline: Option<&'a str>,
    pub location: Option<&'a str>,
    pub summary: Option<&'a str>,
    pub notes: Option<&'a str>,
    pub reconnect_interval_days: Option<i64>,
    pub allow_duplicate: bool,
}

fn find_duplicate_person(
    conn: &Connection,
    full_name: &str,
    primary_email: Option<&str>,
) -> Result<Option<String>, CliError> {
    let incoming_email = normalize_email(primary_email);
    if let Some(email) = &incoming_email {
        let id = conn
            .query_row(
                "SELECT id FROM people
                 WHERE archived_at IS NULL
                   AND primary_email IS NOT NULL
                   AND lower(primary_email) = ?1
                LIMIT 1",
                params![email],
                |row| row.get::<_, String>(0),
            )
            .ok();
        if id.is_some() {
            return Ok(id);
        }
    }

    let name = normalize_name(full_name);
    if name.is_empty() {
        return Ok(None);
    }
    let mut stmt =
        conn.prepare("SELECT id, full_name, primary_email FROM people WHERE archived_at IS NULL")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    for row in rows {
        let (id, candidate, candidate_email) = row?;
        if normalize_name(&candidate) == name {
            if incoming_email.is_some() && normalize_email(candidate_email.as_deref()).is_some() {
                continue;
            }
            return Ok(Some(id));
        }
    }
    Ok(None)
}

fn has_text(value: &Option<String>) -> bool {
    value.as_deref().is_some_and(|text| !text.trim().is_empty())
}

fn is_blank(value: &Option<String>) -> bool {
    !has_text(value)
}

fn enrich_duplicate_person(
    conn: &Connection,
    id: &str,
    args: &AddPersonArgs,
) -> Result<bool, CliError> {
    let preferred_name = normalize_optional(args.preferred_name);
    let primary_email = normalize_email(args.primary_email);
    let primary_phone = normalize_optional(args.primary_phone);
    let headline = normalize_optional(args.headline);
    let location = normalize_optional(args.location);
    let summary = normalize_optional(args.summary);
    let notes = normalize_optional(args.notes);
    let reconnect_interval_days = args.reconnect_interval_days;

    let current = conn.query_row(
        "SELECT preferred_name, primary_email, primary_phone, headline, location,
                summary, notes, reconnect_interval_days
         FROM people
         WHERE id = ?1",
        params![id],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<i64>>(7)?,
            ))
        },
    )?;

    let changed = (has_text(&preferred_name) && is_blank(&current.0))
        || (has_text(&primary_email) && is_blank(&current.1))
        || (has_text(&primary_phone) && is_blank(&current.2))
        || (has_text(&headline) && is_blank(&current.3))
        || (has_text(&location) && is_blank(&current.4))
        || (has_text(&summary) && is_blank(&current.5))
        || (has_text(&notes) && is_blank(&current.6))
        || (reconnect_interval_days.is_some() && current.7.is_none());

    if !changed {
        return Ok(false);
    }

    conn.execute(
        "UPDATE people
         SET preferred_name = CASE
               WHEN (preferred_name IS NULL OR trim(preferred_name) = '') AND ?1 IS NOT NULL
               THEN ?1 ELSE preferred_name END,
             primary_email = CASE
               WHEN (primary_email IS NULL OR trim(primary_email) = '') AND ?2 IS NOT NULL
               THEN ?2 ELSE primary_email END,
             primary_phone = CASE
               WHEN (primary_phone IS NULL OR trim(primary_phone) = '') AND ?3 IS NOT NULL
               THEN ?3 ELSE primary_phone END,
             headline = CASE
               WHEN (headline IS NULL OR trim(headline) = '') AND ?4 IS NOT NULL
               THEN ?4 ELSE headline END,
             location = CASE
               WHEN (location IS NULL OR trim(location) = '') AND ?5 IS NOT NULL
               THEN ?5 ELSE location END,
             summary = CASE
               WHEN (summary IS NULL OR trim(summary) = '') AND ?6 IS NOT NULL
               THEN ?6 ELSE summary END,
             notes = CASE
               WHEN (notes IS NULL OR trim(notes) = '') AND ?7 IS NOT NULL
               THEN ?7 ELSE notes END,
             reconnect_interval_days = CASE
               WHEN reconnect_interval_days IS NULL AND ?8 IS NOT NULL
               THEN ?8 ELSE reconnect_interval_days END,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?9",
        params![
            preferred_name,
            primary_email,
            primary_phone,
            headline,
            location,
            summary,
            notes,
            reconnect_interval_days,
            id,
        ],
    )?;
    Ok(true)
}

pub fn add_person(conn: &mut Connection, json: bool, args: AddPersonArgs) -> Result<(), CliError> {
    let full_name = args.full_name.trim();
    if full_name.is_empty() {
        return Err(CliError::Runtime("--full-name cannot be blank".into()));
    }
    if let Some(existing) = find_duplicate_person(conn, full_name, args.primary_email)? {
        if !args.allow_duplicate {
            enrich_duplicate_person(conn, &existing, &args)?;
            return report_person(json, &existing, true);
        }
    }

    let id = new_id();
    let email = normalize_email(args.primary_email);
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO people (
           id, full_name, preferred_name, primary_email, primary_phone, headline,
           location, summary, notes, reconnect_interval_days
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            id,
            full_name,
            normalize_optional(args.preferred_name),
            email,
            normalize_optional(args.primary_phone),
            normalize_optional(args.headline),
            normalize_optional(args.location),
            normalize_optional(args.summary),
            normalize_optional(args.notes),
            args.reconnect_interval_days,
        ],
    )?;
    tx.commit()?;
    report_person(json, &id, false)
}

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

fn asset_destination(
    assets_path: &Path,
    storage_path: &str,
) -> Result<std::path::PathBuf, CliError> {
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

fn record_type(link: &LinkRef) -> &'static str {
    match link.kind {
        LinkKind::Person => "person",
        LinkKind::Organization => "organization",
        LinkKind::Project => "project",
        LinkKind::Task => "task",
        LinkKind::Document => "document",
        LinkKind::Interaction => "interaction",
    }
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
                record_type(link),
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
    let hash = hash_bytes(&bytes);
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

pub struct AddDocumentArgs<'a> {
    pub title: Option<&'a str>,
    pub kind: Option<&'a str>,
    pub body: String,
    pub links: Vec<LinkRef>,
    pub allow_duplicate: bool,
}

pub fn add_document(
    conn: &mut Connection,
    json: bool,
    args: AddDocumentArgs,
) -> Result<(), CliError> {
    let body = normalize_text(&args.body);
    let title = normalize_title(args.title);
    // Parity with the core `validateNewDocument`: both columns are nullable in
    // SQLite, so reject a document with neither a title nor a body.
    if title.is_none() && body.is_empty() {
        return Err(CliError::Runtime(
            "a document needs a title or body text".into(),
        ));
    }
    let hash = content_hash(&body);
    if let Some(existing) = find_duplicate(conn, "documents", &hash)? {
        if !args.allow_duplicate {
            return report_record(json, "document", &existing, true, 0);
        }
    }
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO documents (id, title, kind, body_text, content_hash) VALUES (?1,?2,?3,?4,?5)",
        params![id, title, normalize_optional(args.kind), body, hash],
    )?;
    let count = insert_chunks(&tx, "document", &id, &body)?;
    insert_links(&tx, "document", &id, &args.links)?;
    tx.commit()?;
    report_record(json, "document", &id, false, count)
}

pub struct AddInteractionArgs<'a> {
    pub title: Option<&'a str>,
    pub kind: &'a str,
    pub occurred_at: Option<&'a str>,
    pub external_id: Option<&'a str>,
    pub original_url: Option<&'a str>,
    pub body: String,
    pub links: Vec<LinkRef>,
    pub allow_duplicate: bool,
}

fn find_duplicate_interaction(
    conn: &Connection,
    hash: &str,
    external_id: Option<&str>,
) -> Result<Option<String>, CliError> {
    if let Some(external_id) = normalize_optional(external_id) {
        let id = conn
            .query_row(
                "SELECT id FROM interactions
                 WHERE archived_at IS NULL
                   AND external_id IS NOT NULL
                   AND external_id = ?1
                 LIMIT 1",
                params![external_id],
                |row| row.get::<_, String>(0),
            )
            .ok();
        if id.is_some() {
            return Ok(id);
        }
    }
    find_duplicate(conn, "interactions", hash)
}

fn enrich_duplicate_interaction(
    conn: &Connection,
    id: &str,
    args: &AddInteractionArgs,
) -> Result<(), CliError> {
    conn.execute(
        "UPDATE interactions
         SET external_id = CASE
               WHEN (external_id IS NULL OR trim(external_id) = '') AND ?1 IS NOT NULL
               THEN ?1 ELSE external_id END,
             original_url = CASE
               WHEN (original_url IS NULL OR trim(original_url) = '') AND ?2 IS NOT NULL
               THEN ?2 ELSE original_url END,
             updated_at = CASE
               WHEN ((external_id IS NULL OR trim(external_id) = '') AND ?1 IS NOT NULL)
                 OR ((original_url IS NULL OR trim(original_url) = '') AND ?2 IS NOT NULL)
               THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE updated_at END
         WHERE id = ?3",
        params![
            normalize_optional(args.external_id),
            normalize_optional(args.original_url),
            id,
        ],
    )?;
    Ok(())
}

pub fn add_interaction(
    conn: &mut Connection,
    json: bool,
    args: AddInteractionArgs,
) -> Result<(), CliError> {
    let body = normalize_text(&args.body);
    let title = normalize_title(args.title);
    // Parity with the core `validateNewInteraction`: reject one with neither a
    // title nor a body.
    if title.is_none() && body.is_empty() {
        return Err(CliError::Runtime(
            "an interaction needs a title or body text".into(),
        ));
    }
    let hash = content_hash(&body);
    if let Some(existing) = find_duplicate_interaction(conn, &hash, args.external_id)? {
        if !args.allow_duplicate {
            let tx = conn.transaction()?;
            enrich_duplicate_interaction(&tx, &existing, &args)?;
            insert_links(&tx, "interaction", &existing, &args.links)?;
            tx.commit()?;
            return report_record(json, "interaction", &existing, true, 0);
        }
    }
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO interactions
         (id, kind, title, body_text, occurred_at, external_id, original_url, content_hash)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            id,
            args.kind,
            title,
            body,
            args.occurred_at,
            normalize_optional(args.external_id),
            normalize_optional(args.original_url),
            hash
        ],
    )?;
    let count = insert_chunks(&tx, "interaction", &id, &body)?;
    insert_links(&tx, "interaction", &id, &args.links)?;
    tx.commit()?;
    report_record(json, "interaction", &id, false, count)
}

pub struct AddTaskArgs<'a> {
    pub title: &'a str,
    pub status: &'a str,
    pub due_at: Option<&'a str>,
    pub project_id: Option<String>,
    pub links: Vec<LinkRef>,
}

pub fn add_task(conn: &mut Connection, json: bool, args: AddTaskArgs) -> Result<(), CliError> {
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO tasks (id, title, status, due_at, project_id) VALUES (?1,?2,?3,?4,?5)",
        params![id, args.title, args.status, args.due_at, args.project_id],
    )?;
    // Person/organization links go through task join tables; project via column above.
    for link in &args.links {
        match link.kind {
            LinkKind::Person => {
                tx.execute(
                    "INSERT INTO task_people (id, task_id, person_id) VALUES (?1,?2,?3)",
                    params![new_id(), id, link.id],
                )?;
            }
            LinkKind::Organization => {
                tx.execute(
                    "INSERT INTO task_organizations (id, task_id, organization_id) VALUES (?1,?2,?3)",
                    params![new_id(), id, link.id],
                )?;
            }
            LinkKind::Project => {
                tx.execute(
                    "UPDATE tasks SET project_id = ?1 WHERE id = ?2",
                    params![link.id, id],
                )?;
            }
            LinkKind::Task => {
                return Err(CliError::Runtime(
                    "a task cannot link to another task".into(),
                ));
            }
            LinkKind::Document | LinkKind::Interaction => {
                return Err(CliError::Runtime(
                    "a task can only link to people, organizations, or projects".into(),
                ));
            }
        }
    }
    tx.commit()?;
    if json {
        print_json(&json!({ "kind": "task", "id": id }))
    } else {
        println!("task {id}");
        Ok(())
    }
}

pub struct RememberArgs<'a> {
    pub kind: &'a str,
    pub claim: &'a str,
    pub links: Vec<LinkRef>,
}

/// `brain remember` — add a hidden memory (atomic claim) with direct provenance
/// links to the records it is about.
pub fn remember(conn: &mut Connection, json: bool, args: RememberArgs) -> Result<(), CliError> {
    let id = new_id();
    let created = now_iso(conn)?;
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO memories (id, kind, claim, valid_from) VALUES (?1,?2,?3,?4)",
        params![id, args.kind, args.claim, created],
    )?;
    for link in &args.links {
        let record_type = match link.kind {
            LinkKind::Person => "person",
            LinkKind::Organization => "organization",
            LinkKind::Project => "project",
            LinkKind::Task => "task",
            LinkKind::Document => "document",
            LinkKind::Interaction => "interaction",
        };
        tx.execute(
            "INSERT INTO memory_links (id, memory_id, record_type, record_id) VALUES (?1,?2,?3,?4)",
            params![new_id(), id, record_type, link.id],
        )?;
    }
    tx.commit()?;
    if json {
        print_json(&json!({ "kind": "memory", "id": id, "links": args.links.len() }))
    } else {
        println!("memory {id}");
        Ok(())
    }
}

fn report_record(
    json: bool,
    kind: &str,
    id: &str,
    duplicate: bool,
    chunk_count: usize,
) -> Result<(), CliError> {
    if json {
        print_json(&json!({
            "kind": kind,
            "id": id,
            "isDuplicate": duplicate,
            "chunkCount": chunk_count,
        }))
    } else {
        if duplicate {
            println!("{kind} {id} (duplicate, skipped)");
        } else {
            println!("{kind} {id} ({chunk_count} chunks)");
        }
        Ok(())
    }
}

fn report_person(json: bool, id: &str, duplicate: bool) -> Result<(), CliError> {
    if json {
        print_json(&json!({
            "kind": "person",
            "id": id,
            "isDuplicate": duplicate,
        }))
    } else {
        if duplicate {
            println!("person {id} (duplicate, skipped)");
        } else {
            println!("person {id}");
        }
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
