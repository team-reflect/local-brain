//! `brain add interaction` — ingest a human interaction (meeting, call, note, …)
//! with its participants, links, and derived chunks in one transaction.
//! Deduped by external identity first, then by content hash; a matched
//! interaction is enriched (links, participants, identity, blank fields) rather
//! than re-created.

use rusqlite::{params, Connection, OptionalExtension};
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
    pub ended_at: Option<&'a str>,
    pub location: Option<&'a str>,
    pub source_slug: Option<&'a str>,
    pub external_kind: &'a str,
    pub external_id: Option<&'a str>,
    pub original_url: Option<&'a str>,
    pub summary: Option<&'a str>,
    pub body: Option<String>,
    pub links: Vec<LinkRef>,
    pub raw_participants: Vec<&'a str>,
    pub self_participants: Vec<&'a str>,
    pub allow_duplicate: bool,
    pub replace_body: bool,
    /// On a source-backed re-import whose body changed, re-chunk like
    /// `--replace-body` instead of only filling blank fields. A no-op when the
    /// stored body already matches, so a daily automation can pass it freely.
    pub refresh: bool,
}

/// Whether the stored interaction's body differs from the incoming one, so a
/// re-imported thread/transcript that grew can be detected and re-digested.
/// Recomputes the stored body's hash rather than trusting `content_hash`: a null
/// or stale hash column (e.g. a body written without one, or by another writer)
/// would otherwise falsely report a change even when `body_text` already matches.
fn body_changed(
    conn: &Connection,
    existing: &str,
    incoming_hash: Option<&str>,
) -> Result<bool, CliError> {
    let Some(incoming_hash) = incoming_hash else {
        return Ok(false);
    };
    let stored_body: Option<String> = conn
        .query_row(
            "SELECT body_text FROM interactions WHERE id = ?1",
            params![existing],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    let stored_hash = stored_body
        .as_deref()
        .map(normalize_text)
        .filter(|body| !body.is_empty())
        .map(|body| content_hash(&body));
    Ok(stored_hash.as_deref() != Some(incoming_hash))
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
            // caller. This legacy fallback matches only rows that predate
            // `external_identities`; once any scoped identity claims a row, the
            // generic denormalized `interactions.external_id` must not merge across
            // sources or external-kind scopes.
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
                   )
                 LIMIT 1",
                    params![external_id],
                    |row| row.get::<_, String>(0),
                )
                .ok();
            if id.is_some() {
                return Ok(id);
            }
            if source_id.is_some() {
                return Ok(None);
            }
        }
    }
    if source_id.is_some() && normalize_optional(external_id).is_some() {
        return Ok(None);
    }
    find_duplicate(conn, "interactions", hash)
}

fn enrich_duplicate_interaction(
    conn: &Connection,
    id: &str,
    args: &AddInteractionArgs,
) -> Result<(), CliError> {
    super::fill_blanks(
        conn,
        "interactions",
        id,
        &[
            ("external_id", normalize_optional(args.external_id)),
            ("original_url", normalize_optional(args.original_url)),
            ("summary", normalize_optional(args.summary)),
            ("occurred_at", normalize_optional(args.occurred_at)),
            ("ended_at", normalize_optional(args.ended_at)),
            ("location", normalize_optional(args.location)),
        ],
    )
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
) -> Result<usize, CliError> {
    enrich_duplicate_interaction(tx, existing, args)?;
    let mut chunk_count = 0;
    if replace_body {
        let body = args
            .body
            .as_deref()
            .map(normalize_text)
            .filter(|body| !body.is_empty())
            .ok_or_else(|| CliError::Runtime("--replace-body requires body text".into()))?;
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
        chunk_count = replace_chunks(tx, "interaction", existing, &body)?;
    }
    insert_links(tx, "interaction", existing, &args.links)?;
    insert_raw_participants(tx, existing, source_id, &args.raw_participants)?;
    insert_self_participants(tx, existing, source_id, &args.self_participants)?;
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
    Ok(chunk_count)
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
        let person_id = match participant.normalized_handle.as_deref() {
            Some(handle) if handle.contains('@') => find_person_by_email(conn, handle)?,
            _ => None,
        };
        inserted += insert_participant(
            conn,
            interaction_id,
            source_id,
            &participant,
            person_id.as_deref(),
        )?;
    }
    Ok(inserted)
}

