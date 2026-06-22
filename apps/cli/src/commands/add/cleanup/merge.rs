use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use super::super::identity::{insert_record_provenance, RecordProvenanceWrite};
use super::super::text::normalize_optional;
use super::contacts::{normalize_primary_email, normalize_primary_phone};
use super::{
    insert_cleanup_provenance, refresh_person_chunks, require_active_person,
    sync_person_current_affiliation, MergePersonArgs,
};
use crate::commands::now_iso;
use crate::error::CliError;
use crate::output::print_json;

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
    external_identities: MoveStats,
    evidence_refs: usize,
    facts: usize,
    ai_notes: usize,
    source_records: usize,
    source_provenance_rows_preserved: usize,
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
            "externalIdentitiesMoved": self.external_identities.moved,
            "externalIdentitiesMerged": self.external_identities.merged,
            "evidenceRefsMoved": self.evidence_refs,
            "factsMoved": self.facts,
            "aiNotesMoved": self.ai_notes,
            "sourceRecordRefsMoved": self.source_records,
            "provenanceRowsMoved": 0,
            "sourceProvenanceRowsPreserved": self.source_provenance_rows_preserved,
            "profileFieldsFilled": self.profile_fields_filled,
            "notesAppended": self.notes_appended,
            "sourceArchived": !dry_run,
            "warnings": self.warnings,
        })
    }
}

fn is_self_person(conn: &Connection, person_id: &str) -> Result<bool, CliError> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM people WHERE id = ?1 AND is_self = 1 AND archived_at IS NULL)",
        params![person_id],
        |row| row.get(0),
    )?)
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

fn external_identity_plan(
    conn: &Connection,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<MoveStats, CliError> {
    let total = count(
        conn,
        "SELECT COUNT(*) FROM external_identities
         WHERE entity_type = 'person' AND entity_id = ?1",
        &[from_person_id],
    )?;
    let merged = count(
        conn,
        "SELECT COUNT(*)
         FROM external_identities source
         WHERE source.entity_type = 'person'
           AND source.entity_id = ?1
           AND EXISTS (
             SELECT 1 FROM external_identities target
             WHERE target.entity_type = 'person'
               AND target.entity_id = ?2
               AND target.source_id = source.source_id
               AND target.kind = source.kind
               AND target.external_id = source.external_id
           )",
        &[from_person_id, to_person_id],
    )?;
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
        external_identities: external_identity_plan(conn, from_person_id, to_person_id)?,
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
        source_provenance_rows_preserved: count(
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

fn move_external_identities(
    conn: &Connection,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<MoveStats, CliError> {
    let rows = {
        let mut stmt = conn.prepare(
            "SELECT id, source_id, kind, external_id
             FROM external_identities
             WHERE entity_type = 'person' AND entity_id = ?1
             ORDER BY source_id, kind, external_id, id",
        )?;
        let rows = stmt.query_map(params![from_person_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut stats = MoveStats::default();
    for (id, source_id, kind, external_id) in rows {
        let owner: Option<(String, String)> = conn
            .query_row(
                "SELECT entity_type, entity_id
                 FROM external_identities
                 WHERE source_id = ?1
                   AND kind = ?2
                   AND external_id = ?3
                   AND id <> ?4
                 LIMIT 1",
                params![source_id, kind, external_id, id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        match owner {
            Some((entity_type, entity_id))
                if entity_type == "person" && entity_id == to_person_id =>
            {
                stats.merged +=
                    conn.execute("DELETE FROM external_identities WHERE id = ?1", params![id])?;
            }
            Some((entity_type, entity_id)) => {
                return Err(CliError::Runtime(format!(
                    "external identity {source_id}:{kind}:{external_id} is already owned by {entity_type}:{entity_id}"
                )));
            }
            None => {
                stats.moved += conn.execute(
                    "UPDATE external_identities
                     SET entity_id = ?2,
                         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     WHERE id = ?1",
                    params![id, to_person_id],
                )?;
            }
        }
    }
    Ok(stats)
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
        let existing_target_id: Option<String> = conn
            .query_row(
                "SELECT id FROM affiliations
               WHERE person_id = ?1
                 AND organization_id = ?2
                 AND COALESCE(title, '') = ?3
               LIMIT 1",
                params![to_person_id, organization_id, title],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(existing_target_id) = existing_target_id {
            let promote_current = is_current == 1 && !current_taken;
            let promote_primary = is_primary == 1 && !primary_taken;
            if promote_current || promote_primary {
                conn.execute(
                    "UPDATE affiliations
                     SET is_current = CASE WHEN ?2 = 1 THEN 1 ELSE is_current END,
                         is_primary = CASE WHEN ?3 = 1 THEN 1 ELSE is_primary END,
                         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     WHERE id = ?1",
                    params![
                        existing_target_id,
                        i64::from(promote_current),
                        i64::from(promote_primary)
                    ],
                )?;
                current_taken |= promote_current;
                primary_taken |= promote_primary;
            }
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

fn insert_merge_provenance(
    conn: &Connection,
    from_person_id: &str,
    to_person_id: &str,
    reason: Option<&str>,
) -> Result<(), CliError> {
    let metadata = match normalize_optional(reason) {
        Some(reason) => json!({
            "reason": reason,
            "fromPersonId": from_person_id,
            "toPersonId": to_person_id,
        }),
        None => json!({
            "fromPersonId": from_person_id,
            "toPersonId": to_person_id,
        }),
    }
    .to_string();
    insert_record_provenance(
        conn,
        RecordProvenanceWrite {
            record_type: "person",
            record_id: to_person_id,
            provenance_kind: "merged",
            source_id: None,
            original_path: None,
            original_url: None,
            model: None,
            prompt_fingerprint: None,
            metadata_json: Some(metadata.as_str()),
        },
    )
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
    sync_person_current_affiliation(conn, to_person_id)?;
    sync_person_current_affiliation(conn, from_person_id)?;
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

    plan.external_identities = move_external_identities(conn, from_person_id, to_person_id)?;
    super::super::participants::recompute_relationship_intelligence(conn, to_person_id)?;
    super::super::participants::recompute_relationship_intelligence(conn, from_person_id)?;
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
    refresh_person_chunks(conn, to_person_id)?;
    let now = now_iso(conn)?;
    conn.execute(
        "UPDATE people
         SET archived_at = COALESCE(archived_at, ?2),
             updated_at = ?2
         WHERE id = ?1",
        params![from_person_id, now],
    )?;
    insert_merge_provenance(conn, from_person_id, to_person_id, reason)?;
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
