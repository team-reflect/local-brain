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

struct AffiliationMergeRow {
    id: String,
    organization_id: String,
    title: Option<String>,
    title_key: String,
    department: Option<String>,
    role: Option<String>,
    role_family: Option<String>,
    seniority: Option<String>,
    is_current: i64,
    is_primary: i64,
}

type ExternalIdentityConflict = (String, String, String, String, String);

/// Declarative description of a one-to-many relation a person merge can move from
/// the source person onto the target. A single spec drives BOTH the dry-run
/// estimate ([`count_relation`]) and the applied move ([`move_relation`]), so the
/// two can never disagree about what counts as a duplicate.
///
/// Two relations need bespoke movers this generic shape can't express and so are
/// applied by hand ([`move_affiliations`] enriches the surviving row;
/// [`move_external_identities`] treats a third-party owner as a hard error). Their
/// dry-run counts still flow through [`count_relation`] using the specs below, so
/// plan and apply stay in step.
struct RelationSpec {
    /// Table holding the relation rows.
    table: &'static str,
    /// Column on `table` storing the person id being moved. Usually `person_id`;
    /// the polymorphic link tables store it in `record_id` next to a constant
    /// `record_type = 'person'` filter (see `filters`).
    person_col: &'static str,
    /// Constant equality filters applied to every query, e.g.
    /// `record_type = 'person'` for the polymorphic link tables.
    filters: &'static [(&'static str, &'static str)],
    /// Columns that, together, identify a row the target already owns. Compared
    /// with `COALESCE(col, '')` so nullable keys (e.g. `role`) keep matching the
    /// historical behaviour.
    dedup_cols: &'static [&'static str],
    /// Whether moving a row should bump an `updated_at` column on it.
    touch_updated_at: bool,
}

impl RelationSpec {
    /// Render the constant `filters` as ` AND <alias>col = 'val'` clauses. `alias`
    /// is `""` for an unaliased table or `"source."` / `"target."` inside a join.
    fn filter_clause(&self, alias: &str) -> String {
        self.filters
            .iter()
            .map(|(col, value)| format!(" AND {alias}{col} = '{value}'"))
            .collect()
    }
}

const EMAILS: RelationSpec = RelationSpec {
    table: "person_emails",
    person_col: "person_id",
    filters: &[],
    dedup_cols: &["normalized_email"],
    touch_updated_at: true,
};
const PHONES: RelationSpec = RelationSpec {
    table: "person_phones",
    person_col: "person_id",
    filters: &[],
    dedup_cols: &["normalized_phone"],
    touch_updated_at: true,
};
const PARTICIPANTS: RelationSpec = RelationSpec {
    table: "interaction_participants",
    person_col: "person_id",
    filters: &[],
    dedup_cols: &["interaction_id"],
    touch_updated_at: false,
};
const DOCUMENT_LINKS: RelationSpec = RelationSpec {
    table: "document_people",
    person_col: "person_id",
    filters: &[],
    dedup_cols: &["document_id"],
    touch_updated_at: false,
};
const PROJECT_LINKS: RelationSpec = RelationSpec {
    table: "project_people",
    person_col: "person_id",
    filters: &[],
    dedup_cols: &["project_id"],
    touch_updated_at: false,
};
const TASK_LINKS: RelationSpec = RelationSpec {
    table: "task_people",
    person_col: "person_id",
    filters: &[],
    dedup_cols: &["task_id"],
    touch_updated_at: false,
};
const ASSET_LINKS: RelationSpec = RelationSpec {
    table: "asset_links",
    person_col: "record_id",
    filters: &[("record_type", "person")],
    dedup_cols: &["asset_id", "role"],
    touch_updated_at: false,
};
const MEMORY_LINKS: RelationSpec = RelationSpec {
    table: "memory_links",
    person_col: "record_id",
    filters: &[("record_type", "person")],
    dedup_cols: &["memory_id", "role"],
    touch_updated_at: false,
};
const TAGGINGS: RelationSpec = RelationSpec {
    table: "taggings",
    person_col: "record_id",
    filters: &[("record_type", "person")],
    dedup_cols: &["tag_id"],
    touch_updated_at: false,
};
/// Counted generically; applied by [`move_affiliations`] because of the
/// is_current / is_primary single-row handoff and field enrichment.
const AFFILIATIONS: RelationSpec = RelationSpec {
    table: "affiliations",
    person_col: "person_id",
    filters: &[],
    dedup_cols: &["organization_id", "title"],
    touch_updated_at: false,
};
/// Counted generically; applied by [`move_external_identities`] because an
/// identity already owned by a third entity is a hard error, not a duplicate.
const EXTERNAL_IDENTITIES: RelationSpec = RelationSpec {
    table: "external_identities",
    person_col: "entity_id",
    filters: &[("entity_type", "person")],
    dedup_cols: &["source_id", "kind", "external_id"],
    touch_updated_at: false,
};

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
            // Always 0: provenance rows are deliberately left on the archived
            // source as the record of where its data came from, never moved.
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
    let value: i64 = conn.query_row(sql, rusqlite::params_from_iter(args.iter()), |row| {
        row.get(0)
    })?;
    Ok(value as usize)
}

