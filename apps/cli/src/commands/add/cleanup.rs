//! CLI cleanup primitives for safe backfills: archive, unlink, person contact
//! maintenance, and person merge. These commands deliberately stay provider
//! neutral and operate on the durable SQLite schema directly in one transaction.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use super::identity::{insert_record_provenance, RecordProvenanceWrite};
use super::links::replace_chunks;
use super::record_ref::{parse_record_ref, require_record};
use super::text::{
    normalize_email, normalize_optional, normalize_phone, normalize_title, valid_email,
};
use crate::commands::now_iso;
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;

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

#[derive(Debug, Default)]
struct MoveStats {
    moved: usize,
    merged: usize,
}

#[derive(Debug, Default)]
struct MergePlan {
    emails: MoveStats,
    phones: MoveStats,
    affiliations: MoveStats,
    participants: MoveStats,
    document_links: MoveStats,
    project_links: MoveStats,
    task_links: MoveStats,
    asset_links: MoveStats,
    memory_links: MoveStats,
    taggings: MoveStats,
    external_identities: usize,
    evidence_refs: usize,
    facts: usize,
    ai_notes: usize,
    source_records: usize,
    provenance_rows: usize,
    profile_fields_filled: usize,
    notes_appended: bool,
    warnings: Vec<String>,
}

impl MergePlan {
    fn json(&self, dry_run: bool, from_person_id: &str, to_person_id: &str) -> Value {
        json!({
            "kind": "person_merge",
            "dryRun": dry_run,
            "fromPersonId": from_person_id,
            "toPersonId": to_person_id,
            "emailsMoved": self.emails.moved,
            "emailsMerged": self.emails.merged,
            "phonesMoved": self.phones.moved,
            "phonesMerged": self.phones.merged,
            "affiliationsMoved": self.affiliations.moved,
            "affiliationsMerged": self.affiliations.merged,
            "participantsRelinked": self.participants.moved,
            "participantsMerged": self.participants.merged,
            "documentLinksMoved": self.document_links.moved,
            "documentLinksMerged": self.document_links.merged,
            "projectLinksMoved": self.project_links.moved,
            "projectLinksMerged": self.project_links.merged,
            "taskLinksMoved": self.task_links.moved,
            "taskLinksMerged": self.task_links.merged,
            "assetLinksMoved": self.asset_links.moved,
            "assetLinksMerged": self.asset_links.merged,
            "memoryLinksMoved": self.memory_links.moved,
            "memoryLinksMerged": self.memory_links.merged,
            "taggingsMoved": self.taggings.moved,
            "taggingsMerged": self.taggings.merged,
            "externalIdentitiesMoved": self.external_identities,
            "evidenceRefsMoved": self.evidence_refs,
            "factsMoved": self.facts,
            "aiNotesMoved": self.ai_notes,
            "sourceRecordRefsMoved": self.source_records,
            "provenanceRowsMoved": self.provenance_rows,
            "profileFieldsFilled": self.profile_fields_filled,
            "notesAppended": self.notes_appended,
            "sourceArchived": !dry_run,
            "warnings": self.warnings,
        })
    }
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

fn is_self_person(conn: &Connection, person_id: &str) -> Result<bool, CliError> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM people WHERE id = ?1 AND is_self = 1 AND archived_at IS NULL)",
        params![person_id],
        |row| row.get(0),
    )?)
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

fn count(conn: &Connection, sql: &str, args: &[&str]) -> Result<usize, CliError> {
    let mut stmt = conn.prepare(sql)?;
    let value: i64 = match args {
        [] => stmt.query_row([], |row| row.get(0))?,
        [a] => stmt.query_row(params![a], |row| row.get(0))?,
        [a, b] => stmt.query_row(params![a, b], |row| row.get(0))?,
        _ => return Err(CliError::Runtime("unsupported count arity".into())),
    };
    Ok(value as usize)
}

