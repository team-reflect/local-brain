//! Source resolution, content-hash dedupe, and the `external_identities`
//! read/write helpers that make imports idempotent. An external identity is the
//! `(source, kind, external_id)` triple an upstream system assigns a record; it
//! is unique per source, so re-importing the same upstream row resolves to the
//! same Local Brain record instead of forking a duplicate.

use rusqlite::{params, Connection};

use super::text::{normalize_optional, normalize_source_slug};
use crate::error::CliError;
use crate::id::new_id;

/// Resolve a source slug to its `sources.id`, or `None` when no slug is given.
/// Errors when a non-empty slug names no registered source.
pub(super) fn source_id(conn: &Connection, slug: Option<&str>) -> Result<Option<String>, CliError> {
    let Some(slug) = slug.map(normalize_source_slug).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let id = conn
        .query_row(
            "SELECT id FROM sources WHERE slug = ?1",
            params![slug],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| {
            CliError::Runtime(format!(
                "unknown source '{slug}' (run `brain source ensure ...`)"
            ))
        })?;
    Ok(Some(id))
}

/// Normalize an external-identity `kind`, defaulting blank to `record`.
pub(super) fn external_kind(raw: &str) -> String {
    normalize_optional(Some(raw)).unwrap_or_else(|| "record".to_string())
}

/// Find a non-archived record in `table` with this content hash (dedupe).
pub(super) fn find_duplicate(
    conn: &Connection,
    table: &str,
    hash: &str,
) -> Result<Option<String>, CliError> {
    let sql =
        format!("SELECT id FROM {table} WHERE content_hash = ?1 AND archived_at IS NULL LIMIT 1");
    let id = conn
        .query_row(&sql, params![hash], |row| row.get::<_, String>(0))
        .ok();
    Ok(id)
}

/// Map an `external_identities.entity_type` to its owning table. Every typed
/// record table carries an `archived_at` column, so callers can scope an
/// external-id lookup to active records.
struct EntityTable {
    table: &'static str,
    has_archived_at: bool,
}

fn entity_table(entity_type: &str) -> Option<EntityTable> {
    match entity_type {
        "person" => Some(EntityTable {
            table: "people",
            has_archived_at: true,
        }),
        "organization" => Some(EntityTable {
            table: "organizations",
            has_archived_at: true,
        }),
        "organization_profile" => Some(EntityTable {
            table: "organization_profiles",
            has_archived_at: false,
        }),
        "project" => Some(EntityTable {
            table: "projects",
            has_archived_at: true,
        }),
        "task" => Some(EntityTable {
            table: "tasks",
            has_archived_at: true,
        }),
        "document" => Some(EntityTable {
            table: "documents",
            has_archived_at: true,
        }),
        "interaction" => Some(EntityTable {
            table: "interactions",
            has_archived_at: true,
        }),
        "interaction_transcript" => Some(EntityTable {
            table: "interaction_transcripts",
            has_archived_at: false,
        }),
        "ai_note" => Some(EntityTable {
            table: "ai_notes",
            has_archived_at: false,
        }),
        "extracted_fact" => Some(EntityTable {
            table: "extracted_facts",
            has_archived_at: true,
        }),
        "memory" => Some(EntityTable {
            table: "memories",
            has_archived_at: true,
        }),
        "asset" => Some(EntityTable {
            table: "assets",
            has_archived_at: true,
        }),
        _ => None,
    }
}

/// Resolve a record by its external identity, scoped to *active* records.
pub(super) fn find_external_identity(
    conn: &Connection,
    entity_type: &str,
    source_id: Option<&str>,
    kind: &str,
    external_id: Option<&str>,
) -> Result<Option<String>, CliError> {
    let (Some(source_id), Some(external_id)) = (
        source_id,
        normalize_optional(external_id).filter(|value| !value.is_empty()),
    ) else {
        return Ok(None);
    };
    // Only treat the external identity as an active duplicate when the linked
    // record still exists and is not archived. Other dedupe paths filter
    // `archived_at IS NULL`; without the join here a re-import with the same
    // --source/--external-id would enrich an archived record and report a
    // duplicate, leaving the data off normal active lists.
    let entity = entity_table(entity_type).ok_or_else(|| {
        CliError::Runtime(format!(
            "unknown external identity entity type '{entity_type}'"
        ))
    })?;
    let archived_filter = if entity.has_archived_at {
        "AND t.archived_at IS NULL"
    } else {
        ""
    };
    let sql = format!(
        "SELECT ei.entity_id
         FROM external_identities ei
         JOIN {table} t ON t.id = ei.entity_id
         WHERE ei.entity_type = ?1
           AND ei.source_id = ?2
           AND ei.kind = ?3
           AND ei.external_id = ?4
           {archived_filter}
         LIMIT 1",
        table = entity.table,
    );
    let id = conn
        .query_row(
            &sql,
            params![entity_type, source_id, kind, external_id],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(id)
}

/// The inputs for one external-identity upsert.
pub(super) struct ExternalIdentityWrite<'a> {
    pub entity_type: &'a str,
    pub entity_id: &'a str,
    pub source_id: Option<&'a str>,
    pub kind: &'a str,
    pub external_id: Option<&'a str>,
    pub url: Option<&'a str>,
    /// True for `--allow-duplicate` forks: never claim or re-point an existing
    /// identity, only insert when the (source, kind, external_id) row is free.
    pub force_duplicate: bool,
}