/// Dry-run estimate for one relation: how many rows would move versus collapse
/// into an existing target row. Drives the merge plan from the same [`RelationSpec`]
/// the apply step uses.
fn count_relation(
    conn: &Connection,
    spec: &RelationSpec,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<MoveStats, CliError> {
    let total_sql = format!(
        "SELECT COUNT(*) FROM {table} WHERE {person_col} = ?1{filters}",
        table = spec.table,
        person_col = spec.person_col,
        filters = spec.filter_clause(""),
    );
    let dedup_match = spec
        .dedup_cols
        .iter()
        .map(|col| format!("COALESCE(target.{col}, '') = COALESCE(source.{col}, '')"))
        .collect::<Vec<_>>()
        .join(" AND ");
    let duplicate_sql = format!(
        "SELECT COUNT(*)
         FROM {table} source
         WHERE source.{person_col} = ?1{source_filters}
           AND EXISTS (
             SELECT 1 FROM {table} target
             WHERE target.{person_col} = ?2{target_filters}
               AND {dedup_match}
           )",
        table = spec.table,
        person_col = spec.person_col,
        source_filters = spec.filter_clause("source."),
        target_filters = spec.filter_clause("target."),
    );
    let total = count(conn, &total_sql, &[from_person_id])?;
    let merged = count(conn, &duplicate_sql, &[from_person_id, to_person_id])?;
    Ok(MoveStats {
        moved: total.saturating_sub(merged),
        merged,
    })
}

/// Apply one relation move: re-point each source row to the target, or delete it
/// when the target already owns an equivalent row (per the spec's dedup columns).
fn move_relation(
    conn: &Connection,
    spec: &RelationSpec,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<MoveStats, CliError> {
    let key_cols = spec.dedup_cols.join(", ");
    let select_sql = format!(
        "SELECT id, {key_cols} FROM {table} WHERE {person_col} = ?1{filters} ORDER BY {key_cols}, id",
        table = spec.table,
        person_col = spec.person_col,
        filters = spec.filter_clause(""),
    );
    let rows = {
        let mut stmt = conn.prepare(&select_sql)?;
        let key_count = spec.dedup_cols.len();
        let rows = stmt.query_map(params![from_person_id], |row| {
            let id: String = row.get(0)?;
            let mut keys = Vec::with_capacity(key_count);
            for index in 0..key_count {
                keys.push(row.get::<_, Option<String>>(index + 1)?);
            }
            Ok((id, keys))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    let dedup_match = spec
        .dedup_cols
        .iter()
        .enumerate()
        .map(|(index, col)| format!("COALESCE({col}, '') = COALESCE(?{}, '')", index + 2))
        .collect::<Vec<_>>()
        .join(" AND ");
    let exists_sql = format!(
        "SELECT EXISTS(SELECT 1 FROM {table} WHERE {person_col} = ?1{filters} AND {dedup_match})",
        table = spec.table,
        person_col = spec.person_col,
        filters = spec.filter_clause(""),
    );
    let delete_sql = format!("DELETE FROM {} WHERE id = ?1", spec.table);
    let update_sql = if spec.touch_updated_at {
        format!(
            "UPDATE {table} SET {person_col} = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
            table = spec.table,
            person_col = spec.person_col,
        )
    } else {
        format!(
            "UPDATE {table} SET {person_col} = ?2 WHERE id = ?1",
            table = spec.table,
            person_col = spec.person_col,
        )
    };

    let mut stats = MoveStats::default();
    for (id, keys) in rows {
        let mut exists_params: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(keys.len() + 1);
        exists_params.push(&to_person_id);
        for key in &keys {
            exists_params.push(key);
        }
        let exists: bool = conn.query_row(
            &exists_sql,
            rusqlite::params_from_iter(exists_params),
            |row| row.get(0),
        )?;
        if exists {
            stats.merged += conn.execute(&delete_sql, params![id])?;
        } else {
            stats.moved += conn.execute(&update_sql, params![id, to_person_id])?;
        }
    }
    Ok(stats)
}

/// Reject the merge (even on dry-run) when a source external identity is already
/// claimed by some entity other than the target — that is an ownership conflict,
/// not a duplicate to collapse.
fn ensure_external_identities_mergeable(
    conn: &Connection,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<(), CliError> {
    let conflict: Option<ExternalIdentityConflict> = conn
        .query_row(
            "SELECT source.source_id, source.kind, source.external_id,
                    owner.entity_type, owner.entity_id
             FROM external_identities source
             JOIN external_identities owner
               ON owner.source_id = source.source_id
              AND owner.kind = source.kind
              AND owner.external_id = source.external_id
              AND owner.id <> source.id
             WHERE source.entity_type = 'person'
               AND source.entity_id = ?1
               AND NOT (owner.entity_type = 'person' AND owner.entity_id = ?2)
             LIMIT 1",
            params![from_person_id, to_person_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()?;
    if let Some((source_id, kind, external_id, entity_type, entity_id)) = conflict {
        return Err(CliError::Runtime(format!(
            "external identity {source_id}:{kind}:{external_id} is already owned by {entity_type}:{entity_id}"
        )));
    }
    Ok(())
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

fn source_provenance_rows(conn: &Connection, from_person_id: &str) -> Result<usize, CliError> {
    count(
        conn,
        "SELECT COUNT(*) FROM record_provenance WHERE record_type = 'person' AND record_id = ?1",
        &[from_person_id],
    )
}

/// Build the dry-run merge plan: per-relation move/merge estimates plus the
/// profile/notes/provenance fields that describe the pre-merge state. Fails fast
/// if external identities can't be merged (a third-party owner conflict).
fn plan_person_merge(
    conn: &Connection,
    from_person_id: &str,
    to_person_id: &str,
) -> Result<MergePlan, CliError> {
    ensure_external_identities_mergeable(conn, from_person_id, to_person_id)?;
    Ok(MergePlan {
        emails: count_relation(conn, &EMAILS, from_person_id, to_person_id)?,
        phones: count_relation(conn, &PHONES, from_person_id, to_person_id)?,
        affiliations: count_relation(conn, &AFFILIATIONS, from_person_id, to_person_id)?,
        participants: count_relation(conn, &PARTICIPANTS, from_person_id, to_person_id)?,
        document_links: count_relation(conn, &DOCUMENT_LINKS, from_person_id, to_person_id)?,
        project_links: count_relation(conn, &PROJECT_LINKS, from_person_id, to_person_id)?,
        task_links: count_relation(conn, &TASK_LINKS, from_person_id, to_person_id)?,
        asset_links: count_relation(conn, &ASSET_LINKS, from_person_id, to_person_id)?,
        memory_links: count_relation(conn, &MEMORY_LINKS, from_person_id, to_person_id)?,
        taggings: count_relation(conn, &TAGGINGS, from_person_id, to_person_id)?,
        external_identities: count_relation(
            conn,
            &EXTERNAL_IDENTITIES,
            from_person_id,
            to_person_id,
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
        source_provenance_rows_preserved: source_provenance_rows(conn, from_person_id)?,
        profile_fields_filled: profile_fields_filled(conn, from_person_id, to_person_id)?,
        notes_appended: notes_would_append(conn, from_person_id, to_person_id)?,
        warnings: Vec::new(),
    })
}

/// Move affiliations onto the target. Bespoke because at most one row may stay
/// `is_current` / `is_primary` (the target keeps any it already has; the first
/// eligible source row may claim a still-open slot), and because a duplicate
/// (same org + title) is enriched — blank target fields are filled from the source
/// — before the source row is dropped.
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
            "SELECT id, organization_id, title, COALESCE(title, ''), department, role,
                    role_family, seniority, is_current, is_primary
             FROM affiliations
             WHERE person_id = ?1
             ORDER BY created_at, id",
        )?;
        let rows = stmt.query_map(params![from_person_id], |row| {
            Ok(AffiliationMergeRow {
                id: row.get(0)?,
                organization_id: row.get(1)?,
                title: row.get(2)?,
                title_key: row.get(3)?,
                department: row.get(4)?,
                role: row.get(5)?,
                role_family: row.get(6)?,
                seniority: row.get(7)?,
                is_current: row.get(8)?,
                is_primary: row.get(9)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut stats = MoveStats::default();
    let mut current_taken = target_has_current;
    let mut primary_taken = target_has_primary;
    for row in rows {
        let existing_target_id: Option<String> = conn
            .query_row(
                "SELECT id FROM affiliations
               WHERE person_id = ?1
                 AND organization_id = ?2
                 AND COALESCE(title, '') = ?3
               LIMIT 1",
                params![to_person_id, row.organization_id, row.title_key],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(existing_target_id) = existing_target_id {
            let promote_current = row.is_current == 1 && !current_taken;
            let promote_primary = row.is_primary == 1 && !primary_taken;
            conn.execute(
                "UPDATE affiliations
                 SET title = CASE
                       WHEN (title IS NULL OR trim(title) = '') AND ?2 IS NOT NULL THEN ?2 ELSE title END,
                     department = CASE
                       WHEN (department IS NULL OR trim(department) = '') AND ?3 IS NOT NULL THEN ?3 ELSE department END,
                     role = CASE
                       WHEN (role IS NULL OR trim(role) = '') AND ?4 IS NOT NULL THEN ?4 ELSE role END,
                     role_family = CASE
                       WHEN (role_family IS NULL OR trim(role_family) = '') AND ?5 IS NOT NULL THEN ?5 ELSE role_family END,
                     seniority = CASE
                       WHEN (seniority IS NULL OR trim(seniority) = '') AND ?6 IS NOT NULL THEN ?6 ELSE seniority END,
                     is_current = CASE WHEN ?7 = 1 THEN 1 ELSE is_current END,
                     is_primary = CASE WHEN ?8 = 1 THEN 1 ELSE is_primary END,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ?1",
                params![
                    existing_target_id,
                    row.title.as_deref(),
                    row.department.as_deref(),
                    row.role.as_deref(),
                    row.role_family.as_deref(),
                    row.seniority.as_deref(),
                    i64::from(promote_current),
                    i64::from(promote_primary),
                ],
            )?;
            current_taken |= promote_current;
            primary_taken |= promote_primary;
            stats.merged +=
                conn.execute("DELETE FROM affiliations WHERE id = ?1", params![row.id])?;
        } else {
            let keep_current = row.is_current == 1 && !current_taken;
            let keep_primary = row.is_primary == 1 && !primary_taken;
            stats.moved += conn.execute(
                "UPDATE affiliations
                 SET person_id = ?2,
                     is_current = ?3,
                     is_primary = ?4,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ?1",
                params![
                    row.id,
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

/// Move external identities onto the target. Bespoke because an identity already
/// claimed by some *other* entity is a hard error rather than a duplicate to
/// collapse (the dry-run preflight in [`ensure_external_identities_mergeable`]
/// catches the same conflict up front).
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
    // Fail before mutating anything if an external identity can't be merged.
    ensure_external_identities_mergeable(conn, from_person_id, to_person_id)?;

    // Snapshot the fields that describe the pre-merge source/target before any
    // mutation, since `fill_person_profile_from_source` and the moves below would
    // otherwise change what these report.
    let profile_fields_filled = profile_fields_filled(conn, from_person_id, to_person_id)?;
    let notes_appended = notes_would_append(conn, from_person_id, to_person_id)?;
    let source_provenance_rows_preserved = source_provenance_rows(conn, from_person_id)?;

    fill_person_profile_from_source(conn, from_person_id, to_person_id)?;

    let emails = move_relation(conn, &EMAILS, from_person_id, to_person_id)?;
    let phones = move_relation(conn, &PHONES, from_person_id, to_person_id)?;
    normalize_primary_email(conn, to_person_id)?;
    normalize_primary_phone(conn, to_person_id)?;
    let affiliations = move_affiliations(conn, from_person_id, to_person_id)?;
    sync_person_current_affiliation(conn, to_person_id)?;
    sync_person_current_affiliation(conn, from_person_id)?;
    let participants = move_relation(conn, &PARTICIPANTS, from_person_id, to_person_id)?;
    let document_links = move_relation(conn, &DOCUMENT_LINKS, from_person_id, to_person_id)?;
    let project_links = move_relation(conn, &PROJECT_LINKS, from_person_id, to_person_id)?;
    let task_links = move_relation(conn, &TASK_LINKS, from_person_id, to_person_id)?;
    let asset_links = move_relation(conn, &ASSET_LINKS, from_person_id, to_person_id)?;
    let memory_links = move_relation(conn, &MEMORY_LINKS, from_person_id, to_person_id)?;
    let taggings = move_relation(conn, &TAGGINGS, from_person_id, to_person_id)?;
    let external_identities = move_external_identities(conn, from_person_id, to_person_id)?;

    super::super::participants::recompute_relationship_intelligence(conn, to_person_id)?;
    super::super::participants::recompute_relationship_intelligence(conn, from_person_id)?;

    let evidence_refs = conn.execute(
        "UPDATE evidence_refs SET subject_id = ?2
         WHERE subject_type = 'person' AND subject_id = ?1",
        params![from_person_id, to_person_id],
    )?;
    let facts = conn.execute(
        "UPDATE extracted_facts
         SET subject_id = ?2,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE subject_type = 'person' AND subject_id = ?1",
        params![from_person_id, to_person_id],
    )?;
    let ai_notes = conn.execute(
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
    let source_records = source_facts + source_tasks + source_chunks;
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

    Ok(MergePlan {
        emails,
        phones,
        affiliations,
        participants,
        document_links,
        project_links,
        task_links,
        asset_links,
        memory_links,
        taggings,
        external_identities,
        evidence_refs,
        facts,
        ai_notes,
        source_records,
        source_provenance_rows_preserved,
        profile_fields_filled,
        notes_appended,
        warnings: Vec::new(),
    })
}

/// Merge a duplicate person into a canonical target: move every handle, link,
/// and reference onto the target, fill blank profile fields, then soft-archive
/// the source. `--dry-run` reports the same plan without writing. Refuses to merge
/// the self person away. Provenance rows stay on the archived source.
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
    if args.dry_run {
        let plan = plan_person_merge(conn, args.from_person_id, args.to_person_id)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dry_run_preflight_detects_external_identity_owner_conflict() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE external_identities (
               id TEXT PRIMARY KEY,
               entity_type TEXT NOT NULL,
               entity_id TEXT NOT NULL,
               source_id TEXT NOT NULL,
               kind TEXT NOT NULL,
               external_id TEXT NOT NULL
             );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO external_identities
               (id, entity_type, entity_id, source_id, kind, external_id)
             VALUES
               ('source-identity', 'person', 'source-person', 'src', 'record', 'shared'),
               ('conflict-identity', 'person', 'other-person', 'src', 'record', 'shared')",
            [],
        )
        .unwrap();

        let err = ensure_external_identities_mergeable(&conn, "source-person", "target-person")
            .unwrap_err();
        assert!(err
            .to_string()
            .contains("src:record:shared is already owned by person:other-person"));

        conn.execute(
            "UPDATE external_identities
             SET entity_id = 'target-person'
             WHERE id = 'conflict-identity'",
            [],
        )
        .unwrap();
        ensure_external_identities_mergeable(&conn, "source-person", "target-person").unwrap();
    }
}
