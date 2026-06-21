//! Import audit/finalize checks for the staged agent write contract.
//!
//! The CLI deliberately separates *writing* an imported record from declaring it
//! complete. Finalize is the gate that asks whether the raw source, derived AI
//! artifacts, extracted structure, evidence, links, tags, and chunks are all in
//! place. Narrow waivers keep source limitations explicit instead of silently
//! weakening the default audit.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use super::identity::{insert_record_provenance, RecordProvenanceWrite};
use super::record_ref::{parse_record_ref, require_record};
use crate::error::CliError;
use crate::output::print_json;

pub struct ImportAuditArgs {
    /// Number of recent records to inspect per importable kind.
    pub limit: usize,
}

/// Inputs for `brain import finalize`.
///
/// Waivers are intentionally narrow. They mark real source limitations or
/// reviewed non-applicability; they should not be used to paper over incomplete
/// extraction.
pub struct ImportFinalizeArgs<'a> {
    /// Typed record reference, currently usually `interaction:<id>` or
    /// `document:<id>`.
    pub record: &'a str,
    /// Raw source text/transcript is unavailable after a good-faith fetch.
    pub raw_text_unavailable: bool,
    /// The record has no meaningful participants or entities to attach.
    pub no_entities: bool,
    /// The record is not part of a known project or task.
    pub no_project_or_task_link: bool,
    /// The record produced no durable tasks or memories.
    pub no_derived_actions: bool,
    /// The record produced no structured facts worth preserving.
    pub no_extracted_facts: bool,
}

#[derive(Clone, Copy, Default)]
struct CompletionPolicy {
    raw_text_unavailable: bool,
    no_entities: bool,
    no_project_or_task_link: bool,
    no_derived_actions: bool,
    no_extracted_facts: bool,
}

impl CompletionPolicy {
    fn from_finalize(args: &ImportFinalizeArgs<'_>) -> Self {
        Self {
            raw_text_unavailable: args.raw_text_unavailable,
            no_entities: args.no_entities,
            no_project_or_task_link: args.no_project_or_task_link,
            no_derived_actions: args.no_derived_actions,
            no_extracted_facts: args.no_extracted_facts,
        }
    }

    fn has_waivers(self) -> bool {
        self.raw_text_unavailable
            || self.no_entities
            || self.no_project_or_task_link
            || self.no_derived_actions
            || self.no_extracted_facts
    }

    fn to_json(self) -> Option<String> {
        self.has_waivers().then(|| {
            json!({
                "waivers": {
                    "rawTextUnavailable": self.raw_text_unavailable,
                    "noEntities": self.no_entities,
                    "noProjectOrTaskLink": self.no_project_or_task_link,
                    "noDerivedActions": self.no_derived_actions,
                    "noExtractedFacts": self.no_extracted_facts,
                }
            })
            .to_string()
        })
    }
}

pub fn import_finalize(
    conn: &Connection,
    json_output: bool,
    args: ImportFinalizeArgs,
) -> Result<(), CliError> {
    let (kind, id) = parse_record_ref(args.record, "--record")?;
    require_record(conn, &kind, &id)?;
    let policy = CompletionPolicy::from_finalize(&args);
    let missing = completion_missing(conn, &kind, &id, policy)?;
    if missing.is_empty() && !is_finalized(conn, &kind, &id)? {
        let metadata_json = policy.to_json();
        insert_record_provenance(
            conn,
            RecordProvenanceWrite {
                record_type: &kind,
                record_id: &id,
                provenance_kind: "finalized",
                source_id: None,
                original_path: None,
                original_url: None,
                model: None,
                prompt_fingerprint: None,
                metadata_json: metadata_json.as_deref(),
            },
        )?;
    }
    emit_finalize(json_output, &kind, &id, missing, policy)
}

