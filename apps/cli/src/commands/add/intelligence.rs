//! Staged import and enrichment commands: transcripts, AI notes, extracted
//! facts, profile enrichment, tags, fact promotion, and import completeness
//! checks. These are provider-neutral writes; upstream-specific agents translate
//! Gmail, Granola, Reflect notes, and other sources into these typed calls.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use super::identity::{
    external_kind, find_external_identity, insert_external_identity, insert_record_provenance,
    source_id, ExternalIdentityWrite, RecordProvenanceWrite,
};
use super::links::{insert_chunks, insert_evidence_refs, replace_chunks};
use super::record_ref::{parse_record_ref, require_record, RECORD_TYPES};
use super::text::normalize_optional;
use crate::commands::{now_iso, EvidenceRef};
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;
use crate::text::{content_hash, normalize_text};

/// Inputs for `brain import transcript`.
///
/// A transcript is raw evidence attached to an interaction. It is chunked for
/// retrieval separately from the interaction shell so citations can point at
/// the exact transcript text rather than a lossy meeting summary.
pub struct AddTranscriptArgs<'a> {
    pub interaction_id: &'a str,
    pub body: String,
    pub format: &'a str,
    pub language: Option<&'a str>,
    pub segments_json: Option<&'a str>,
    pub recording_url: Option<&'a str>,
    pub storage_path: Option<&'a str>,
    pub source_slug: Option<&'a str>,
    pub external_kind: &'a str,
    pub external_id: Option<&'a str>,
    pub transcribed_by: Option<&'a str>,
    pub transcribed_at: Option<&'a str>,
    pub metadata_json: Option<&'a str>,
}

/// Inputs for `brain add ai-note`.
///
/// AI notes are narrative model artifacts such as summaries, decisions, risks,
/// or coaching notes. They are visible records with citations; they are not
/// hidden memories.
pub struct AddAiNoteArgs<'a> {
    pub kind: &'a str,
    pub interaction_id: Option<&'a str>,
    pub document_id: Option<&'a str>,
    pub subject: Option<&'a str>,
    pub title: Option<&'a str>,
    pub content: String,
    pub content_format: &'a str,
    pub model: Option<&'a str>,
    pub prompt_fingerprint: Option<&'a str>,
    pub source_slug: Option<&'a str>,
    pub metadata_json: Option<&'a str>,
    pub evidence: Vec<EvidenceRef>,
}

/// Inputs for `brain add fact`.
///
/// Facts are append-only structured claims. They can cite exact chunks and can
/// later be promoted into curated memories when the claim is worth preserving.
pub struct AddFactArgs<'a> {
    pub subject: &'a str,
    pub key: &'a str,
    pub value_text: Option<&'a str>,
    pub value_json: Option<&'a str>,
    pub confidence: Option<f64>,
    pub source_record: Option<&'a str>,
    pub source_excerpt: Option<&'a str>,
    pub observed_at: Option<&'a str>,
    pub model: Option<&'a str>,
    pub prompt_fingerprint: Option<&'a str>,
    pub metadata_json: Option<&'a str>,
    pub evidence: Vec<EvidenceRef>,
}

/// Inputs for `brain enrich person`.
///
/// Enrichment updates profile/cache fields and regenerates person search chunks
/// without creating a new person.
pub struct EnrichPersonArgs<'a> {
    pub id: &'a str,
    pub preferred_name: Option<&'a str>,
    pub headline: Option<&'a str>,
    pub summary: Option<&'a str>,
    pub location: Option<&'a str>,
    pub city: Option<&'a str>,
    pub region: Option<&'a str>,
    pub country: Option<&'a str>,
    pub timezone: Option<&'a str>,
    pub linkedin_url: Option<&'a str>,
    pub website: Option<&'a str>,
    pub important_dates_json: Option<&'a str>,
    pub current_title: Option<&'a str>,
    pub current_department: Option<&'a str>,
    pub role_family: Option<&'a str>,
    pub seniority: Option<&'a str>,
    pub notes: Option<&'a str>,
}