fn insert_self_participants(
    conn: &Connection,
    interaction_id: &str,
    source_id: Option<&str>,
    participants: &[&str],
) -> Result<usize, CliError> {
    if participants.is_empty() {
        return Ok(0);
    }
    let self_id = find_self_person(conn)?.ok_or_else(|| {
        CliError::Runtime("--self-participant requires an active self person".into())
    })?;
    let mut inserted = 0;
    for raw in participants {
        let Some(participant) = parse_raw_participant(raw)? else {
            continue;
        };
        inserted += insert_participant(
            conn,
            interaction_id,
            source_id,
            &participant,
            Some(&self_id),
        )?;
    }
    Ok(inserted)
}

fn insert_participant(
    conn: &Connection,
    interaction_id: &str,
    source_id: Option<&str>,
    participant: &RawParticipant,
    person_id: Option<&str>,
) -> Result<usize, CliError> {
    if participant.normalized_handle.is_none()
        && participant.display_name.is_none()
        && person_id.is_none()
    {
        return Ok(0);
    }

    if let Some(person_id) = person_id {
        let changed = conn.execute(
            "UPDATE interaction_participants
             SET role = CASE
                   WHEN (role IS NULL OR trim(role) = '') AND ?3 IS NOT NULL
                   THEN ?3 ELSE role END,
                 handle = CASE
                   WHEN (handle IS NULL OR trim(handle) = '') AND ?4 IS NOT NULL
                   THEN ?4 ELSE handle END,
                 normalized_handle = CASE
                   WHEN (normalized_handle IS NULL OR trim(normalized_handle) = '') AND ?5 IS NOT NULL
                   THEN ?5 ELSE normalized_handle END,
                 display_name = CASE
                   WHEN (display_name IS NULL OR trim(display_name) = '') AND ?6 IS NOT NULL
                   THEN ?6 ELSE display_name END,
                 source_id = CASE
                   WHEN source_id IS NULL AND ?7 IS NOT NULL THEN ?7 ELSE source_id END
             WHERE interaction_id = ?1
               AND person_id = ?2",
            params![
                interaction_id,
                person_id,
                participant.role,
                participant.handle,
                participant.normalized_handle,
                participant.display_name,
                source_id,
            ],
        )?;
        if changed > 0 {
            return Ok(0);
        }
    }

    if let Some(handle) = participant.normalized_handle.as_deref() {
        let changed = conn.execute(
            "UPDATE interaction_participants
             SET person_id = CASE
                   WHEN person_id IS NULL AND ?4 IS NOT NULL THEN ?4 ELSE person_id END,
                 handle = CASE
                   WHEN (handle IS NULL OR trim(handle) = '') AND ?5 IS NOT NULL
                   THEN ?5 ELSE handle END,
                 display_name = CASE
                   WHEN (display_name IS NULL OR trim(display_name) = '') AND ?6 IS NOT NULL
                   THEN ?6 ELSE display_name END,
                 source_id = CASE
                   WHEN source_id IS NULL AND ?7 IS NOT NULL THEN ?7 ELSE source_id END
             WHERE interaction_id = ?1
               AND normalized_handle = ?2
               AND COALESCE(role, '') = ?3
               AND (?4 IS NULL OR person_id IS NULL OR person_id = ?4)",
            params![
                interaction_id,
                handle,
                participant.role,
                person_id,
                participant.handle,
                participant.display_name,
                source_id,
            ],
        )?;
        if changed > 0 {
            return Ok(0);
        }
    } else if participant.display_name.is_some() {
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
            return Ok(0);
        }
    }

    let changed = conn.execute(
        "INSERT OR IGNORE INTO interaction_participants
         (id, interaction_id, person_id, role, handle, normalized_handle, display_name, source_id)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            new_id(),
            interaction_id,
            person_id,
            participant.role,
            participant.handle,
            participant.normalized_handle,
            participant.display_name,
            source_id,
        ],
    )?;
    Ok(changed)
}