pub fn import_audit(
    conn: &Connection,
    json_output: bool,
    args: ImportAuditArgs,
) -> Result<(), CliError> {
    let mut rows: Vec<Value> = Vec::new();
    for (kind, table, title_col) in [
        ("interaction", "interactions", "title"),
        ("document", "documents", "title"),
    ] {
        let sql = format!(
            "SELECT id, COALESCE({title_col}, '(untitled)') FROM {table}
             WHERE archived_at IS NULL
             ORDER BY updated_at DESC
             LIMIT ?1"
        );
        let mut stmt = conn.prepare(&sql)?;
        let candidates = stmt.query_map(params![args.limit as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for candidate in candidates {
            let (id, title) = candidate?;
            if is_finalized(conn, kind, &id)? {
                continue;
            }
            let missing = completion_missing(conn, kind, &id, CompletionPolicy::default())?;
            if !missing.is_empty() {
                rows.push(json!({
                    "kind": kind,
                    "id": id,
                    "title": title,
                    "missing": missing,
                }));
            }
        }
    }
    if json_output {
        print_json(&json!({
            "checkedPerKind": args.limit,
            "incomplete": rows,
            "incompleteCount": rows.len(),
        }))
    } else {
        if rows.is_empty() {
            println!("all checked imports are complete");
        } else {
            for row in &rows {
                println!(
                    "{}:{} missing {}",
                    row["kind"].as_str().unwrap_or("record"),
                    row["id"].as_str().unwrap_or(""),
                    row["missing"].as_array().map_or(0, Vec::len)
                );
            }
        }
        Ok(())
    }
}

fn completion_missing(
    conn: &Connection,
    kind: &str,
    id: &str,
    policy: CompletionPolicy,
) -> Result<Vec<String>, CliError> {
    let mut missing = Vec::new();
    if !has_external_identity(conn, kind, id)? {
        missing.push("sourceIdentity".to_string());
    }
    if !has_raw_text(conn, kind, id, policy)? {
        missing.push("rawText".to_string());
    }
    if !has_entities(conn, kind, id, policy)? {
        missing.push("participantsOrEntities".to_string());
    }
    if !has_ai_note(conn, kind, id)? {
        missing.push("aiNote".to_string());
    }
    if !has_extracted_fact(conn, kind, id, policy)? {
        missing.push("extractedFacts".to_string());
    }
    if !has_project_or_task_link(conn, kind, id, policy)? {
        missing.push("projectOrTaskLinks".to_string());
    }
    if !has_evidence_backed_task_or_memory(conn, kind, id, policy)? {
        missing.push("evidenceBackedTasksOrMemories".to_string());
    }
    if !has_tags(conn, kind, id)? {
        missing.push("tags".to_string());
    }
    if !has_chunks(conn, kind, id, policy)? {
        missing.push("chunks".to_string());
    }
    Ok(missing)
}

fn exists(conn: &Connection, sql: &str, id: &str) -> Result<bool, CliError> {
    Ok(conn.query_row(sql, params![id], |row| row.get::<_, bool>(0))?)
}

fn exists2(conn: &Connection, sql: &str, first: &str, second: &str) -> Result<bool, CliError> {
    Ok(conn.query_row(sql, params![first, second], |row| row.get::<_, bool>(0))?)
}

fn has_external_identity(conn: &Connection, kind: &str, id: &str) -> Result<bool, CliError> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM external_identities WHERE entity_type = ?1 AND entity_id = ?2)",
        params![kind, id],
        |row| row.get::<_, bool>(0),
    )?)
}

fn is_finalized(conn: &Connection, kind: &str, id: &str) -> Result<bool, CliError> {
    Ok(conn.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM record_provenance
           WHERE record_type = ?1 AND record_id = ?2 AND provenance_kind = 'finalized'
         )",
        params![kind, id],
        |row| row.get::<_, bool>(0),
    )?)
}