/// Inputs for `brain enrich organization`.
///
/// Organization enrichment updates the canonical org row and can also write an
/// `organization_profiles` research artifact when model/profile fields are
/// present.
pub struct EnrichOrganizationArgs<'a> {
    pub id: &'a str,
    pub kind: Option<&'a str>,
    pub domain: Option<&'a str>,
    pub headline: Option<&'a str>,
    pub summary: Option<&'a str>,
    pub website: Option<&'a str>,
    pub industry: Option<&'a str>,
    pub location: Option<&'a str>,
    pub hq_city: Option<&'a str>,
    pub hq_region: Option<&'a str>,
    pub hq_country: Option<&'a str>,
    pub notes: Option<&'a str>,
    pub model: Option<&'a str>,
    pub prompt_fingerprint: Option<&'a str>,
    pub canonical_name: Option<&'a str>,
    pub one_line_description: Option<&'a str>,
    pub category: Option<&'a str>,
    pub why_it_matters: Option<&'a str>,
    pub offerings_json: Option<&'a str>,
    pub notable_people_json: Option<&'a str>,
    pub suggested_tags_json: Option<&'a str>,
    pub review_flags_json: Option<&'a str>,
    pub source_urls_json: Option<&'a str>,
    pub raw_enrichment_json: Option<&'a str>,
    pub source_slug: Option<&'a str>,
}

/// Inputs for `brain promote fact`.
///
/// Promotion turns one reviewed extracted fact into a hidden curated memory and
/// copies the fact's evidence refs onto the memory.
pub struct PromoteFactArgs<'a> {
    pub fact_id: &'a str,
    pub memory_kind: &'a str,
}

/// Inputs for `brain tag ensure`.
///
/// Tags are reusable user-facing labels that can be attached to any typed
/// record through `taggings`.
pub struct TagEnsureArgs<'a> {
    pub name: &'a str,
    pub slug: Option<&'a str>,
    pub color: Option<&'a str>,
    pub description: Option<&'a str>,
}

/// Inputs for `brain tag attach`.
///
/// `record` is a provider-neutral typed reference such as `project:<id>` or
/// `interaction:<id>`.
pub struct TagAttachArgs<'a> {
    pub tag: &'a str,
    pub record: &'a str,
    pub source_slug: Option<&'a str>,
}

fn normalize_json(raw: Option<&str>, field: &str) -> Result<Option<String>, CliError> {
    let Some(value) = normalize_optional(raw) else {
        return Ok(None);
    };
    serde_json::from_str::<Value>(&value)
        .map_err(|e| CliError::Runtime(format!("{field} must be valid JSON: {e}")))?;
    Ok(Some(value))
}

fn promoted_memory_claim(value_text: Option<String>, value_json: Option<String>) -> String {
    value_text
        .and_then(|value| normalize_optional(Some(&value)))
        .or_else(|| value_json.and_then(|value| normalize_optional(Some(&value))))
        .unwrap_or_default()
}

fn report_written(
    json_output: bool,
    kind: &str,
    id: &str,
    chunk_count: usize,
) -> Result<(), CliError> {
    if json_output {
        print_json(&json!({
            "kind": kind,
            "id": id,
            "chunkCount": chunk_count,
        }))
    } else {
        println!("{kind} {id} ({chunk_count} chunks)");
        Ok(())
    }
}