fn relation_plan(
    conn: &Connection,
    table: &str,
    owner_col: &str,
    person_col: &str,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<MoveStats, CliError> {
    let total_sql = format!("SELECT COUNT(*) FROM {table} WHERE {person_col} = ?1");
    let duplicate_sql = format!(
        "SELECT COUNT(*)
         FROM {table} source
         WHERE source.{person_col} = ?1
           AND EXISTS (
             SELECT 1 FROM {table} target
             WHERE target.{person_col} = ?2
               AND target.{owner_col} = source.{owner_col}
           )"
    );
    let total = count(conn, &total_sql, &[from_person_id])?;
    let merged = count(conn, &duplicate_sql, &[from_person_id, to_person_id])?;
    Ok(MoveStats {
        moved: total.saturating_sub(merged),
        merged,
    })
}

fn profile_fields_filled(
    conn: &Connection,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<usize, CliError> {
    let fields = [
        "preferred_name",
        "headline",
        "summary",
        "primary_email",
        "primary_phone",
        "location",
        "city",
        "region",
        "country",
        "timezone",
        "linkedin_url",
        "website",
        "important_dates_json",
        "current_title",
        "current_department",
        "current_organization_id",
        "role_family",
        "seniority",
    ];
    let mut filled = 0;
    for field in fields {
        let sql = format!(
            "SELECT EXISTS(
               SELECT 1
               FROM people source
               JOIN people target ON target.id = ?2
               WHERE source.id = ?1
                 AND source.{field} IS NOT NULL
                 AND trim(CAST(source.{field} AS TEXT)) != ''
                 AND (target.{field} IS NULL OR trim(CAST(target.{field} AS TEXT)) = '')
             )"
        );
        let can_fill: bool =
            conn.query_row(&sql, params![from_person_id, to_person_id], |row| {
                row.get(0)
            })?;
        if can_fill {
            filled += 1;
        }
    }
    Ok(filled)
}

fn notes_would_append(
    conn: &Connection,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<bool, CliError> {
    let (source_notes, target_notes): (Option<String>, Option<String>) = conn.query_row(
        "SELECT source.notes, target.notes
         FROM people source
         JOIN people target ON target.id = ?2
         WHERE source.id = ?1",
        params![from_person_id, to_person_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let Some(source_notes) = normalize_optional(source_notes.as_deref()) else {
        return Ok(false);
    };
    let Some(target_notes) = normalize_optional(target_notes.as_deref()) else {
        return Ok(false);
    };
    Ok(source_notes != target_notes)
}

fn plan_person_merge(
    conn: &Connection,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<MergePlan, CliError> {
    let email_total = count(
        conn,
        "SELECT COUNT(*) FROM person_emails WHERE person_id = ?1",
        &[from_person_id],
    )?;
    let email_merged = count(
        conn,
        "SELECT COUNT(*)
         FROM person_emails source
         WHERE source.person_id = ?1
           AND EXISTS (
             SELECT 1 FROM person_emails target
             WHERE target.person_id = ?2
               AND target.normalized_email = source.normalized_email
           )",
        &[from_person_id, to_person_id],
    )?;
    let phone_total = count(
        conn,
        "SELECT COUNT(*) FROM person_phones WHERE person_id = ?1",
        &[from_person_id],
    )?;
    let phone_merged = count(
        conn,
        "SELECT COUNT(*)
         FROM person_phones source
         WHERE source.person_id = ?1
           AND EXISTS (
             SELECT 1 FROM person_phones target
             WHERE target.person_id = ?2
               AND target.normalized_phone = source.normalized_phone
           )",
        &[from_person_id, to_person_id],
    )?;

    let affiliation_total = count(
        conn,
        "SELECT COUNT(*) FROM affiliations WHERE person_id = ?1",
        &[from_person_id],
    )?;
    let affiliation_merged = count(
        conn,
        "SELECT COUNT(*)
         FROM affiliations source
         WHERE source.person_id = ?1
           AND EXISTS (
             SELECT 1 FROM affiliations target
             WHERE target.person_id = ?2
               AND target.organization_id = source.organization_id
               AND COALESCE(target.title, '') = COALESCE(source.title, '')
           )",
        &[from_person_id, to_person_id],
    )?;

    let participant_total = count(
        conn,
        "SELECT COUNT(*) FROM interaction_participants WHERE person_id = ?1",
        &[from_person_id],
    )?;
    let participant_merged = count(
        conn,
        "SELECT COUNT(*)
         FROM interaction_participants source
         WHERE source.person_id = ?1
           AND EXISTS (
             SELECT 1 FROM interaction_participants target
             WHERE target.person_id = ?2
               AND target.interaction_id = source.interaction_id
           )",
        &[from_person_id, to_person_id],
    )?;

    let asset_total = count(
        conn,
        "SELECT COUNT(*) FROM asset_links WHERE record_type = 'person' AND record_id = ?1",
        &[from_person_id],
    )?;
    let asset_merged = count(
        conn,
        "SELECT COUNT(*)
         FROM asset_links source
         WHERE source.record_type = 'person'
           AND source.record_id = ?1
           AND EXISTS (
             SELECT 1 FROM asset_links target
             WHERE target.asset_id = source.asset_id
               AND target.record_type = 'person'
               AND target.record_id = ?2
               AND COALESCE(target.role, '') = COALESCE(source.role, '')
           )",
        &[from_person_id, to_person_id],
    )?;

    let memory_total = count(
        conn,
        "SELECT COUNT(*) FROM memory_links WHERE record_type = 'person' AND record_id = ?1",
        &[from_person_id],
    )?;
    let memory_merged = count(
        conn,
        "SELECT COUNT(*)
         FROM memory_links source
         WHERE source.record_type = 'person'
           AND source.record_id = ?1
           AND EXISTS (
             SELECT 1 FROM memory_links target
             WHERE target.memory_id = source.memory_id
               AND target.record_type = 'person'
               AND target.record_id = ?2
               AND COALESCE(target.role, '') = COALESCE(source.role, '')
           )",
        &[from_person_id, to_person_id],
    )?;

    let tagging_total = count(
        conn,
        "SELECT COUNT(*) FROM taggings WHERE record_type = 'person' AND record_id = ?1",
        &[from_person_id],
    )?;
    let tagging_merged = count(
        conn,
        "SELECT COUNT(*)
         FROM taggings source
         WHERE source.record_type = 'person'
           AND source.record_id = ?1
           AND EXISTS (
             SELECT 1 FROM taggings target
             WHERE target.tag_id = source.tag_id
               AND target.record_type = 'person'
               AND target.record_id = ?2
           )",
        &[from_person_id, to_person_id],
    )?;

    Ok(MergePlan {
        emails: MoveStats {
            moved: email_total.saturating_sub(email_merged),
            merged: email_merged,
        },
        phones: MoveStats {
            moved: phone_total.saturating_sub(phone_merged),
            merged: phone_merged,
        },
        affiliations: MoveStats {
            moved: affiliation_total.saturating_sub(affiliation_merged),
            merged: affiliation_merged,
        },
        participants: MoveStats {
            moved: participant_total.saturating_sub(participant_merged),
            merged: participant_merged,
        },
        document_links: relation_plan(
            conn,
            "document_people",
            "document_id",
            "person_id",
            from_person_id,
            to_person_id,
        )?,
        project_links: relation_plan(
            conn,
            "project_people",
            "project_id",
            "person_id",
            from_person_id,
            to_person_id,
        )?,
        task_links: relation_plan(
            conn,
            "task_people",
            "task_id",
            "person_id",
            from_person_id,
            to_person_id,
        )?,
        asset_links: MoveStats {
            moved: asset_total.saturating_sub(asset_merged),
            merged: asset_merged,
        },
        memory_links: MoveStats {
            moved: memory_total.saturating_sub(memory_merged),
            merged: memory_merged,
        },
        taggings: MoveStats {
            moved: tagging_total.saturating_sub(tagging_merged),
            merged: tagging_merged,
        },
        external_identities: count(
            conn,
            "SELECT COUNT(*) FROM external_identities WHERE entity_type = 'person' AND entity_id = ?1",
            &[from_person_id],
        )?,
        evidence_refs: count(
            conn,
            "SELECT COUNT(*) FROM evidence_refs WHERE subject_type = 'person' AND subject_id = ?1",
            &[from_person_id],
        )?,
        facts: count(
            conn,
            "SELECT COUNT(*) FROM extracted_facts WHERE subject_type = 'person' AND subject_id = ?1",
            &[from_person_id],
        )?,
        ai_notes: count(
            conn,
            "SELECT COUNT(*) FROM ai_notes WHERE subject_type = 'person' AND subject_id = ?1",
            &[from_person_id],
        )?,
        source_records: count(
            conn,
            "SELECT
               (SELECT COUNT(*) FROM extracted_facts WHERE source_record_type = 'person' AND source_record_id = ?1) +
               (SELECT COUNT(*) FROM tasks WHERE source_record_type = 'person' AND source_record_id = ?1) +
               (SELECT COUNT(*) FROM content_chunks WHERE source_record_type = 'person' AND source_record_id = ?1)",
            &[from_person_id],
        )?,
        provenance_rows: count(
            conn,
            "SELECT COUNT(*) FROM record_provenance WHERE record_type = 'person' AND record_id = ?1",
            &[from_person_id],
        )?,
        profile_fields_filled: profile_fields_filled(conn, from_person_id, to_person_id)?,
        notes_appended: notes_would_append(conn, from_person_id, to_person_id)?,
        warnings: Vec::new(),
    })
}

fn move_contact_rows(
    conn: &Connection,
    table: &str,
    normalized_col: &str,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<MoveStats, CliError> {
    let sql = format!("SELECT id, {normalized_col} FROM {table} WHERE person_id = ?1");
    let rows = {
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![from_person_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut stats = MoveStats::default();
    for (id, normalized) in rows {
        let exists_sql = format!(
            "SELECT EXISTS(SELECT 1 FROM {table} WHERE person_id = ?1 AND {normalized_col} = ?2)"
        );
        let exists: bool =
            conn.query_row(&exists_sql, params![to_person_id, normalized], |row| {
                row.get(0)
            })?;
        if exists {
            let delete_sql = format!("DELETE FROM {table} WHERE id = ?1");
            stats.merged += conn.execute(&delete_sql, params![id])?;
        } else {
            let update_sql = format!(
                "UPDATE {table}
                 SET person_id = ?2,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ?1"
            );
            stats.moved += conn.execute(&update_sql, params![id, to_person_id])?;
        }
    }
    Ok(stats)
}

fn normalize_primary_email(conn: &Connection, person_id: &str) -> Result<(), CliError> {
    let primary_email: Option<String> = conn.query_row(
        "SELECT primary_email FROM people WHERE id = ?1",
        params![person_id],
        |row| row.get(0),
    )?;
    let normalized_primary = normalize_email(primary_email.as_deref());
    let preferred_id: Option<String> = match normalized_primary.as_deref() {
        Some(primary) => conn
            .query_row(
                "SELECT id FROM person_emails
                 WHERE person_id = ?1 AND normalized_email = ?2
                 ORDER BY is_primary DESC, created_at ASC, id ASC
                 LIMIT 1",
                params![person_id, primary],
                |row| row.get(0),
            )
            .optional()?,
        None => None,
    };
    let chosen = match preferred_id {
        Some(id) => Some(id),
        None => conn
            .query_row(
                "SELECT id FROM person_emails
                 WHERE person_id = ?1
                 ORDER BY is_primary DESC, created_at ASC, id ASC
                 LIMIT 1",
                params![person_id],
                |row| row.get(0),
            )
            .optional()?,
    };
    if let Some(chosen) = chosen {
        conn.execute(
            "UPDATE person_emails
             SET is_primary = CASE WHEN id = ?2 THEN 1 ELSE 0 END,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE person_id = ?1",
            params![person_id, chosen],
        )?;
        let email: String = conn.query_row(
            "SELECT email FROM person_emails WHERE id = ?1",
            params![chosen],
            |row| row.get(0),
        )?;
        conn.execute(
            "UPDATE people
             SET primary_email = CASE
                   WHEN primary_email IS NULL OR trim(primary_email) = '' THEN ?2
                   ELSE primary_email END,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![person_id, email],
        )?;
    } else {
        conn.execute(
            "UPDATE people
             SET primary_email = NULL,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![person_id],
        )?;
    }
    Ok(())
}

fn normalize_primary_phone(conn: &Connection, person_id: &str) -> Result<(), CliError> {
    let primary_phone: Option<String> = conn.query_row(
        "SELECT primary_phone FROM people WHERE id = ?1",
        params![person_id],
        |row| row.get(0),
    )?;
    let normalized_primary = normalize_phone(primary_phone.as_deref());
    let preferred_id: Option<String> = match normalized_primary.as_deref() {
        Some(primary) => conn
            .query_row(
                "SELECT id FROM person_phones
                 WHERE person_id = ?1 AND normalized_phone = ?2
                 ORDER BY is_primary DESC, created_at ASC, id ASC
                 LIMIT 1",
                params![person_id, primary],
                |row| row.get(0),
            )
            .optional()?,
        None => None,
    };
    let chosen = match preferred_id {
        Some(id) => Some(id),
        None => conn
            .query_row(
                "SELECT id FROM person_phones
                 WHERE person_id = ?1
                 ORDER BY is_primary DESC, created_at ASC, id ASC
                 LIMIT 1",
                params![person_id],
                |row| row.get(0),
            )
            .optional()?,
    };
    if let Some(chosen) = chosen {
        conn.execute(
            "UPDATE person_phones
             SET is_primary = CASE WHEN id = ?2 THEN 1 ELSE 0 END,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE person_id = ?1",
            params![person_id, chosen],
        )?;
        let phone: String = conn.query_row(
            "SELECT phone FROM person_phones WHERE id = ?1",
            params![chosen],
            |row| row.get(0),
        )?;
        conn.execute(
            "UPDATE people
             SET primary_phone = CASE
                   WHEN primary_phone IS NULL OR trim(primary_phone) = '' THEN ?2
                   ELSE primary_phone END,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![person_id, phone],
        )?;
    } else {
        conn.execute(
            "UPDATE people
             SET primary_phone = NULL,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![person_id],
        )?;
    }
    Ok(())
}

fn move_affiliations(
    conn: &Connection,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<MoveStats, CliError> {
    let target_has_current: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM affiliations WHERE person_id = ?1 AND is_current = 1)",
        params![to_person_id],
        |row| row.get(0),
    )?;
    let target_has_primary: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM affiliations WHERE person_id = ?1 AND is_primary = 1)",
        params![to_person_id],
        |row| row.get(0),
    )?;
    let rows = {
        let mut stmt = conn.prepare(
            "SELECT id, organization_id, COALESCE(title, ''), is_current, is_primary
             FROM affiliations
             WHERE person_id = ?1
             ORDER BY created_at, id",
        )?;
        let rows = stmt.query_map(params![from_person_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut stats = MoveStats::default();
    let mut current_taken = target_has_current;
    let mut primary_taken = target_has_primary;
    for (id, organization_id, title, is_current, is_primary) in rows {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM affiliations
               WHERE person_id = ?1
                 AND organization_id = ?2
                 AND COALESCE(title, '') = ?3
             )",
            params![to_person_id, organization_id, title],
            |row| row.get(0),
        )?;
        if exists {
            stats.merged += conn.execute("DELETE FROM affiliations WHERE id = ?1", params![id])?;
        } else {
            let keep_current = is_current == 1 && !current_taken;
            let keep_primary = is_primary == 1 && !primary_taken;
            stats.moved += conn.execute(
                "UPDATE affiliations
                 SET person_id = ?2,
                     is_current = ?3,
                     is_primary = ?4,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ?1",
                params![
                    id,
                    to_person_id,
                    i64::from(keep_current),
                    i64::from(keep_primary)
                ],
            )?;
            current_taken |= keep_current;
            primary_taken |= keep_primary;
        }
    }
    Ok(stats)
}

fn move_relation_rows(
    conn: &Connection,
    table: &str,
    owner_col: &str,
    person_col: &str,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<MoveStats, CliError> {
    let sql = format!("SELECT id, {owner_col} FROM {table} WHERE {person_col} = ?1");
    let rows = {
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![from_person_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut stats = MoveStats::default();
    for (id, owner_id) in rows {
        let exists_sql = format!(
            "SELECT EXISTS(SELECT 1 FROM {table} WHERE {owner_col} = ?1 AND {person_col} = ?2)"
        );
        let exists: bool = conn.query_row(&exists_sql, params![owner_id, to_person_id], |row| {
            row.get(0)
        })?;
        if exists {
            let delete_sql = format!("DELETE FROM {table} WHERE id = ?1");
            stats.merged += conn.execute(&delete_sql, params![id])?;
        } else {
            let update_sql = format!("UPDATE {table} SET {person_col} = ?2 WHERE id = ?1");
            stats.moved += conn.execute(&update_sql, params![id, to_person_id])?;
        }
    }
    Ok(stats)
}

fn move_interaction_participants(
    conn: &Connection,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<MoveStats, CliError> {
    let rows = {
        let mut stmt = conn.prepare(
            "SELECT id, interaction_id
             FROM interaction_participants
             WHERE person_id = ?1
             ORDER BY interaction_id, created_at, id",
        )?;
        let rows = stmt.query_map(params![from_person_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut stats = MoveStats::default();
    for (id, interaction_id) in rows {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM interaction_participants
               WHERE interaction_id = ?1 AND person_id = ?2
             )",
            params![interaction_id, to_person_id],
            |row| row.get(0),
        )?;
        if exists {
            stats.merged += conn.execute(
                "DELETE FROM interaction_participants WHERE id = ?1",
                params![id],
            )?;
        } else {
            stats.moved += conn.execute(
                "UPDATE interaction_participants SET person_id = ?2 WHERE id = ?1",
                params![id, to_person_id],
            )?;
        }
    }
    Ok(stats)
}

fn move_asset_links(
    conn: &Connection,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<MoveStats, CliError> {
    let rows = {
        let mut stmt = conn.prepare(
            "SELECT id, asset_id, role
             FROM asset_links
             WHERE record_type = 'person' AND record_id = ?1
             ORDER BY asset_id, created_at, id",
        )?;
        let rows = stmt.query_map(params![from_person_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut stats = MoveStats::default();
    for (id, asset_id, role) in rows {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM asset_links
               WHERE asset_id = ?1
                 AND record_type = 'person'
                 AND record_id = ?2
                 AND COALESCE(role, '') = COALESCE(?3, '')
             )",
            params![asset_id, to_person_id, role.as_deref()],
            |row| row.get(0),
        )?;
        if exists {
            stats.merged += conn.execute("DELETE FROM asset_links WHERE id = ?1", params![id])?;
        } else {
            stats.moved += conn.execute(
                "UPDATE asset_links SET record_id = ?2 WHERE id = ?1",
                params![id, to_person_id],
            )?;
        }
    }
    Ok(stats)
}

fn move_memory_links(
    conn: &Connection,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<MoveStats, CliError> {
    let rows = {
        let mut stmt = conn.prepare(
            "SELECT id, memory_id, role
             FROM memory_links
             WHERE record_type = 'person' AND record_id = ?1
             ORDER BY memory_id, created_at, id",
        )?;
        let rows = stmt.query_map(params![from_person_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut stats = MoveStats::default();
    for (id, memory_id, role) in rows {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM memory_links
               WHERE memory_id = ?1
                 AND record_type = 'person'
                 AND record_id = ?2
                 AND COALESCE(role, '') = COALESCE(?3, '')
             )",
            params![memory_id, to_person_id, role.as_deref()],
            |row| row.get(0),
        )?;
        if exists {
            stats.merged += conn.execute("DELETE FROM memory_links WHERE id = ?1", params![id])?;
        } else {
            stats.moved += conn.execute(
                "UPDATE memory_links SET record_id = ?2 WHERE id = ?1",
                params![id, to_person_id],
            )?;
        }
    }
    Ok(stats)
}

fn move_taggings(
    conn: &Connection,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<MoveStats, CliError> {
    let rows = {
        let mut stmt = conn.prepare(
            "SELECT id, tag_id
             FROM taggings
             WHERE record_type = 'person' AND record_id = ?1
             ORDER BY tag_id, created_at, id",
        )?;
        let rows = stmt.query_map(params![from_person_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut stats = MoveStats::default();
    for (id, tag_id) in rows {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM taggings
               WHERE tag_id = ?1 AND record_type = 'person' AND record_id = ?2
             )",
            params![tag_id, to_person_id],
            |row| row.get(0),
        )?;
        if exists {
            stats.merged += conn.execute("DELETE FROM taggings WHERE id = ?1", params![id])?;
        } else {
            stats.moved += conn.execute(
                "UPDATE taggings SET record_id = ?2 WHERE id = ?1",
                params![id, to_person_id],
            )?;
        }
    }
    Ok(stats)
}

fn fill_person_profile_from_source(
    conn: &Connection,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<(), CliError> {
    conn.execute(
        "UPDATE people AS target
         SET preferred_name = COALESCE(NULLIF(trim(target.preferred_name), ''), (SELECT preferred_name FROM people WHERE id = ?1)),
             headline = COALESCE(NULLIF(trim(target.headline), ''), (SELECT headline FROM people WHERE id = ?1)),
             summary = COALESCE(NULLIF(trim(target.summary), ''), (SELECT summary FROM people WHERE id = ?1)),
             primary_email = COALESCE(NULLIF(trim(target.primary_email), ''), (SELECT primary_email FROM people WHERE id = ?1)),
             primary_phone = COALESCE(NULLIF(trim(target.primary_phone), ''), (SELECT primary_phone FROM people WHERE id = ?1)),
             location = COALESCE(NULLIF(trim(target.location), ''), (SELECT location FROM people WHERE id = ?1)),
             city = COALESCE(NULLIF(trim(target.city), ''), (SELECT city FROM people WHERE id = ?1)),
             region = COALESCE(NULLIF(trim(target.region), ''), (SELECT region FROM people WHERE id = ?1)),
             country = COALESCE(NULLIF(trim(target.country), ''), (SELECT country FROM people WHERE id = ?1)),
             timezone = COALESCE(NULLIF(trim(target.timezone), ''), (SELECT timezone FROM people WHERE id = ?1)),
             linkedin_url = COALESCE(NULLIF(trim(target.linkedin_url), ''), (SELECT linkedin_url FROM people WHERE id = ?1)),
             website = COALESCE(NULLIF(trim(target.website), ''), (SELECT website FROM people WHERE id = ?1)),
             important_dates_json = COALESCE(NULLIF(trim(target.important_dates_json), ''), (SELECT important_dates_json FROM people WHERE id = ?1)),
             current_title = COALESCE(NULLIF(trim(target.current_title), ''), (SELECT current_title FROM people WHERE id = ?1)),
             current_department = COALESCE(NULLIF(trim(target.current_department), ''), (SELECT current_department FROM people WHERE id = ?1)),
             current_organization_id = COALESCE(target.current_organization_id, (SELECT current_organization_id FROM people WHERE id = ?1)),
             role_family = COALESCE(NULLIF(trim(target.role_family), ''), (SELECT role_family FROM people WHERE id = ?1)),
             seniority = COALESCE(NULLIF(trim(target.seniority), ''), (SELECT seniority FROM people WHERE id = ?1)),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE target.id = ?2",
        params![from_person_id, to_person_id],
    )?;

    let (source_notes, target_notes): (Option<String>, Option<String>) = conn.query_row(
        "SELECT source.notes, target.notes
         FROM people source
         JOIN people target ON target.id = ?2
         WHERE source.id = ?1",
        params![from_person_id, to_person_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if let Some(source_notes) = normalize_optional(source_notes.as_deref()) {
        match normalize_optional(target_notes.as_deref()) {
            None => {
                conn.execute(
                    "UPDATE people
                     SET notes = ?2,
                         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     WHERE id = ?1",
                    params![to_person_id, source_notes],
                )?;
            }
            Some(target_notes) if target_notes != source_notes => {
                let appended =
                    format!("{target_notes}\n\nMerged from {from_person_id}:\n{source_notes}");
                conn.execute(
                    "UPDATE people
                     SET notes = ?2,
                         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     WHERE id = ?1",
                    params![to_person_id, appended],
                )?;
            }
            _ => {}
        }
    }
    Ok(())
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

fn apply_person_merge(
    conn: &Connection,
    from_person_id: &str,
    to_person_id: &str,
    reason: Option<&str>,
) -> Result<MergePlan, CliError> {
    let mut plan = plan_person_merge(conn, from_person_id, to_person_id)?;
    fill_person_profile_from_source(conn, from_person_id, to_person_id)?;
    plan.emails = move_contact_rows(
        conn,
        "person_emails",
        "normalized_email",
        from_person_id,
        to_person_id,
    )?;
    plan.phones = move_contact_rows(
        conn,
        "person_phones",
        "normalized_phone",
        from_person_id,
        to_person_id,
    )?;
    normalize_primary_email(conn, to_person_id)?;
    normalize_primary_phone(conn, to_person_id)?;
    plan.affiliations = move_affiliations(conn, from_person_id, to_person_id)?;
    plan.participants = move_interaction_participants(conn, from_person_id, to_person_id)?;
    plan.document_links = move_relation_rows(
        conn,
        "document_people",
        "document_id",
        "person_id",
        from_person_id,
        to_person_id,
    )?;
    plan.project_links = move_relation_rows(
        conn,
        "project_people",
        "project_id",
        "person_id",
        from_person_id,
        to_person_id,
    )?;
    plan.task_links = move_relation_rows(
        conn,
        "task_people",
        "task_id",
        "person_id",
        from_person_id,
        to_person_id,
    )?;
    plan.asset_links = move_asset_links(conn, from_person_id, to_person_id)?;
    plan.memory_links = move_memory_links(conn, from_person_id, to_person_id)?;
    plan.taggings = move_taggings(conn, from_person_id, to_person_id)?;

    plan.external_identities = conn.execute(
        "UPDATE external_identities
         SET entity_id = ?2,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE entity_type = 'person' AND entity_id = ?1",
        params![from_person_id, to_person_id],
    )?;
    plan.evidence_refs = conn.execute(
        "UPDATE evidence_refs SET subject_id = ?2
         WHERE subject_type = 'person' AND subject_id = ?1",
        params![from_person_id, to_person_id],
    )?;
    plan.facts = conn.execute(
        "UPDATE extracted_facts
         SET subject_id = ?2,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE subject_type = 'person' AND subject_id = ?1",
        params![from_person_id, to_person_id],
    )?;
    plan.ai_notes = conn.execute(
        "UPDATE ai_notes
         SET subject_id = ?2,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE subject_type = 'person' AND subject_id = ?1",
        params![from_person_id, to_person_id],
    )?;
    let source_facts = conn.execute(
        "UPDATE extracted_facts
         SET source_record_id = ?2,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE source_record_type = 'person' AND source_record_id = ?1",
        params![from_person_id, to_person_id],
    )?;
    let source_tasks = conn.execute(
        "UPDATE tasks
         SET source_record_id = ?2,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE source_record_type = 'person' AND source_record_id = ?1",
        params![from_person_id, to_person_id],
    )?;
    let source_chunks = conn.execute(
        "UPDATE content_chunks
         SET source_record_id = ?2
         WHERE source_record_type = 'person' AND source_record_id = ?1",
        params![from_person_id, to_person_id],
    )?;
    plan.source_records = source_facts + source_tasks + source_chunks;
    plan.provenance_rows = conn.execute(
        "UPDATE record_provenance
         SET record_id = ?2
         WHERE record_type = 'person' AND record_id = ?1",
        params![from_person_id, to_person_id],
    )?;
    refresh_person_chunks(conn, to_person_id)?;
    let now = now_iso(conn)?;
    conn.execute(
        "UPDATE people
         SET archived_at = COALESCE(archived_at, ?2),
             updated_at = ?2
         WHERE id = ?1",
        params![from_person_id, now],
    )?;
    insert_cleanup_provenance(conn, "person", to_person_id, "merged", reason)?;
    insert_cleanup_provenance(conn, "person", from_person_id, "archived", reason)?;
    Ok(plan)
}

pub fn merge_person(
    conn: &mut Connection,
    json_output: bool,
    args: MergePersonArgs,
) -> Result<(), CliError> {
    require_active_person(conn, args.from_person_id)?;
    require_active_person(conn, args.to_person_id)?;
    if args.from_person_id == args.to_person_id {
        return Err(CliError::Runtime(
            "--from and --to must be different people".into(),
        ));
    }
    if is_self_person(conn, args.from_person_id)? {
        return Err(CliError::Runtime(
            "cannot merge away the self person; merge duplicates into self instead".into(),
        ));
    }
    let plan = plan_person_merge(conn, args.from_person_id, args.to_person_id)?;
    if args.dry_run {
        if json_output {
            return print_json(&plan.json(true, args.from_person_id, args.to_person_id));
        }
        println!(
            "would merge person {} -> {}",
            args.from_person_id, args.to_person_id
        );
        return Ok(());
    }
    let tx = conn.transaction()?;
    let plan = apply_person_merge(&tx, args.from_person_id, args.to_person_id, args.reason)?;
    tx.commit()?;
    if json_output {
        print_json(&plan.json(false, args.from_person_id, args.to_person_id))
    } else {
        println!(
            "merged person {} -> {}",
            args.from_person_id, args.to_person_id
        );
        Ok(())
    }
}

pub fn archive_record(
    conn: &mut Connection,
    json_output: bool,
    args: ArchiveArgs,
) -> Result<(), CliError> {
    if normalize_optional(Some(args.reason)).is_none() {
        return Err(CliError::Runtime("--reason cannot be blank".into()));
    }
    match args.kind {
        ArchiveKind::Person => require_active_person(conn, args.id)?,
        ArchiveKind::Organization => {
            require_active_organization(conn, args.id)?;
            let current_affiliations: i64 = conn.query_row(
                "SELECT COUNT(*)
                 FROM affiliations a
                 JOIN people p ON p.id = a.person_id AND p.archived_at IS NULL
                 WHERE a.organization_id = ?1 AND a.is_current = 1",
                params![args.id],
                |row| row.get(0),
            )?;
            if current_affiliations > 0 {
                return Err(CliError::Runtime(format!(
                    "organization {} still has {current_affiliations} current active affiliation(s); unlink first",
                    args.id
                )));
            }
        }
    }
    let tx = conn.transaction()?;
    let now = now_iso(&tx)?;
    let sql = format!(
        "UPDATE {}
         SET archived_at = COALESCE(archived_at, ?2),
             updated_at = ?2
         WHERE id = ?1 AND archived_at IS NULL",
        args.kind.table()
    );
    let changed = tx.execute(&sql, params![args.id, now])?;
    insert_cleanup_provenance(
        &tx,
        args.kind.record_type(),
        args.id,
        "archived",
        Some(args.reason),
    )?;
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "archive",
            "recordType": args.kind.record_type(),
            "id": args.id,
            "archived": changed > 0,
        }))
    } else {
        println!("archived {}:{}", args.kind.record_type(), args.id);
        Ok(())
    }
}

fn provenance_for_unlink(
    conn: &Connection,
    left_kind: &str,
    left_id: &str,
    right_kind: &str,
    right_id: &str,
    reason: &str,
) -> Result<(), CliError> {
    let metadata = json!({
        "reason": reason,
        "left": format!("{left_kind}:{left_id}"),
        "right": format!("{right_kind}:{right_id}"),
    })
    .to_string();
    for (kind, id) in [(left_kind, left_id), (right_kind, right_id)] {
        insert_record_provenance(
            conn,
            RecordProvenanceWrite {
                record_type: kind,
                record_id: id,
                provenance_kind: "unlinked",
                source_id: None,
                original_path: None,
                original_url: None,
                model: None,
                prompt_fingerprint: None,
                metadata_json: Some(metadata.as_str()),
            },
        )?;
    }
    Ok(())
}

fn relation_key(a: &str, b: &str) -> String {
    if a <= b {
        format!("{a}|{b}")
    } else {
        format!("{b}|{a}")
    }
}

fn id_for<'a>(kind: &str, left: (&'a str, &'a str), right: (&'a str, &'a str)) -> &'a str {
    if left.0 == kind {
        left.1
    } else {
        right.1
    }
}

pub fn unlink_records(
    conn: &mut Connection,
    json_output: bool,
    args: UnlinkArgs,
) -> Result<(), CliError> {
    let reason = normalize_optional(Some(args.reason))
        .ok_or_else(|| CliError::Runtime("--reason cannot be blank".into()))?;
    let (left_kind, left_id) = parse_record_ref(args.left, "left record")?;
    let (right_kind, right_id) = parse_record_ref(args.right, "right record")?;
    require_record(conn, &left_kind, &left_id)?;
    require_record(conn, &right_kind, &right_id)?;
    let key = relation_key(&left_kind, &right_kind);
    let tx = conn.transaction()?;
    let changed = match key.as_str() {
        "organization|person" => tx.execute(
            "DELETE FROM affiliations WHERE person_id = ?1 AND organization_id = ?2",
            params![
                id_for("person", (&left_kind, &left_id), (&right_kind, &right_id)),
                id_for(
                    "organization",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                )
            ],
        )?,
        "person|project" => tx.execute(
            "DELETE FROM project_people WHERE person_id = ?1 AND project_id = ?2",
            params![
                id_for("person", (&left_kind, &left_id), (&right_kind, &right_id)),
                id_for("project", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "person|task" => tx.execute(
            "DELETE FROM task_people WHERE person_id = ?1 AND task_id = ?2",
            params![
                id_for("person", (&left_kind, &left_id), (&right_kind, &right_id)),
                id_for("task", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "interaction|person" => tx.execute(
            "DELETE FROM interaction_participants WHERE interaction_id = ?1 AND person_id = ?2",
            params![
                id_for(
                    "interaction",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                ),
                id_for("person", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "document|person" => tx.execute(
            "DELETE FROM document_people WHERE document_id = ?1 AND person_id = ?2",
            params![
                id_for("document", (&left_kind, &left_id), (&right_kind, &right_id)),
                id_for("person", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "organization|project" => tx.execute(
            "DELETE FROM project_organizations WHERE organization_id = ?1 AND project_id = ?2",
            params![
                id_for(
                    "organization",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                ),
                id_for("project", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "document|organization" => tx.execute(
            "DELETE FROM document_organizations WHERE document_id = ?1 AND organization_id = ?2",
            params![
                id_for("document", (&left_kind, &left_id), (&right_kind, &right_id)),
                id_for(
                    "organization",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                )
            ],
        )?,
        "interaction|organization" => tx.execute(
            "DELETE FROM interaction_organizations WHERE interaction_id = ?1 AND organization_id = ?2",
            params![
                id_for(
                    "interaction",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                ),
                id_for(
                    "organization",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                )
            ],
        )?,
        "organization|task" => tx.execute(
            "DELETE FROM task_organizations WHERE organization_id = ?1 AND task_id = ?2",
            params![
                id_for(
                    "organization",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                ),
                id_for("task", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "project|task" => tx.execute(
            "UPDATE tasks
             SET project_id = NULL,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1 AND project_id = ?2",
            params![
                id_for("task", (&left_kind, &left_id), (&right_kind, &right_id)),
                id_for("project", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "document|project" => tx.execute(
            "DELETE FROM project_documents WHERE document_id = ?1 AND project_id = ?2",
            params![
                id_for("document", (&left_kind, &left_id), (&right_kind, &right_id)),
                id_for("project", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "interaction|project" => tx.execute(
            "DELETE FROM project_interactions WHERE interaction_id = ?1 AND project_id = ?2",
            params![
                id_for(
                    "interaction",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                ),
                id_for("project", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "document|task" => tx.execute(
            "DELETE FROM task_documents WHERE document_id = ?1 AND task_id = ?2",
            params![
                id_for("document", (&left_kind, &left_id), (&right_kind, &right_id)),
                id_for("task", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "interaction|task" => tx.execute(
            "DELETE FROM task_interactions WHERE interaction_id = ?1 AND task_id = ?2",
            params![
                id_for(
                    "interaction",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                ),
                id_for("task", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "document|interaction" => tx.execute(
            "DELETE FROM document_interactions WHERE document_id = ?1 AND interaction_id = ?2",
            params![
                id_for("document", (&left_kind, &left_id), (&right_kind, &right_id)),
                id_for(
                    "interaction",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                )
            ],
        )?,
        key if key.starts_with("asset|") => {
            let other_kind = if left_kind == "asset" {
                right_kind.as_str()
            } else {
                left_kind.as_str()
            };
            let other_id = if left_kind == "asset" {
                right_id.as_str()
            } else {
                left_id.as_str()
            };
            tx.execute(
                "DELETE FROM asset_links
                 WHERE asset_id = ?1 AND record_type = ?2 AND record_id = ?3",
                params![
                    id_for("asset", (&left_kind, &left_id), (&right_kind, &right_id)),
                    other_kind,
                    other_id
                ],
            )?
        }
        _ => {
            return Err(CliError::Runtime(format!(
                "no typed link between {left_kind} and {right_kind}"
            )));
        }
    };
    provenance_for_unlink(&tx, &left_kind, &left_id, &right_kind, &right_id, &reason)?;
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "unlink",
            "left": { "kind": left_kind, "id": left_id },
            "right": { "kind": right_kind, "id": right_id },
            "rowsRemoved": changed,
        }))
    } else {
        println!("unlinked {} and {}", args.left, args.right);
        Ok(())
    }
}

pub fn rename_person(
    conn: &mut Connection,
    json_output: bool,
    args: PersonRenameArgs,
) -> Result<(), CliError> {
    require_active_person(conn, args.person_id)?;
    let full_name = normalize_title(Some(args.full_name))
        .ok_or_else(|| CliError::Runtime("--full-name cannot be blank".into()))?;
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE people
         SET full_name = ?2,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![args.person_id, full_name],
    )?;
    let count = refresh_person_chunks(&tx, args.person_id)?;
    insert_cleanup_provenance(&tx, "person", args.person_id, "renamed", None)?;
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "person",
            "id": args.person_id,
            "fullName": full_name,
            "chunkCount": count,
        }))
    } else {
        println!("person {}", args.person_id);
        Ok(())
    }
}

fn email_owned_by_other(
    conn: &Connection,
    person_id: &str,
    normalized_email: &str,
) -> Result<bool, CliError> {
    Ok(conn.query_row(
        "SELECT EXISTS(
           SELECT 1
           FROM people p
           LEFT JOIN person_emails pe ON pe.person_id = p.id
           WHERE p.archived_at IS NULL
             AND p.id <> ?1
             AND (lower(p.primary_email) = ?2 OR pe.normalized_email = ?2)
         )",
        params![person_id, normalized_email],
        |row| row.get(0),
    )?)
}

fn phone_owned_by_other(
    conn: &Connection,
    person_id: &str,
    normalized_phone: &str,
) -> Result<bool, CliError> {
    Ok(conn.query_row(
        "SELECT EXISTS(
           SELECT 1
           FROM people p
           LEFT JOIN person_phones pp ON pp.person_id = p.id
           WHERE p.archived_at IS NULL
             AND p.id <> ?1
             AND (
               pp.normalized_phone = ?2
               OR replace(replace(replace(replace(replace(COALESCE(p.primary_phone, ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', '') = ?2
             )
         )",
        params![person_id, normalized_phone],
        |row| row.get(0),
    )?)
}

pub fn person_email_add(
    conn: &mut Connection,
    json_output: bool,
    args: PersonContactArgs,
) -> Result<(), CliError> {
    require_active_person(conn, args.person_id)?;
    let email = normalize_optional(Some(args.value))
        .ok_or_else(|| CliError::Runtime("--email cannot be blank".into()))?;
    let normalized_email = normalize_email(Some(&email))
        .ok_or_else(|| CliError::Runtime("--email cannot be blank".into()))?;
    if !valid_email(&normalized_email) {
        return Err(CliError::Runtime(
            "--email must be a valid email address".into(),
        ));
    }
    let tx = conn.transaction()?;
    if email_owned_by_other(&tx, args.person_id, &normalized_email)? {
        return Err(CliError::Runtime(format!(
            "email {normalized_email} is already owned by another active person"
        )));
    }
    let existed: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM person_emails
           WHERE person_id = ?1 AND normalized_email = ?2
         )",
        params![args.person_id, normalized_email],
        |row| row.get(0),
    )?;
    if !existed {
        tx.execute(
            "INSERT INTO person_emails (id, person_id, email, normalized_email, is_primary)
             VALUES (?1,?2,?3,?4,0)",
            params![new_id(), args.person_id, email, normalized_email],
        )?;
    }
    normalize_primary_email(&tx, args.person_id)?;
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "person_email",
            "personId": args.person_id,
            "email": normalized_email,
            "created": !existed,
        }))
    } else {
        println!("email {normalized_email}");
        Ok(())
    }
}

pub fn person_email_remove(
    conn: &mut Connection,
    json_output: bool,
    args: PersonContactArgs,
) -> Result<(), CliError> {
    require_active_person(conn, args.person_id)?;
    let normalized_email = normalize_email(Some(args.value))
        .ok_or_else(|| CliError::Runtime("--email cannot be blank".into()))?;
    let tx = conn.transaction()?;
    let changed = tx.execute(
        "DELETE FROM person_emails WHERE person_id = ?1 AND normalized_email = ?2",
        params![args.person_id, normalized_email],
    )?;
    let primary_email: Option<String> = tx.query_row(
        "SELECT primary_email FROM people WHERE id = ?1",
        params![args.person_id],
        |row| row.get(0),
    )?;
    if normalize_email(primary_email.as_deref()).as_deref() == Some(normalized_email.as_str()) {
        tx.execute(
            "UPDATE people SET primary_email = NULL WHERE id = ?1",
            params![args.person_id],
        )?;
    }
    normalize_primary_email(&tx, args.person_id)?;
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "person_email",
            "personId": args.person_id,
            "email": normalized_email,
            "removed": changed,
        }))
    } else {
        println!("removed email {normalized_email}");
        Ok(())
    }
}

pub fn person_phone_add(
    conn: &mut Connection,
    json_output: bool,
    args: PersonContactArgs,
) -> Result<(), CliError> {
    require_active_person(conn, args.person_id)?;
    let phone = normalize_optional(Some(args.value))
        .ok_or_else(|| CliError::Runtime("--phone cannot be blank".into()))?;
    let normalized_phone = normalize_phone(Some(&phone))
        .ok_or_else(|| CliError::Runtime("--phone must contain digits".into()))?;
    let tx = conn.transaction()?;
    if phone_owned_by_other(&tx, args.person_id, &normalized_phone)? {
        return Err(CliError::Runtime(format!(
            "phone {normalized_phone} is already owned by another active person"
        )));
    }
    let existed: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM person_phones
           WHERE person_id = ?1 AND normalized_phone = ?2
         )",
        params![args.person_id, normalized_phone],
        |row| row.get(0),
    )?;
    if !existed {
        tx.execute(
            "INSERT INTO person_phones (id, person_id, phone, normalized_phone, is_primary)
             VALUES (?1,?2,?3,?4,0)",
            params![new_id(), args.person_id, phone, normalized_phone],
        )?;
    }
    normalize_primary_phone(&tx, args.person_id)?;
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "person_phone",
            "personId": args.person_id,
            "phone": normalized_phone,
            "created": !existed,
        }))
    } else {
        println!("phone {normalized_phone}");
        Ok(())
    }
}

pub fn person_phone_remove(
    conn: &mut Connection,
    json_output: bool,
    args: PersonContactArgs,
) -> Result<(), CliError> {
    require_active_person(conn, args.person_id)?;
    let normalized_phone = normalize_phone(Some(args.value))
        .ok_or_else(|| CliError::Runtime("--phone must contain digits".into()))?;
    let tx = conn.transaction()?;
    let changed = tx.execute(
        "DELETE FROM person_phones WHERE person_id = ?1 AND normalized_phone = ?2",
        params![args.person_id, normalized_phone],
    )?;
    let primary_phone: Option<String> = tx.query_row(
        "SELECT primary_phone FROM people WHERE id = ?1",
        params![args.person_id],
        |row| row.get(0),
    )?;
    if normalize_phone(primary_phone.as_deref()).as_deref() == Some(normalized_phone.as_str()) {
        tx.execute(
            "UPDATE people SET primary_phone = NULL WHERE id = ?1",
            params![args.person_id],
        )?;
    }
    normalize_primary_phone(&tx, args.person_id)?;
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "person_phone",
            "personId": args.person_id,
            "phone": normalized_phone,
            "removed": changed,
        }))
    } else {
        println!("removed phone {normalized_phone}");
        Ok(())
    }
}

pub fn repair_person_phone_move(
    conn: &mut Connection,
    json_output: bool,
    args: PersonPhoneMoveArgs,
) -> Result<(), CliError> {
    require_active_person(conn, args.from_person_id)?;
    require_active_person(conn, args.to_person_id)?;
    if args.from_person_id == args.to_person_id {
        return Err(CliError::Runtime(
            "--from and --to must be different people".into(),
        ));
    }
    let display_phone = normalize_optional(Some(args.phone))
        .ok_or_else(|| CliError::Runtime("--phone cannot be blank".into()))?;
    let normalized_phone = normalize_phone(Some(&display_phone))
        .ok_or_else(|| CliError::Runtime("--phone must contain digits".into()))?;
    let tx = conn.transaction()?;
    if phone_owned_by_other(&tx, args.from_person_id, &normalized_phone)?
        && phone_owned_by_other(&tx, args.to_person_id, &normalized_phone)?
    {
        return Err(CliError::Runtime(format!(
            "phone {normalized_phone} is also owned by another active person"
        )));
    }
    let owned_by_from: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM person_phones
           WHERE person_id = ?1 AND normalized_phone = ?2
         )",
        params![args.from_person_id, normalized_phone],
        |row| row.get(0),
    )?;
    if !owned_by_from {
        return Err(CliError::Runtime(format!(
            "person {} does not own phone {normalized_phone}",
            args.from_person_id
        )));
    }
    let stored_phone: String = tx
        .query_row(
            "SELECT phone FROM person_phones
             WHERE person_id = ?1 AND normalized_phone = ?2
             ORDER BY is_primary DESC, created_at ASC, id ASC
             LIMIT 1",
            params![args.from_person_id, normalized_phone],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or_else(|| display_phone.clone());
    let deleted_rows = tx.execute(
        "DELETE FROM person_phones WHERE person_id = ?1 AND normalized_phone = ?2",
        params![args.from_person_id, normalized_phone],
    )?;
    normalize_primary_phone(&tx, args.from_person_id)?;
    let existed_on_target: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM person_phones
           WHERE person_id = ?1 AND normalized_phone = ?2
         )",
        params![args.to_person_id, normalized_phone],
        |row| row.get(0),
    )?;
    if !existed_on_target {
        tx.execute(
            "INSERT INTO person_phones (id, person_id, phone, normalized_phone, is_primary)
             VALUES (?1,?2,?3,?4,0)",
            params![new_id(), args.to_person_id, stored_phone, normalized_phone],
        )?;
    }
    normalize_primary_phone(&tx, args.to_person_id)?;
    let relink = if args.relink_participants {
        super::participants::relink_participants_for_handle(
            &tx,
            &normalized_phone,
            args.to_person_id,
            Some(args.from_person_id),
            false,
            Some(&stored_phone),
            None,
        )?
    } else {
        super::participants::RelinkResult::default()
    };
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "person_phone_move",
            "phone": normalized_phone,
            "fromPersonId": args.from_person_id,
            "toPersonId": args.to_person_id,
            "phoneRowsMoved": deleted_rows,
            "phoneAttached": !existed_on_target,
            "participantsRelinked": relink.updated_rows,
            "participantsMerged": relink.merged_rows,
        }))
    } else {
        println!(
            "phone {} moved {} -> {}",
            normalized_phone, args.from_person_id, args.to_person_id
        );
        Ok(())
    }
}