fn interaction_kind(conn: &Connection, id: &str) -> Result<Option<String>, CliError> {
    conn.query_row(
        "SELECT kind FROM interactions WHERE id = ?1",
        params![id],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(CliError::from)
}

fn interaction_can_lack_raw_text(conn: &Connection, id: &str) -> Result<bool, CliError> {
    Ok(matches!(
        interaction_kind(conn, id)?.as_deref(),
        Some("event")
    ))
}

fn has_raw_text(
    conn: &Connection,
    kind: &str,
    id: &str,
    policy: CompletionPolicy,
) -> Result<bool, CliError> {
    if policy.raw_text_unavailable {
        return Ok(true);
    }
    match kind {
        "interaction" if interaction_can_lack_raw_text(conn, id)? => Ok(true),
        "interaction" => conn
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM interactions
                   WHERE id = ?1 AND body_text IS NOT NULL AND trim(body_text) != ''
                   UNION
                   SELECT 1 FROM interaction_transcripts
                   WHERE interaction_id = ?1 AND trim(raw_text) != ''
                 )",
                params![id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(CliError::from),
        "document" => exists(
            conn,
            "SELECT EXISTS(SELECT 1 FROM documents WHERE id = ?1 AND body_text IS NOT NULL AND trim(body_text) != '')",
            id,
        ),
        _ => Ok(true),
    }
}

fn has_entities(
    conn: &Connection,
    kind: &str,
    id: &str,
    policy: CompletionPolicy,
) -> Result<bool, CliError> {
    if policy.no_entities {
        return Ok(true);
    }
    match kind {
        "interaction" => conn
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM interaction_participants WHERE interaction_id = ?1
                   UNION
                   SELECT 1 FROM interaction_organizations WHERE interaction_id = ?1
                 )",
                params![id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(CliError::from),
        "document" => conn
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM document_people WHERE document_id = ?1
                   UNION
                   SELECT 1 FROM document_organizations WHERE document_id = ?1
                 )",
                params![id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(CliError::from),
        _ => Ok(true),
    }
}

fn has_ai_note(conn: &Connection, kind: &str, id: &str) -> Result<bool, CliError> {
    match kind {
        "interaction" => exists(
            conn,
            "SELECT EXISTS(
               SELECT 1 FROM ai_notes
               WHERE interaction_id = ?1
                  OR (subject_type = 'interaction' AND subject_id = ?1)
             )",
            id,
        ),
        "document" => exists(
            conn,
            "SELECT EXISTS(
               SELECT 1 FROM ai_notes
               WHERE document_id = ?1
                  OR (subject_type = 'document' AND subject_id = ?1)
             )",
            id,
        ),
        _ => exists2(
            conn,
            "SELECT EXISTS(SELECT 1 FROM ai_notes WHERE subject_type = ?1 AND subject_id = ?2)",
            kind,
            id,
        ),
    }
}

fn has_extracted_fact(
    conn: &Connection,
    kind: &str,
    id: &str,
    policy: CompletionPolicy,
) -> Result<bool, CliError> {
    if policy.no_extracted_facts {
        return Ok(true);
    }
    Ok(conn.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM extracted_facts
           WHERE archived_at IS NULL
             AND (
               (subject_type = ?1 AND subject_id = ?2)
               OR (source_record_type = ?1 AND source_record_id = ?2)
             )
         )",
        params![kind, id],
        |row| row.get::<_, bool>(0),
    )?)
}

fn has_project_or_task_link(
    conn: &Connection,
    kind: &str,
    id: &str,
    policy: CompletionPolicy,
) -> Result<bool, CliError> {
    if policy.no_project_or_task_link {
        return Ok(true);
    }
    match kind {
        "interaction" => conn
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM project_interactions WHERE interaction_id = ?1
                   UNION
                   SELECT 1 FROM task_interactions WHERE interaction_id = ?1
                   UNION
                   SELECT 1 FROM tasks WHERE origin_interaction_id = ?1 AND archived_at IS NULL
                 )",
                params![id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(CliError::from),
        "document" => conn
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM project_documents WHERE document_id = ?1
                   UNION
                   SELECT 1 FROM task_documents WHERE document_id = ?1
                   UNION
                   SELECT 1 FROM tasks WHERE origin_document_id = ?1 AND archived_at IS NULL
                 )",
                params![id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(CliError::from),
        _ => Ok(true),
    }
}