pub fn add_transcript(
    conn: &mut Connection,
    json_output: bool,
    args: AddTranscriptArgs,
) -> Result<(), CliError> {
    require_record(conn, "interaction", args.interaction_id)?;
    let body = normalize_text(&args.body);
    if body.is_empty() {
        return Err(CliError::Runtime("a transcript needs body text".into()));
    }
    let segments_json = normalize_json(args.segments_json, "--segments-json")?;
    let metadata_json = normalize_json(args.metadata_json, "--metadata-json")?;
    let source_id = source_id(conn, args.source_slug)?;
    let identity_kind = external_kind(args.external_kind);
    let hash = content_hash(&body);

    let existing_by_identity = find_external_identity(
        conn,
        "interaction_transcript",
        source_id.as_deref(),
        &identity_kind,
        args.external_id,
    )?;
    if let Some(existing_id) = existing_by_identity.as_deref() {
        let linked_interaction_id = conn.query_row(
            "SELECT interaction_id FROM interaction_transcripts WHERE id = ?1",
            params![existing_id],
            |row| row.get::<_, String>(0),
        )?;
        if linked_interaction_id != args.interaction_id {
            return Err(CliError::Runtime(format!(
                "transcript external identity belongs to interaction {linked_interaction_id}, not {}",
                args.interaction_id
            )));
        }
    }
    let existing_by_interaction = conn
        .query_row(
            "SELECT id FROM interaction_transcripts WHERE interaction_id = ?1 LIMIT 1",
            params![args.interaction_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let existing = existing_by_identity.or(existing_by_interaction);

    let tx = conn.transaction()?;
    let id = match existing {
        Some(id) => {
            tx.execute(
                "UPDATE interaction_transcripts
                 SET raw_text = ?2,
                     format = ?3,
                     language = COALESCE(?4, language),
                     segments_json = COALESCE(?5, segments_json),
                     recording_url = COALESCE(?6, recording_url),
                     storage_path = COALESCE(?7, storage_path),
                     source_id = COALESCE(?8, source_id),
                     source_external_id = COALESCE(?9, source_external_id),
                     transcribed_by = COALESCE(?10, transcribed_by),
                     transcribed_at = COALESCE(?11, transcribed_at),
                     content_hash = ?12,
                     metadata_json = COALESCE(?13, metadata_json),
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ?1",
                params![
                    id,
                    body,
                    normalize_optional(Some(args.format)).unwrap_or_else(|| "plain_text".into()),
                    normalize_optional(args.language),
                    segments_json,
                    normalize_optional(args.recording_url),
                    normalize_optional(args.storage_path),
                    source_id.as_deref(),
                    normalize_optional(args.external_id),
                    normalize_optional(args.transcribed_by),
                    normalize_optional(args.transcribed_at),
                    hash,
                    metadata_json,
                ],
            )?;
            id
        }
        None => {
            let id = new_id();
            tx.execute(
                "INSERT INTO interaction_transcripts
                   (id, interaction_id, raw_text, format, language, segments_json,
                    recording_url, storage_path, source_id, source_external_id,
                    transcribed_by, transcribed_at, content_hash, metadata_json)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
                params![
                    id,
                    args.interaction_id,
                    body,
                    normalize_optional(Some(args.format)).unwrap_or_else(|| "plain_text".into()),
                    normalize_optional(args.language),
                    segments_json,
                    normalize_optional(args.recording_url),
                    normalize_optional(args.storage_path),
                    source_id.as_deref(),
                    normalize_optional(args.external_id),
                    normalize_optional(args.transcribed_by),
                    normalize_optional(args.transcribed_at),
                    hash,
                    metadata_json,
                ],
            )?;
            id
        }
    };
    insert_external_identity(
        &tx,
        ExternalIdentityWrite {
            entity_type: "interaction_transcript",
            entity_id: &id,
            source_id: source_id.as_deref(),
            kind: &identity_kind,
            external_id: args.external_id,
            url: args.recording_url,
            force_duplicate: false,
        },
    )?;
    insert_record_provenance(
        &tx,
        RecordProvenanceWrite {
            record_type: "interaction_transcript",
            record_id: &id,
            provenance_kind: "imported",
            source_id: source_id.as_deref(),
            original_path: args.storage_path,
            original_url: args.recording_url,
            model: args.transcribed_by,
            prompt_fingerprint: None,
            metadata_json: metadata_json.as_deref(),
        },
    )?;
    let count = replace_chunks(&tx, "interaction_transcript", &id, &body)?;
    tx.commit()?;
    report_written(json_output, "interaction_transcript", &id, count)
}

pub fn add_ai_note(
    conn: &mut Connection,
    json_output: bool,
    args: AddAiNoteArgs,
) -> Result<(), CliError> {
    let content = normalize_text(&args.content);
    if content.is_empty() {
        return Err(CliError::Runtime("an AI note needs content".into()));
    }
    let (subject_type, subject_id) = match args.subject {
        Some(subject) => {
            let (kind, id) = parse_record_ref(subject, "--subject")?;
            require_record(conn, &kind, &id)?;
            (Some(kind), Some(id))
        }
        None => (None, None),
    };
    let anchor_count = usize::from(args.interaction_id.is_some())
        + usize::from(args.document_id.is_some())
        + usize::from(subject_type.is_some());
    if anchor_count != 1 {
        return Err(CliError::Runtime(
            "provide exactly one of --interaction, --document, or --subject".into(),
        ));
    }
    if let Some(id) = args.interaction_id {
        require_record(conn, "interaction", id)?;
    }
    if let Some(id) = args.document_id {
        require_record(conn, "document", id)?;
    }
    let metadata_json = normalize_json(args.metadata_json, "--metadata-json")?;
    let source_id = source_id(conn, args.source_slug)?;
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO ai_notes
           (id, kind, interaction_id, document_id, subject_type, subject_id, title,
            content, content_format, model, prompt_fingerprint, source_id,
            metadata_json, generated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
        params![
            id,
            normalize_optional(Some(args.kind)).unwrap_or_else(|| "summary".into()),
            args.interaction_id,
            args.document_id,
            subject_type.as_deref(),
            subject_id.as_deref(),
            normalize_optional(args.title),
            content,
            normalize_optional(Some(args.content_format)).unwrap_or_else(|| "markdown".into()),
            normalize_optional(args.model),
            normalize_optional(args.prompt_fingerprint),
            source_id.as_deref(),
            metadata_json,
            now_iso(&tx)?,
        ],
    )?;
    let count = insert_chunks(&tx, "ai_note", &id, &content)?;
    insert_evidence_refs(&tx, "ai_note", &id, &args.evidence)?;
    insert_record_provenance(
        &tx,
        RecordProvenanceWrite {
            record_type: "ai_note",
            record_id: &id,
            provenance_kind: "generated",
            source_id: source_id.as_deref(),
            original_path: None,
            original_url: None,
            model: args.model,
            prompt_fingerprint: args.prompt_fingerprint,
            metadata_json: metadata_json.as_deref(),
        },
    )?;
    tx.commit()?;
    report_written(json_output, "ai_note", &id, count)
}

pub fn add_fact(
    conn: &mut Connection,
    json_output: bool,
    args: AddFactArgs,
) -> Result<(), CliError> {
    let (subject_type, subject_id) = parse_record_ref(args.subject, "--subject")?;
    require_record(conn, &subject_type, &subject_id)?;
    let key = normalize_optional(Some(args.key))
        .ok_or_else(|| CliError::Runtime("--key cannot be blank".into()))?;
    let value_text = normalize_optional(args.value_text);
    let value_json = normalize_json(args.value_json, "--value-json")?;
    if value_text.is_none() && value_json.is_none() {
        return Err(CliError::Runtime(
            "provide --value-text or --value-json".into(),
        ));
    }
    let (source_record_type, source_record_id) = match args.source_record {
        Some(record) => {
            let (kind, id) = parse_record_ref(record, "--source-record")?;
            require_record(conn, &kind, &id)?;
            (Some(kind), Some(id))
        }
        None => (None, None),
    };
    let metadata_json = normalize_json(args.metadata_json, "--metadata-json")?;
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO extracted_facts
           (id, subject_type, subject_id, key, value_text, value_json, confidence,
            source_record_type, source_record_id, source_excerpt, observed_at,
            model, prompt_fingerprint, metadata_json)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
        params![
            id,
            subject_type,
            subject_id,
            key,
            value_text,
            value_json,
            args.confidence,
            source_record_type.as_deref(),
            source_record_id.as_deref(),
            normalize_optional(args.source_excerpt),
            normalize_optional(args.observed_at),
            normalize_optional(args.model),
            normalize_optional(args.prompt_fingerprint),
            metadata_json,
        ],
    )?;
    let chunk_text = fact_chunk_text(&tx, &id)?;
    let count = insert_chunks(&tx, "extracted_fact", &id, &chunk_text)?;
    insert_evidence_refs(&tx, "extracted_fact", &id, &args.evidence)?;
    insert_record_provenance(
        &tx,
        RecordProvenanceWrite {
            record_type: "extracted_fact",
            record_id: &id,
            provenance_kind: "extracted",
            source_id: None,
            original_path: None,
            original_url: None,
            model: args.model,
            prompt_fingerprint: args.prompt_fingerprint,
            metadata_json: metadata_json.as_deref(),
        },
    )?;
    tx.commit()?;
    report_written(json_output, "extracted_fact", &id, count)
}

pub fn promote_fact(
    conn: &mut Connection,
    json_output: bool,
    args: PromoteFactArgs,
) -> Result<(), CliError> {
    let fact = conn
        .query_row(
            "SELECT subject_type, subject_id, value_text, value_json, confidence, observed_at
             FROM extracted_facts
             WHERE id = ?1 AND archived_at IS NULL",
            params![args.fact_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<f64>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| CliError::NotFound(format!("fact {} not found", args.fact_id)))?;
    let (subject_type, subject_id, value_text, value_json, confidence, observed_at) = fact;
    let claim = promoted_memory_claim(value_text, value_json);
    if let Some(existing_id) = conn
        .query_row(
            "SELECT id FROM memories
             WHERE promoted_from_fact_id = ?1 AND archived_at IS NULL
             LIMIT 1",
            params![args.fact_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    {
        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE memories SET claim = ?1, updated_at = ?2 WHERE id = ?3",
            params![claim.as_str(), now_iso(&tx)?, existing_id],
        )?;
        let count = replace_chunks(&tx, "memory", &existing_id, &claim)?;
        tx.commit()?;
        if json_output {
            return print_json(&json!({
                "kind": "memory",
                "id": existing_id,
                "promotedFromFactId": args.fact_id,
                "isDuplicate": true,
                "chunkCount": count,
            }));
        }
        println!("memory {existing_id}");
        return Ok(());
    }
    let id = new_id();
    let memory_kind = normalize_optional(Some(args.memory_kind)).unwrap_or_else(|| "fact".into());
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO memories
           (id, kind, claim, confidence, valid_from, promoted_from_fact_id)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![
            id,
            memory_kind,
            claim.as_str(),
            confidence,
            observed_at.or(Some(now_iso(&tx)?)),
            args.fact_id,
        ],
    )?;
    let count = insert_chunks(&tx, "memory", &id, &claim)?;
    if RECORD_TYPES.contains(&subject_type.as_str()) {
        tx.execute(
            "INSERT INTO memory_links (id, memory_id, record_type, record_id)
             VALUES (?1,?2,?3,?4)",
            params![new_id(), id, subject_type, subject_id],
        )?;
    }
    insert_record_provenance(
        &tx,
        RecordProvenanceWrite {
            record_type: "memory",
            record_id: &id,
            provenance_kind: "promoted",
            source_id: None,
            original_path: None,
            original_url: None,
            model: None,
            prompt_fingerprint: None,
            metadata_json: None,
        },
    )?;
    let mut stmt = tx.prepare(
        "SELECT chunk_id, quote_start, quote_end, note
         FROM evidence_refs
         WHERE subject_type = 'extracted_fact' AND subject_id = ?1",
    )?;
    let rows = stmt.query_map(params![args.fact_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<i64>>(1)?,
            row.get::<_, Option<i64>>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;
    for row in rows {
        let (chunk_id, quote_start, quote_end, note) = row?;
        tx.execute(
            "INSERT INTO evidence_refs
               (id, subject_type, subject_id, chunk_id, quote_start, quote_end, note)
             VALUES (?1,'memory',?2,?3,?4,?5,?6)",
            params![new_id(), id, chunk_id, quote_start, quote_end, note],
        )?;
    }
    drop(stmt);
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "memory",
            "id": id,
            "promotedFromFactId": args.fact_id,
            "isDuplicate": false,
            "chunkCount": count,
        }))
    } else {
        println!("memory {id}");
        Ok(())
    }
}

