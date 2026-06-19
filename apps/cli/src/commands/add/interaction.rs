//! `brain add interaction` — ingest a human interaction (meeting, call, note, …)
//! with its participants, links, and derived chunks in one transaction.
//! Deduped by external identity first, then by content hash; a matched
//! interaction is enriched (links, participants, identity, blank fields) rather
//! than re-created.

use rusqlite::{params, Connection};
use serde_json::json;

use super::identity::{
    external_kind, find_duplicate, find_external_identity, insert_external_identity, source_id,
    ExternalIdentityWrite,
};
use super::links::{insert_chunks, insert_links, replace_chunks};
use super::text::{normalize_optional, normalize_title};
use crate::commands::LinkRef;
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;
use crate::text::{content_hash, normalize_text};

pub struct AddInteractionArgs<'a> {
    pub title: Option<&'a str>,
    pub kind: &'a str,
    pub occurred_at: Option<&'a str>,
    pub source_slug: Option<&'a str>,
    pub external_kind: &'a str,
    pub external_id: Option<&'a str>,
    pub original_url: Option<&'a str>,
    pub summary: Option<&'a str>,
    pub body: String,
    pub links: Vec<LinkRef>,
    pub raw_participants: Vec<&'a str>,
    pub allow_duplicate: bool,
    pub replace_body: bool,
}

