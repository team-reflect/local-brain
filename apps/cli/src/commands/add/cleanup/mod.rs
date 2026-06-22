//! CLI cleanup primitives for safe backfills: archive, unlink, person contact
//! maintenance, and person merge. These commands deliberately stay provider
//! neutral and operate on the durable SQLite schema directly in one transaction.

mod archive;
pub(super) mod contacts;
mod merge;
mod unlink;

use rusqlite::{params, Connection};
use serde_json::json;

use super::identity::{insert_record_provenance, RecordProvenanceWrite};
use super::links::replace_chunks;
use super::text::normalize_optional;
use crate::error::CliError;

pub use archive::archive_record;
pub use contacts::{
    person_email_add, person_email_remove, person_phone_add, person_phone_remove, rename_person,
    repair_person_phone_move,
};
pub use merge::merge_person;
pub use unlink::unlink_records;

pub struct MergePersonArgs<'a> {
    pub from_person_id: &'a str,
    pub to_person_id: &'a str,
    pub dry_run: bool,
    pub reason: Option<&'a str>,
}

pub struct ArchiveArgs<'a> {
    pub kind: ArchiveKind,
    pub id: &'a str,
    pub reason: &'a str,
}

#[derive(Clone, Copy)]
pub enum ArchiveKind {
    Person,
    Organization,
}

impl ArchiveKind {
    fn record_type(self) -> &'static str {
        match self {
            ArchiveKind::Person => "person",
            ArchiveKind::Organization => "organization",
        }
    }

    fn table(self) -> &'static str {
        match self {
            ArchiveKind::Person => "people",
            ArchiveKind::Organization => "organizations",
        }
    }
}

pub struct UnlinkArgs<'a> {
    pub left: &'a str,
    pub right: &'a str,
    pub reason: &'a str,
}

pub struct PersonRenameArgs<'a> {
    pub person_id: &'a str,
    pub full_name: &'a str,
}

pub struct PersonContactArgs<'a> {
    pub person_id: &'a str,
    pub value: &'a str,
}

pub struct PersonPhoneMoveArgs<'a> {
    pub phone: &'a str,
    pub from_person_id: &'a str,
    pub to_person_id: &'a str,
    pub relink_participants: bool,
}

fn require_active_person(conn: &Connection, person_id: &str) -> Result<(), CliError> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM people WHERE id = ?1 AND archived_at IS NULL)",
        params![person_id],
        |row| row.get(0),
    )?;
    if exists {
        Ok(())
    } else {
        Err(CliError::NotFound(format!("person {person_id} not found")))
    }
}

fn require_active_organization(conn: &Connection, organization_id: &str) -> Result<(), CliError> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM organizations WHERE id = ?1 AND archived_at IS NULL)",
        params![organization_id],
        |row| row.get(0),
    )?;
    if exists {
        Ok(())
    } else {
        Err(CliError::NotFound(format!(
            "organization {organization_id} not found"
        )))
    }
}

fn reason_metadata(reason: Option<&str>) -> Option<String> {
    normalize_optional(reason).map(|reason| json!({ "reason": reason }).to_string())
}

fn insert_cleanup_provenance(
    conn: &Connection,
    record_type: &str,
    record_id: &str,
    provenance_kind: &str,
    reason: Option<&str>,
) -> Result<(), CliError> {
    let metadata = reason_metadata(reason);
    insert_record_provenance(
        conn,
        RecordProvenanceWrite {
            record_type,
            record_id,
            provenance_kind,
            source_id: None,
            original_path: None,
            original_url: None,
            model: None,
            prompt_fingerprint: None,
            metadata_json: metadata.as_deref(),
        },
    )
}

fn person_profile_text(conn: &Connection, id: &str) -> Result<String, CliError> {
    conn.query_row(
        "SELECT trim(
            COALESCE(full_name, '') || ' ' ||
            COALESCE(preferred_name, '') || ' ' ||
            COALESCE(headline, '') || ' ' ||
            COALESCE(summary, '') || ' ' ||
            COALESCE(location, '') || ' ' ||
            COALESCE(city, '') || ' ' ||
            COALESCE(region, '') || ' ' ||
            COALESCE(country, '') || ' ' ||
            COALESCE(timezone, '') || ' ' ||
            COALESCE(current_title, '') || ' ' ||
            COALESCE(current_department, '') || ' ' ||
            COALESCE(role_family, '') || ' ' ||
            COALESCE(seniority, '') || ' ' ||
            COALESCE(notes, '')
         ) FROM people WHERE id = ?1",
        params![id],
        |row| row.get::<_, String>(0),
    )
    .map_err(CliError::from)
}

fn refresh_person_chunks(conn: &Connection, person_id: &str) -> Result<usize, CliError> {
    let text = person_profile_text(conn, person_id)?;
    replace_chunks(conn, "person", person_id, &text)
}

fn sync_person_current_affiliation(conn: &Connection, person_id: &str) -> Result<(), CliError> {
    conn.execute(
        "UPDATE people
         SET current_organization_id = (
               SELECT organization_id FROM affiliations
               WHERE person_id = ?1 AND is_current = 1
               ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
             ),
             current_title = (
               SELECT title FROM affiliations
               WHERE person_id = ?1 AND is_current = 1
               ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
             ),
             current_department = (
               SELECT department FROM affiliations
               WHERE person_id = ?1 AND is_current = 1
               ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
             ),
             role_family = (
               SELECT role_family FROM affiliations
               WHERE person_id = ?1 AND is_current = 1
               ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
             ),
             seniority = (
               SELECT seniority FROM affiliations
               WHERE person_id = ?1 AND is_current = 1
               ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
             ),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![person_id],
    )?;
    Ok(())
}