pub fn enrich_person(
    conn: &mut Connection,
    json_output: bool,
    args: EnrichPersonArgs,
) -> Result<(), CliError> {
    require_record(conn, "person", args.id)?;
    let important_dates_json = normalize_json(args.important_dates_json, "--important-dates-json")?;
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE people
         SET preferred_name = COALESCE(?2, preferred_name),
             headline = COALESCE(?3, headline),
             summary = COALESCE(?4, summary),
             location = COALESCE(?5, location),
             city = COALESCE(?6, city),
             region = COALESCE(?7, region),
             country = COALESCE(?8, country),
             timezone = COALESCE(?9, timezone),
             linkedin_url = COALESCE(?10, linkedin_url),
             website = COALESCE(?11, website),
             important_dates_json = COALESCE(?12, important_dates_json),
             current_title = COALESCE(?13, current_title),
             current_department = COALESCE(?14, current_department),
             role_family = COALESCE(?15, role_family),
             seniority = COALESCE(?16, seniority),
             notes = COALESCE(?17, notes),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![
            args.id,
            normalize_optional(args.preferred_name),
            normalize_optional(args.headline),
            normalize_optional(args.summary),
            normalize_optional(args.location),
            normalize_optional(args.city),
            normalize_optional(args.region),
            normalize_optional(args.country),
            normalize_optional(args.timezone),
            normalize_optional(args.linkedin_url),
            normalize_optional(args.website),
            important_dates_json,
            normalize_optional(args.current_title),
            normalize_optional(args.current_department),
            normalize_optional(args.role_family),
            normalize_optional(args.seniority),
            normalize_optional(args.notes),
        ],
    )?;
    let text = person_profile_text(&tx, args.id)?;
    let count = replace_chunks(&tx, "person", args.id, &text)?;
    insert_record_provenance(
        &tx,
        RecordProvenanceWrite {
            record_type: "person",
            record_id: args.id,
            provenance_kind: "enriched",
            source_id: None,
            original_path: None,
            original_url: None,
            model: None,
            prompt_fingerprint: None,
            metadata_json: None,
        },
    )?;
    tx.commit()?;
    report_written(json_output, "person", args.id, count)
}