fn find_duplicate_interaction(
    conn: &Connection,
    hash: &str,
    identity_kind: &str,
    external_id: Option<&str>,
    source_id: Option<&str>,
) -> Result<Option<String>, CliError> {
    if identity_kind == "record" {
        if let Some(external_id) = normalize_optional(external_id) {
            // The source-scoped `external_identities` lookup already ran in the
            // caller. This legacy fallback matches the denormalized
            // `interactions.external_id` column, but it must NOT merge across
            // sources: an external id is only unique within a source. We therefore
            // skip any interaction that another source has already claimed, and —
            // when this import omits a source — only match unclaimed/legacy rows.
            let id = conn
                .query_row(
                    "SELECT i.id FROM interactions i
                 WHERE i.archived_at IS NULL
                   AND i.external_id IS NOT NULL
                   AND i.external_id = ?1
                   AND NOT EXISTS (
                     SELECT 1 FROM external_identities ei
                     WHERE ei.entity_type = 'interaction'
                       AND ei.entity_id = i.id
                       AND ei.kind = 'record'
                       AND (?2 IS NULL OR ei.source_id <> ?2)
                   )
                 LIMIT 1",
                    params![external_id, source_id],
                    |row| row.get::<_, String>(0),
                )
                .ok();
            if id.is_some() {
                return Ok(id);
            }
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
             summary = CASE
               WHEN (summary IS NULL OR trim(summary) = '') AND ?3 IS NOT NULL
               THEN ?3 ELSE summary END,
             updated_at = CASE
               WHEN ((external_id IS NULL OR trim(external_id) = '') AND ?1 IS NOT NULL)
                 OR ((original_url IS NULL OR trim(original_url) = '') AND ?2 IS NOT NULL)
                 OR ((summary IS NULL OR trim(summary) = '') AND ?3 IS NOT NULL)
               THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE updated_at END
         WHERE id = ?4",
        params![
            normalize_optional(args.external_id),
            normalize_optional(args.original_url),
            normalize_optional(args.summary),
            id,
        ],
    )?;
    Ok(())
}

/// Apply a duplicate import onto an existing interaction: fill blank fields, add
/// any new links/participants, and (re)assert the external identity. The two
/// dedupe paths (external-identity match and content-hash match) both funnel
/// through here so they enrich identically.
fn enrich_existing_interaction(
    tx: &Connection,
    existing: &str,
    args: &AddInteractionArgs,
    source_id: Option<&str>,
    identity_kind: &str,
    replace_body: bool,
) -> Result<(), CliError> {
    enrich_duplicate_interaction(tx, existing, args)?;
    if replace_body {
        let body = normalize_text(&args.body);
        let hash = content_hash(&body);
        tx.execute(
            "UPDATE interactions
             SET body_text = ?1,
                 summary = CASE WHEN ?2 IS NOT NULL THEN ?2 ELSE summary END,
                 content_hash = ?3,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?4",
            params![&body, normalize_optional(args.summary), hash, existing,],
        )?;
        replace_chunks(tx, "interaction", existing, &body)?;
    }
    insert_links(tx, "interaction", existing, &args.links)?;
    insert_raw_participants(tx, existing, source_id, &args.raw_participants)?;
    insert_external_identity(
        tx,
        ExternalIdentityWrite {
            entity_type: "interaction",
            entity_id: existing,
            source_id,
            kind: identity_kind,
            external_id: args.external_id,
            url: args.original_url,
            force_duplicate: false,
        },
    )?;
    Ok(())
}

#[derive(Debug)]
struct RawParticipant {
    role: String,
    handle: Option<String>,
    normalized_handle: Option<String>,
    display_name: Option<String>,
}

fn parse_raw_participant(raw: &str) -> Result<Option<RawParticipant>, CliError> {
    let Some(value) = normalize_optional(Some(raw)) else {
        return Ok(None);
    };
    let (role, payload) = value
        .split_once(':')
        .map(|(role, payload)| (role.trim(), payload.trim()))
        .unwrap_or(("participant", value.as_str()));
    let role = normalize_optional(Some(role)).unwrap_or_else(|| "participant".to_string());
    let payload = normalize_optional(Some(payload)).ok_or_else(|| {
        CliError::Runtime(format!("--participant '{raw}' is missing a name or handle"))
    })?;

    let (display_name, handle) =
        if let (Some(start), Some(end)) = (payload.rfind('<'), payload.rfind('>')) {
            if start < end {
                (
                    normalize_optional(Some(&payload[..start])),
                    normalize_optional(Some(&payload[start + 1..end])),
                )
            } else {
                (Some(payload.clone()), None)
            }
        } else if payload.contains('@') {
            (None, normalize_optional(Some(&payload)))
        } else {
            (Some(payload.clone()), None)
        };

    let normalized_handle = handle.as_deref().map(|handle| {
        if handle.contains('@') {
            handle.to_lowercase()
        } else {
            handle.to_string()
        }
    });
    // Empty angle brackets (e.g. `from:<>`) leave no usable identity. Without a
    // display name or handle the row would violate the interaction_participants
    // CHECK (person_id OR normalized_handle OR display_name), so reject it with
    // the same error used for an entirely missing payload.
    if display_name.is_none() && normalized_handle.is_none() {
        return Err(CliError::Runtime(format!(
            "--participant '{raw}' is missing a name or handle"
        )));
    }
    Ok(Some(RawParticipant {
        role,
        handle,
        normalized_handle,
        display_name,
    }))
}

fn insert_raw_participants(
    conn: &Connection,
    interaction_id: &str,
    source_id: Option<&str>,
    participants: &[&str],
) -> Result<usize, CliError> {
    let mut inserted = 0;
    for raw in participants {
        let Some(participant) = parse_raw_participant(raw)? else {
            continue;
        };
        // Defensive guard: never write a row that fails the migration 0006
        // CHECK, even if a future parser change loses this invariant.
        if participant.normalized_handle.is_none() && participant.display_name.is_none() {
            continue;
        }
        // Migration 0006 only enforces uniqueness for participants that carry a
        // normalized_handle. Name-only participants (e.g. `from:Casey Jordan <>`)
        // have no covering unique index, so INSERT OR IGNORE would append a new
        // identical row on every duplicate interaction re-import. Match the
        // handle index semantics (interaction_id, identity, COALESCE(role, ''))
        // with an explicit existence check before inserting.
        if participant.normalized_handle.is_none() {
            let already_present = conn
                .query_row(
                    "SELECT 1 FROM interaction_participants
                     WHERE interaction_id = ?1
                       AND normalized_handle IS NULL
                       AND display_name = ?2
                       AND COALESCE(role, '') = ?3
                     LIMIT 1",
                    params![interaction_id, participant.display_name, participant.role],
                    |_| Ok(()),
                )
                .ok()
                .is_some();
            if already_present {
                continue;
            }
        }
        let changed = conn.execute(
            "INSERT OR IGNORE INTO interaction_participants
             (id, interaction_id, role, handle, normalized_handle, display_name, source_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![
                new_id(),
                interaction_id,
                participant.role,
                participant.handle,
                participant.normalized_handle,
                participant.display_name,
                source_id,
            ],
        )?;
        inserted += changed;
    }
    Ok(inserted)
}

fn requires_post_analysis(args: &AddInteractionArgs) -> bool {
    args.source_slug
        .is_some_and(|slug| slug.eq_ignore_ascii_case("granola"))
}

fn report_interaction(
    json_output: bool,
    id: &str,
    duplicate: bool,
    chunk_count: usize,
    post_analysis_required: bool,
) -> Result<(), CliError> {
    if json_output {
        let mut value = json!({
            "kind": "interaction",
            "id": id,
            "isDuplicate": duplicate,
            "chunkCount": chunk_count,
        });
        if post_analysis_required {
            value["postAnalysisRequired"] = json!(true);
            value["postAnalysisChecklist"] = json!([
                "summary",
                "people",
                "projects",
                "followUpTasks",
                "stableMemories",
            ]);
        }
        print_json(&value)
    } else {
        if duplicate {
            println!("interaction {id} (duplicate, skipped)");
        } else {
            println!("interaction {id} ({chunk_count} chunks)");
        }
        if post_analysis_required {
            eprintln!(
                "brain: post-analysis required: summary, people, projects, follow-up tasks, stable memories"
            );
        }
        Ok(())
    }
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
    let source_id = source_id(conn, args.source_slug)?;
    let identity_kind = external_kind(args.external_kind);
    if args.replace_body && body.is_empty() {
        return Err(CliError::Runtime(
            "--replace-body requires body text".into(),
        ));
    }
    if args.replace_body && (source_id.is_none() || normalize_optional(args.external_id).is_none())
    {
        return Err(CliError::Runtime(
            "--replace-body requires --source and --external-id".into(),
        ));
    }
    let existing_by_external = find_external_identity(
        conn,
        "interaction",
        source_id.as_deref(),
        &identity_kind,
        args.external_id,
    )?;
    if let Some(existing) = existing_by_external.as_deref() {
        if !args.allow_duplicate {
            let tx = conn.transaction()?;
            enrich_existing_interaction(
                &tx,
                existing,
                &args,
                source_id.as_deref(),
                &identity_kind,
                args.replace_body,
            )?;
            tx.commit()?;
            return report_interaction(json, existing, true, 0, requires_post_analysis(&args));
        }
    }
    let existing_by_dup = find_duplicate_interaction(
        conn,
        &hash,
        &identity_kind,
        args.external_id,
        source_id.as_deref(),
    )?;
    if let Some(existing) = existing_by_dup.as_deref() {
        if !args.allow_duplicate {
            let tx = conn.transaction()?;
            enrich_existing_interaction(
                &tx,
                existing,
                &args,
                source_id.as_deref(),
                &identity_kind,
                false,
            )?;
            tx.commit()?;
            return report_interaction(json, existing, true, 0, requires_post_analysis(&args));
        }
    }
    // Reaching here past a match means `--allow-duplicate` forced a new record; it
    // must not steal the matched interaction's external identity.
    let force_duplicate = existing_by_external.is_some() || existing_by_dup.is_some();
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO interactions
         (id, kind, title, body_text, summary, occurred_at, external_id, original_url, content_hash)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            id,
            args.kind,
            title,
            body,
            normalize_optional(args.summary),
            args.occurred_at,
            normalize_optional(args.external_id),
            normalize_optional(args.original_url),
            hash
        ],
    )?;
    let count = insert_chunks(&tx, "interaction", &id, &body)?;
    insert_links(&tx, "interaction", &id, &args.links)?;
    insert_raw_participants(&tx, &id, source_id.as_deref(), &args.raw_participants)?;
    insert_external_identity(
        &tx,
        ExternalIdentityWrite {
            entity_type: "interaction",
            entity_id: &id,
            source_id: source_id.as_deref(),
            kind: &identity_kind,
            external_id: args.external_id,
            url: args.original_url,
            force_duplicate,
        },
    )?;
    tx.commit()?;
    report_interaction(json, &id, false, count, requires_post_analysis(&args))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_participant_rejects_empty_brackets() {
        let err = parse_raw_participant("from:<>").unwrap_err();
        assert!(matches!(err, CliError::Runtime(_)));
        let err = parse_raw_participant("from: <>").unwrap_err();
        assert!(matches!(err, CliError::Runtime(_)));
    }

    #[test]
    fn parse_participant_keeps_named_and_handled() {
        // A display name alone is enough to satisfy the CHECK.
        let named = parse_raw_participant("from:Name <>").unwrap().unwrap();
        assert_eq!(named.display_name.as_deref(), Some("Name"));
        assert!(named.normalized_handle.is_none());

        let handled = parse_raw_participant("from:Robin <robin@example.com>")
            .unwrap()
            .unwrap();
        assert_eq!(handled.display_name.as_deref(), Some("Robin"));
        assert_eq!(
            handled.normalized_handle.as_deref(),
            Some("robin@example.com")
        );
    }

    #[test]
    fn parse_participant_skips_blank() {
        assert!(parse_raw_participant("   ").unwrap().is_none());
    }

    fn interaction_args<'a>(
        body: &str,
        external_id: Option<&'a str>,
        allow_duplicate: bool,
    ) -> AddInteractionArgs<'a> {
        AddInteractionArgs {
            title: Some("Subject"),
            kind: "note",
            occurred_at: None,
            source_slug: Some("manual"),
            external_kind: "record",
            external_id,
            original_url: None,
            summary: None,
            body: body.to_string(),
            links: vec![],
            raw_participants: vec![],
            allow_duplicate,
            replace_body: false,
        }
    }

    #[test]
    fn allow_duplicate_interaction_does_not_steal_external_identity() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // First import: an interaction owning external id int-1.
        add_interaction(
            &mut conn,
            true,
            interaction_args("first body", Some("int-1"), false),
        )
        .unwrap();
        let original_id: String = conn
            .query_row(
                "SELECT entity_id FROM external_identities
                 WHERE entity_type = 'interaction' AND external_id = 'int-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        // A forced duplicate (distinct body, so find_duplicate_interaction would
        // not match on content) for the same external id must succeed and leave
        // the identity on the original interaction.
        add_interaction(
            &mut conn,
            true,
            interaction_args("a totally different body", Some("int-1"), true),
        )
        .unwrap();

        let interaction_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM interactions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            interaction_count, 2,
            "allow-duplicate must fork a second interaction"
        );
        let identity_rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM external_identities
                 WHERE entity_type = 'interaction' AND external_id = 'int-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            identity_rows, 1,
            "the unique external identity stays a single row"
        );
        let identity_target: String = conn
            .query_row(
                "SELECT entity_id FROM external_identities
                 WHERE entity_type = 'interaction' AND external_id = 'int-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            identity_target, original_id,
            "a forced duplicate must not steal the original interaction's external identity"
        );
    }
}