fn has_evidence_backed_task_or_memory(
    conn: &Connection,
    kind: &str,
    id: &str,
    policy: CompletionPolicy,
) -> Result<bool, CliError> {
    if policy.no_derived_actions {
        return Ok(true);
    }
    if kind == "interaction" {
        return Ok(conn.query_row(
            "SELECT EXISTS(
               SELECT 1
               FROM evidence_refs er
               JOIN content_chunks cc ON cc.id = er.chunk_id
               WHERE er.subject_type IN ('task', 'memory')
                 AND (
                   (cc.record_type = 'interaction' AND cc.record_id = ?1)
                   OR (
                     cc.record_type = 'interaction_transcript'
                     AND cc.record_id IN (
                       SELECT id FROM interaction_transcripts WHERE interaction_id = ?1
                     )
                   )
                 )
             )",
            params![id],
            |row| row.get::<_, bool>(0),
        )?);
    }
    Ok(conn.query_row(
        "SELECT EXISTS(
           SELECT 1
           FROM evidence_refs er
           JOIN content_chunks cc ON cc.id = er.chunk_id
           WHERE cc.record_type = ?1
             AND cc.record_id = ?2
             AND er.subject_type IN ('task', 'memory')
         )",
        params![kind, id],
        |row| row.get::<_, bool>(0),
    )?)
}

fn has_tags(conn: &Connection, kind: &str, id: &str) -> Result<bool, CliError> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM taggings WHERE record_type = ?1 AND record_id = ?2)",
        params![kind, id],
        |row| row.get::<_, bool>(0),
    )?)
}

fn has_chunks(
    conn: &Connection,
    kind: &str,
    id: &str,
    policy: CompletionPolicy,
) -> Result<bool, CliError> {
    let present = if kind == "interaction" {
        conn.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM content_chunks
               WHERE record_type = 'interaction' AND record_id = ?1
               UNION
               SELECT 1
               FROM content_chunks
               WHERE record_type = 'interaction_transcript'
                 AND record_id IN (
                   SELECT id FROM interaction_transcripts WHERE interaction_id = ?1
                 )
             )",
            params![id],
            |row| row.get::<_, bool>(0),
        )?
    } else {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM content_chunks WHERE record_type = ?1 AND record_id = ?2)",
            params![kind, id],
            |row| row.get::<_, bool>(0),
        )?
    };
    if present {
        return Ok(true);
    }
    if policy.raw_text_unavailable {
        return Ok(true);
    }
    if kind == "interaction" && interaction_can_lack_raw_text(conn, id)? {
        return Ok(true);
    }
    Ok(false)
}

fn emit_finalize(
    json_output: bool,
    kind: &str,
    id: &str,
    missing: Vec<String>,
    policy: CompletionPolicy,
) -> Result<(), CliError> {
    let complete = missing.is_empty();
    if json_output {
        print_json(&json!({
            "record": { "kind": kind, "id": id },
            "complete": complete,
            "missing": missing,
            "waivers": {
                "rawTextUnavailable": policy.raw_text_unavailable,
                "noEntities": policy.no_entities,
                "noProjectOrTaskLink": policy.no_project_or_task_link,
                "noDerivedActions": policy.no_derived_actions,
                "noExtractedFacts": policy.no_extracted_facts,
            },
        }))
    } else {
        if complete {
            println!("{kind}:{id} complete");
        } else {
            println!("{kind}:{id} incomplete: {}", missing.join(", "));
        }
        Ok(())
    }
}