pub fn enrich_organization(
    conn: &mut Connection,
    json_output: bool,
    args: EnrichOrganizationArgs,
) -> Result<(), CliError> {
    require_record(conn, "organization", args.id)?;
    let offerings_json = normalize_json(args.offerings_json, "--offerings-json")?;
    let notable_people_json = normalize_json(args.notable_people_json, "--notable-people-json")?;
    let suggested_tags_json = normalize_json(args.suggested_tags_json, "--suggested-tags-json")?;
    let review_flags_json = normalize_json(args.review_flags_json, "--review-flags-json")?;
    let source_urls_json = normalize_json(args.source_urls_json, "--source-urls-json")?;
    let raw_enrichment_json = normalize_json(args.raw_enrichment_json, "--raw-enrichment-json")?;
    let source_id = source_id(conn, args.source_slug)?;
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE organizations
         SET kind = COALESCE(?2, kind),
             domain = COALESCE(?3, domain),
             headline = COALESCE(?4, headline),
             summary = COALESCE(?5, summary),
             website = COALESCE(?6, website),
             industry = COALESCE(?7, industry),
             location = COALESCE(?8, location),
             hq_city = COALESCE(?9, hq_city),
             hq_region = COALESCE(?10, hq_region),
             hq_country = COALESCE(?11, hq_country),
             notes = COALESCE(?12, notes),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![
            args.id,
            normalize_optional(args.kind),
            normalize_optional(args.domain),
            normalize_optional(args.headline),
            normalize_optional(args.summary),
            normalize_optional(args.website),
            normalize_optional(args.industry),
            normalize_optional(args.location),
            normalize_optional(args.hq_city),
            normalize_optional(args.hq_region),
            normalize_optional(args.hq_country),
            normalize_optional(args.notes),
        ],
    )?;
    let org_count = replace_chunks(
        &tx,
        "organization",
        args.id,
        &organization_profile_text(&tx, args.id)?,
    )?;
    let profile_id = if has_profile_fields(&args) {
        Some(upsert_organization_profile(
            &tx,
            args.id,
            &args,
            source_id.as_deref(),
            offerings_json,
            notable_people_json,
            suggested_tags_json,
            review_flags_json,
            source_urls_json,
            raw_enrichment_json,
        )?)
    } else {
        None
    };
    insert_record_provenance(
        &tx,
        RecordProvenanceWrite {
            record_type: "organization",
            record_id: args.id,
            provenance_kind: "enriched",
            source_id: source_id.as_deref(),
            original_path: None,
            original_url: args.website,
            model: args.model,
            prompt_fingerprint: args.prompt_fingerprint,
            metadata_json: None,
        },
    )?;
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "organization",
            "id": args.id,
            "chunkCount": org_count,
            "profileId": profile_id,
        }))
    } else {
        println!("organization {} ({org_count} chunks)", args.id);
        if let Some(profile_id) = profile_id {
            println!("organization_profile {profile_id}");
        }
        Ok(())
    }
}