/// Upsert the `(source, kind, external_id)` identity for `entity_id`, honoring
/// the active/archived and forced-duplicate rules described inline.
pub(super) fn insert_external_identity(
    conn: &Connection,
    write: ExternalIdentityWrite,
) -> Result<(), CliError> {
    let ExternalIdentityWrite {
        entity_type,
        entity_id,
        source_id,
        kind,
        external_id,
        url,
        force_duplicate,
    } = write;
    let (Some(source_id), Some(external_id)) = (
        source_id,
        normalize_optional(external_id).filter(|value| !value.is_empty()),
    ) else {
        return Ok(());
    };
    let entity = entity_table(entity_type).ok_or_else(|| {
        CliError::Runtime(format!(
            "unknown external identity entity type '{entity_type}'"
        ))
    })?;
    // A `--allow-duplicate` import deliberately forks a *new* record even though a
    // match exists. The unique (source_id, kind, external_id) identity already
    // belongs to the matched record, so the new fork must never claim or re-point
    // it: doing so would steal the mapping (and the DO UPDATE re-point branch
    // below could fire if the matched record were archived). `DO NOTHING` keeps
    // the identity on its current owner and still inserts cleanly when no row
    // exists yet, instead of relying on the upsert's WHERE clause silently
    // evaluating false (which is fragile and depends on SQLite no-op semantics).
    let conflict_action = if force_duplicate {
        "DO NOTHING".to_string()
    } else {
        // `INSERT OR IGNORE` alone is wrong on a re-import of an archived record:
        // the unique (source_id, kind, external_id) row still points at the
        // archived entity, so the new active record would never get an identity
        // row and later imports would skip `find_external_identity` (which only
        // matches active rows). The `ON CONFLICT` update therefore handles two
        // cases:
        //   1. Re-point the conflicting identity at the new entity, but ONLY when
        //      the currently-referenced entity is no longer active. This mirrors
        //      `find_external_identity`'s active-only scope and never clobbers an
        //      identity that still maps to a live record.
        //   2. Refresh the stored `url` when the re-import dedupes onto the SAME
        //      active entity and carries a new/changed `--original-url`. Without
        //      this, a duplicate import that resolves to the existing active
        //      record would skip the update entirely and a fresh URL (including
        //      filling a previously null one) would never land. `COALESCE` keeps a
        //      real URL from being clobbered with NULL on a URL-less re-import.
        let inactive_guard = if entity.has_archived_at {
            format!(
                "NOT EXISTS (
                   SELECT 1 FROM {table} t
                   WHERE t.id = external_identities.entity_id
                     AND t.archived_at IS NULL
                 )",
                table = entity.table
            )
        } else {
            format!(
                "NOT EXISTS (
                   SELECT 1 FROM {table} t
                   WHERE t.id = external_identities.entity_id
                 )",
                table = entity.table
            )
        };
        format!(
            "DO UPDATE SET
               entity_type = excluded.entity_type,
               entity_id = excluded.entity_id,
               url = COALESCE(excluded.url, external_identities.url),
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE (
                 external_identities.entity_id <> excluded.entity_id
                 AND {inactive_guard}
               )
               OR (
                 external_identities.entity_id = excluded.entity_id
                 AND excluded.url IS NOT NULL
                 AND (
                   external_identities.url IS NULL
                   OR external_identities.url <> excluded.url
                 )
               )"
        )
    };
    let sql = format!(
        "INSERT INTO external_identities
           (id, entity_type, entity_id, source_id, kind, external_id, url)
         VALUES (?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT (source_id, kind, external_id) {conflict_action}",
    );
    conn.execute(
        &sql,
        params![
            new_id(),
            entity_type,
            entity_id,
            source_id,
            kind,
            external_id,
            normalize_optional(url),
        ],
    )?;
    Ok(())
}