fn find_self_person(conn: &Connection) -> Result<Option<String>, CliError> {
    let id = conn
        .query_row(
            "SELECT id FROM people
             WHERE is_self = 1 AND archived_at IS NULL
             LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(id)
}

fn find_person_by_email(
    conn: &Connection,
    normalized_email: &str,
) -> Result<Option<String>, CliError> {
    let id = conn
        .query_row(
            "SELECT p.id
             FROM people p
             LEFT JOIN person_emails pe ON pe.person_id = p.id
             WHERE p.archived_at IS NULL
               AND (
                 lower(p.primary_email) = ?1
                 OR pe.normalized_email = ?1
               )
             ORDER BY p.created_at ASC
             LIMIT 1",
            params![normalized_email],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(id)
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
    body_changed: bool,
) -> Result<(), CliError> {
    if json_output {
        let mut value = json!({
            "kind": "interaction",
            "id": id,
            "isDuplicate": duplicate,
            "chunkCount": chunk_count,
        });
        if body_changed {
            // The upstream body differs from the stored one. Re-import with
            // --replace-body (or --refresh) to re-digest the grown thread.
            value["bodyChanged"] = json!(true);
        }
        if post_analysis_required {
            value["postAnalysisRequired"] = json!(true);
            value["postAnalysisChecklist"] = json!([
                "summary",
                "people",
                "existingProjectLinks",
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
                "brain: post-analysis required: summary, people, existing project links, follow-up tasks, stable memories"
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
    let body = args
        .body
        .as_deref()
        .map(normalize_text)
        .filter(|body| !body.is_empty());
    let title = normalize_title(args.title);
    if title.is_none() && body.is_none() {
        return Err(CliError::Runtime(
            "an interaction needs a title or body text".into(),
        ));
    }
    let hash = body.as_deref().map(content_hash);
    let source_id = source_id(conn, args.source_slug)?;
    let identity_kind = external_kind(args.external_kind);
    if args.replace_body && body.is_none() {
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
            let changed = body_changed(conn, existing, hash.as_deref())?;
            let do_replace = args.replace_body || (args.refresh && changed);
            let tx = conn.transaction()?;
            let count = enrich_existing_interaction(
                &tx,
                existing,
                &args,
                source_id.as_deref(),
                &identity_kind,
                do_replace,
            )?;
            tx.commit()?;
            // Surface staleness only when we didn't already re-digest the body.
            let still_stale = changed && !do_replace;
            return report_interaction(
                json,
                existing,
                true,
                count,
                requires_post_analysis(&args),
                still_stale,
            );
        }
    }
    let existing_by_dup = match hash.as_deref() {
        Some(hash) => find_duplicate_interaction(
            conn,
            hash,
            &identity_kind,
            args.external_id,
            source_id.as_deref(),
        )?,
        None => None,
    };
    if let Some(existing) = existing_by_dup.as_deref() {
        if !args.allow_duplicate {
            // This path matched on identical content_hash, so the body is byte-for-
            // byte the same — never stale.
            let tx = conn.transaction()?;
            let count = enrich_existing_interaction(
                &tx,
                existing,
                &args,
                source_id.as_deref(),
                &identity_kind,
                args.replace_body,
            )?;
            tx.commit()?;
            return report_interaction(
                json,
                existing,
                true,
                count,
                requires_post_analysis(&args),
                false,
            );
        }
    }
    // Reaching here past a match means `--allow-duplicate` forced a new record; it
    // must not steal the matched interaction's external identity.
    let force_duplicate = existing_by_external.is_some() || existing_by_dup.is_some();
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO interactions
         (id, kind, title, body_text, summary, occurred_at, ended_at, location, external_id, original_url, content_hash)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![
            id,
            args.kind,
            title,
            body.as_deref(),
            normalize_optional(args.summary),
            normalize_optional(args.occurred_at),
            normalize_optional(args.ended_at),
            normalize_optional(args.location),
            normalize_optional(args.external_id),
            normalize_optional(args.original_url),
            hash.as_deref()
        ],
    )?;
    let count = match body.as_deref() {
        Some(body) => insert_chunks(&tx, "interaction", &id, body)?,
        None => 0,
    };
    insert_links(&tx, "interaction", &id, &args.links)?;
    insert_raw_participants(&tx, &id, source_id.as_deref(), &args.raw_participants)?;
    insert_self_participants(&tx, &id, source_id.as_deref(), &args.self_participants)?;
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
    report_interaction(
        json,
        &id,
        false,
        count,
        requires_post_analysis(&args),
        false,
    )
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
            ended_at: None,
            location: None,
            source_slug: Some("manual"),
            external_kind: "record",
            external_id,
            original_url: None,
            summary: None,
            body: Some(body.to_string()),
            links: vec![],
            raw_participants: vec![],
            self_participants: vec![],
            allow_duplicate,
            replace_body: false,
            refresh: false,
        }
    }

    #[test]
    fn body_changed_recomputes_from_body_text_ignoring_null_hash() {
        let conn = brain_schema::open_in_memory().unwrap();
        // A stored interaction with a body but NULL content_hash (e.g. written by
        // another writer or a legacy path).
        conn.execute(
            "INSERT INTO interactions (id, kind, title, body_text, content_hash)
             VALUES ('i1', 'email', 'T', 'shared body text', NULL)",
            [],
        )
        .unwrap();
        let same = content_hash(&normalize_text("shared body text"));
        assert!(
            !body_changed(&conn, "i1", Some(&same)).unwrap(),
            "a matching body must not report a change despite the null stored hash"
        );
        let different = content_hash(&normalize_text("a genuinely different body"));
        assert!(
            body_changed(&conn, "i1", Some(&different)).unwrap(),
            "a different body still reports a change"
        );
    }

    #[test]
    fn refresh_redigests_a_changed_thread_body() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // Seed a source-backed thread with an initial body.
        add_interaction(
            &mut conn,
            true,
            interaction_args("first body", Some("thr-1"), false),
        )
        .unwrap();
        let id: String = conn
            .query_row(
                "SELECT entity_id FROM external_identities WHERE external_id = 'thr-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        // Re-import the same thread with a grown body and --refresh: the stored body
        // and chunks must be replaced.
        let mut grown = interaction_args("first body. and a new reply.", Some("thr-1"), false);
        grown.refresh = true;
        add_interaction(&mut conn, true, grown).unwrap();

        let stored_body: String = conn
            .query_row(
                "SELECT body_text FROM interactions WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored_body, "first body. and a new reply.");
        let chunk_has_reply: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM content_chunks
                 WHERE record_type = 'interaction' AND record_id = ?1
                   AND text LIKE '%new reply%'",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(chunk_has_reply, 1, "refresh re-chunks the grown body");
    }

    #[test]
    fn registered_self_email_auto_resolves_participant_without_self_flag() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // Register the user's address on the self person.
        crate::commands::add::set_self(
            &mut conn,
            true,
            crate::commands::add::SetSelfArgs {
                full_name: Some("Alex MacCaw"),
                preferred_name: None,
                emails: vec!["alex@maccaw.org"],
                phones: vec![],
                headline: None,
                location: None,
            },
        )
        .unwrap();
        let self_id: String = conn
            .query_row("SELECT id FROM people WHERE is_self = 1", [], |row| {
                row.get(0)
            })
            .unwrap();

        // Import an interaction with the user as a *plain* --participant (no
        // --self-participant). Resolution by registered email must link it to self.
        let mut args = interaction_args("body text", Some("ext-self"), false);
        args.raw_participants = vec!["from:Alex MacCaw <alex@maccaw.org>"];
        add_interaction(&mut conn, true, args).unwrap();

        let resolved: Option<String> = conn
            .query_row(
                "SELECT person_id FROM interaction_participants
                 WHERE normalized_handle = 'alex@maccaw.org'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            resolved.as_deref(),
            Some(self_id.as_str()),
            "a participant on a registered self address must resolve to the self person"
        );
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