pub fn ensure_tag(
    conn: &mut Connection,
    json_output: bool,
    args: TagEnsureArgs,
) -> Result<(), CliError> {
    let name = normalize_optional(Some(args.name))
        .ok_or_else(|| CliError::Runtime("--name cannot be blank".into()))?;
    let slug = normalize_optional(args.slug).unwrap_or_else(|| slugify(&name));
    let existing = conn
        .query_row(
            "SELECT id FROM tags WHERE slug = ?1 OR name = ?2 LIMIT 1",
            params![slug, name],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let id = match existing {
        Some(id) => {
            conn.execute(
                "UPDATE tags
                 SET name = ?2,
                     slug = COALESCE(?3, slug),
                     color = COALESCE(?4, color),
                     description = COALESCE(?5, description),
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ?1",
                params![
                    id,
                    name,
                    slug,
                    normalize_optional(args.color),
                    normalize_optional(args.description),
                ],
            )?;
            id
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO tags (id, name, slug, color, description)
                 VALUES (?1,?2,?3,?4,?5)",
                params![
                    id,
                    name,
                    slug,
                    normalize_optional(args.color),
                    normalize_optional(args.description),
                ],
            )?;
            id
        }
    };
    if json_output {
        print_json(&json!({ "kind": "tag", "id": id, "slug": slug }))
    } else {
        println!("tag {id} ({slug})");
        Ok(())
    }
}

