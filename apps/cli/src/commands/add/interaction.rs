//! `brain add interaction` — ingest a human interaction (meeting, call, note, …)
//! with its participants, links, and derived chunks in one transaction.
//! Deduped by external identity first, then by content hash; a matched
//! interaction is enriched (links, participants, identity, blank fields) rather
//! than re-created.

use rusqlite::{params, Connection};

use super::identity::{
    find_duplicate, find_external_identity, insert_external_identity, source_id,
    ExternalIdentityWrite,
};
use super::links::{insert_chunks, insert_links};
use super::report_record;
use super::text::{normalize_optional, normalize_title};
use crate::commands::LinkRef;
use crate::error::CliError;
use crate::id::new_id;
use crate::text::{content_hash, normalize_text};

pub struct AddInteractionArgs<'a> {
    pub title: Option<&'a str>,
    pub kind: &'a str,
    pub occurred_at: Option<&'a str>,
    pub ended_at: Option<&'a str>,
    pub location: Option<&'a str>,
    pub source_slug: Option<&'a str>,
    pub external_id: Option<&'a str>,
    pub original_url: Option<&'a str>,
    pub body: Option<String>,
    pub links: Vec<LinkRef>,
    pub raw_participants: Vec<&'a str>,
    pub self_participants: Vec<&'a str>,
    pub allow_duplicate: bool,
}

fn find_duplicate_interaction(
    conn: &Connection,
    hash: &str,
    external_id: Option<&str>,
    source_id: Option<&str>,
) -> Result<Option<String>, CliError> {
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
             occurred_at = CASE
               WHEN (occurred_at IS NULL OR trim(occurred_at) = '') AND ?3 IS NOT NULL
               THEN ?3 ELSE occurred_at END,
             ended_at = CASE
               WHEN (ended_at IS NULL OR trim(ended_at) = '') AND ?4 IS NOT NULL
               THEN ?4 ELSE ended_at END,
             location = CASE
               WHEN (location IS NULL OR trim(location) = '') AND ?5 IS NOT NULL
               THEN ?5 ELSE location END,
             updated_at = CASE
               WHEN ((external_id IS NULL OR trim(external_id) = '') AND ?1 IS NOT NULL)
                 OR ((original_url IS NULL OR trim(original_url) = '') AND ?2 IS NOT NULL)
                 OR ((occurred_at IS NULL OR trim(occurred_at) = '') AND ?3 IS NOT NULL)
                 OR ((ended_at IS NULL OR trim(ended_at) = '') AND ?4 IS NOT NULL)
                 OR ((location IS NULL OR trim(location) = '') AND ?5 IS NOT NULL)
               THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE updated_at END
         WHERE id = ?6",
        params![
            normalize_optional(args.external_id),
            normalize_optional(args.original_url),
            normalize_optional(args.occurred_at),
            normalize_optional(args.ended_at),
            normalize_optional(args.location),
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
) -> Result<(), CliError> {
    enrich_duplicate_interaction(tx, existing, args)?;
    insert_links(tx, "interaction", existing, &args.links)?;
    insert_raw_participants(tx, existing, source_id, &args.raw_participants)?;
    insert_self_participants(tx, existing, source_id, &args.self_participants)?;
    insert_external_identity(
        tx,
        ExternalIdentityWrite {
            entity_type: "interaction",
            entity_id: existing,
            source_id,
            kind: "record",
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
    let existing_by_external = find_external_identity(
        conn,
        "interaction",
        source_id.as_deref(),
        "record",
        args.external_id,
    )?;
    if let Some(existing) = existing_by_external.as_deref() {
        if !args.allow_duplicate {
            let tx = conn.transaction()?;
            enrich_existing_interaction(&tx, existing, &args, source_id.as_deref())?;
            tx.commit()?;
            return report_record(json, "interaction", existing, true, 0);
        }
    }
    let existing_by_dup = match hash.as_deref() {
        Some(hash) => {
            find_duplicate_interaction(conn, hash, args.external_id, source_id.as_deref())?
        }
        None => None,
    };
    if let Some(existing) = existing_by_dup.as_deref() {
        if !args.allow_duplicate {
            let tx = conn.transaction()?;
            enrich_existing_interaction(&tx, existing, &args, source_id.as_deref())?;
            tx.commit()?;
            return report_record(json, "interaction", existing, true, 0);
        }
    }
    // Reaching here past a match means `--allow-duplicate` forced a new record; it
    // must not steal the matched interaction's external identity.
    let force_duplicate = existing_by_external.is_some() || existing_by_dup.is_some();
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO interactions
         (id, kind, title, body_text, occurred_at, ended_at, location, external_id, original_url, content_hash)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            id,
            args.kind,
            title,
            body.as_deref(),
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
            kind: "record",
            external_id: args.external_id,
            url: args.original_url,
            force_duplicate,
        },
    )?;
    tx.commit()?;
    report_record(json, "interaction", &id, false, count)
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
            external_id,
            original_url: None,
            body: Some(body.to_string()),
            links: vec![],
            raw_participants: vec![],
            self_participants: vec![],
            allow_duplicate,
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