pub fn attach_tag(
    conn: &mut Connection,
    json_output: bool,
    args: TagAttachArgs,
) -> Result<(), CliError> {
    let (record_type, record_id) = parse_record_ref(args.record, "--record")?;
    require_record(conn, &record_type, &record_id)?;
    let tag_id = resolve_tag_id(conn, args.tag)?;
    let source_id = source_id(conn, args.source_slug)?;
    conn.execute(
        "INSERT OR IGNORE INTO taggings (id, tag_id, record_type, record_id, source_id)
         VALUES (?1,?2,?3,?4,?5)",
        params![
            new_id(),
            tag_id,
            record_type,
            record_id,
            source_id.as_deref()
        ],
    )?;
    if json_output {
        print_json(&json!({
            "kind": "tagging",
            "tagId": tag_id,
            "recordType": record_type,
            "recordId": record_id,
        }))
    } else {
        println!("tagged {record_type}:{record_id}");
        Ok(())
    }
}

fn fact_chunk_text(conn: &Connection, id: &str) -> Result<String, CliError> {
    let text = conn.query_row(
        "SELECT subject_type || ':' || subject_id || ' ' || key || ': ' ||
                COALESCE(value_text, value_json, '') ||
                CASE WHEN source_excerpt IS NOT NULL THEN '\nEvidence excerpt: ' || source_excerpt ELSE '' END
         FROM extracted_facts WHERE id = ?1",
        params![id],
        |row| row.get::<_, String>(0),
    )?;
    Ok(text)
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

fn organization_profile_text(conn: &Connection, id: &str) -> Result<String, CliError> {
    conn.query_row(
        "SELECT trim(
            COALESCE(name, '') || ' ' ||
            COALESCE(kind, '') || ' ' ||
            COALESCE(domain, '') || ' ' ||
            COALESCE(headline, '') || ' ' ||
            COALESCE(summary, '') || ' ' ||
            COALESCE(website, '') || ' ' ||
            COALESCE(industry, '') || ' ' ||
            COALESCE(location, '') || ' ' ||
            COALESCE(hq_city, '') || ' ' ||
            COALESCE(hq_region, '') || ' ' ||
            COALESCE(hq_country, '') || ' ' ||
            COALESCE(notes, '')
         ) FROM organizations WHERE id = ?1",
        params![id],
        |row| row.get::<_, String>(0),
    )
    .map_err(CliError::from)
}

fn has_profile_fields(args: &EnrichOrganizationArgs<'_>) -> bool {
    args.model.is_some()
        || args.prompt_fingerprint.is_some()
        || args.canonical_name.is_some()
        || args.one_line_description.is_some()
        || args.category.is_some()
        || args.why_it_matters.is_some()
        || args.offerings_json.is_some()
        || args.notable_people_json.is_some()
        || args.suggested_tags_json.is_some()
        || args.review_flags_json.is_some()
        || args.source_urls_json.is_some()
        || args.raw_enrichment_json.is_some()
}

#[allow(clippy::too_many_arguments)]
fn upsert_organization_profile(
    conn: &Connection,
    organization_id: &str,
    args: &EnrichOrganizationArgs<'_>,
    source_id: Option<&str>,
    offerings_json: Option<String>,
    notable_people_json: Option<String>,
    suggested_tags_json: Option<String>,
    review_flags_json: Option<String>,
    source_urls_json: Option<String>,
    raw_enrichment_json: Option<String>,
) -> Result<String, CliError> {
    let normalized_prompt = normalize_optional(args.prompt_fingerprint);
    let existing = match normalized_prompt.as_deref() {
        Some(ref prompt) => conn
            .query_row(
                "SELECT id FROM organization_profiles
                 WHERE organization_id = ?1 AND prompt_fingerprint = ?2
                 LIMIT 1",
                params![organization_id, prompt],
                |row| row.get::<_, String>(0),
            )
            .optional()?,
        None => conn
            .query_row(
                "SELECT id FROM organization_profiles
                 WHERE organization_id = ?1 AND prompt_fingerprint IS NULL
                 LIMIT 1",
                params![organization_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?,
    };
    let researched_at = now_iso(conn)?;
    let id = match existing {
        Some(id) => {
            conn.execute(
                "UPDATE organization_profiles
                 SET model = COALESCE(?2, model),
                     prompt_fingerprint = COALESCE(?3, prompt_fingerprint),
                     canonical_name = COALESCE(?4, canonical_name),
                     website = COALESCE(?5, website),
                     one_line_description = COALESCE(?6, one_line_description),
                     category = COALESCE(?7, category),
                     why_it_matters = COALESCE(?8, why_it_matters),
                     offerings_json = COALESCE(?9, offerings_json),
                     notable_people_json = COALESCE(?10, notable_people_json),
                     suggested_tags_json = COALESCE(?11, suggested_tags_json),
                     review_flags_json = COALESCE(?12, review_flags_json),
                     source_urls_json = COALESCE(?13, source_urls_json),
                     raw_enrichment_json = COALESCE(?14, raw_enrichment_json),
                     researched_at = ?15,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ?1",
                params![
                    id,
                    normalize_optional(args.model),
                    normalized_prompt.as_deref(),
                    normalize_optional(args.canonical_name),
                    normalize_optional(args.website),
                    normalize_optional(args.one_line_description),
                    normalize_optional(args.category),
                    normalize_optional(args.why_it_matters),
                    offerings_json,
                    notable_people_json,
                    suggested_tags_json,
                    review_flags_json,
                    source_urls_json,
                    raw_enrichment_json,
                    researched_at,
                ],
            )?;
            id
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO organization_profiles
                   (id, organization_id, model, prompt_fingerprint, canonical_name,
                    website, one_line_description, category, why_it_matters,
                    offerings_json, notable_people_json, suggested_tags_json,
                    review_flags_json, source_urls_json, raw_enrichment_json, researched_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
                params![
                    id,
                    organization_id,
                    normalize_optional(args.model),
                    normalized_prompt.as_deref(),
                    normalize_optional(args.canonical_name),
                    normalize_optional(args.website),
                    normalize_optional(args.one_line_description),
                    normalize_optional(args.category),
                    normalize_optional(args.why_it_matters),
                    offerings_json,
                    notable_people_json,
                    suggested_tags_json,
                    review_flags_json,
                    source_urls_json,
                    raw_enrichment_json,
                    researched_at,
                ],
            )?;
            id
        }
    };
    let text = conn.query_row(
        "SELECT trim(
            COALESCE(canonical_name, '') || ' ' ||
            COALESCE(website, '') || ' ' ||
            COALESCE(one_line_description, '') || ' ' ||
            COALESCE(category, '') || ' ' ||
            COALESCE(why_it_matters, '') || ' ' ||
            COALESCE(offerings_json, '') || ' ' ||
            COALESCE(notable_people_json, '') || ' ' ||
            COALESCE(suggested_tags_json, '') || ' ' ||
            COALESCE(review_flags_json, '') || ' ' ||
            COALESCE(source_urls_json, '')
         ) FROM organization_profiles WHERE id = ?1",
        params![id],
        |row| row.get::<_, String>(0),
    )?;
    replace_chunks(conn, "organization_profile", &id, &text)?;
    insert_record_provenance(
        conn,
        RecordProvenanceWrite {
            record_type: "organization_profile",
            record_id: &id,
            provenance_kind: "enriched",
            source_id,
            original_path: None,
            original_url: args.website,
            model: args.model,
            prompt_fingerprint: args.prompt_fingerprint,
            metadata_json: args.raw_enrichment_json,
        },
    )?;
    Ok(id)
}

fn slugify(name: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in name.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    slug.trim_matches('-').to_string()
}

fn resolve_tag_id(conn: &Connection, raw: &str) -> Result<String, CliError> {
    let tag = normalize_optional(Some(raw))
        .ok_or_else(|| CliError::Runtime("--tag cannot be blank".into()))?;
    conn.query_row(
        "SELECT id FROM tags WHERE id = ?1 OR slug = ?1 OR name = ?1 LIMIT 1",
        params![tag],
        |row| row.get::<_, String>(0),
    )
    .optional()?
    .ok_or_else(|| CliError::NotFound(format!("tag {tag} not found")))
}
