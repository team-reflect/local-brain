//! Participant normalization commands for source-led imports. Raw interaction
//! participants are intentionally preserved at ingest time; these commands audit
//! unresolved handles, promote real people deliberately, and repair mistaken
//! handle ownership without provider-specific logic in the CLI.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use super::identity::source_id;
use super::text::{
    normalize_email, normalize_name, normalize_optional, normalize_title, valid_email,
};
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;

pub struct ParticipantAuditArgs<'a> {
    pub source_slug: Option<&'a str>,
    pub min_count: usize,
    pub limit: usize,
    pub fail_on_promote_candidates: bool,
}

pub struct ParticipantPromoteArgs<'a> {
    pub handle: &'a str,
    pub full_name: &'a str,
    pub headline: Option<&'a str>,
    pub org: Option<&'a str>,
    pub org_domain: Option<&'a str>,
    pub title: Option<&'a str>,
    pub current: bool,
}

pub struct PersonEmailMoveArgs<'a> {
    pub email: &'a str,
    pub from_person_id: &'a str,
    pub to_person_id: &'a str,
    pub relink_participants: bool,
}

pub struct ParticipantRelinkArgs<'a> {
    pub handle: &'a str,
    pub person_id: &'a str,
}

#[derive(Default)]
struct AuditGroup {
    key: String,
    handle: Option<String>,
    display_name: Option<String>,
    count: usize,
    sources: BTreeSet<String>,
    first_interaction_at: Option<String>,
    latest_interaction_at: Option<String>,
    sample_titles: Vec<String>,
}

struct RelinkResult {
    updated_rows: usize,
    merged_rows: usize,
}

struct PromotedPerson {
    id: String,
    created: bool,
    email_attached: bool,
}

fn normalized_email_handle(raw: &str, flag: &str) -> Result<(String, String), CliError> {
    let display = normalize_optional(Some(raw))
        .ok_or_else(|| CliError::Runtime(format!("{flag} cannot be blank")))?;
    let normalized = normalize_email(Some(&display))
        .ok_or_else(|| CliError::Runtime(format!("{flag} must be an email address")))?;
    if !valid_email(&normalized) {
        return Err(CliError::Runtime(format!(
            "{flag} must be a valid email address"
        )));
    }
    Ok((display, normalized))
}

fn recommendation(group: &AuditGroup) -> &'static str {
    let Some(handle) = group.handle.as_deref() else {
        return "review";
    };
    if !handle.contains('@') {
        return "review";
    }
    let local = handle.split('@').next().unwrap_or_default();
    let machine_local = matches!(
        local,
        "no-reply"
            | "noreply"
            | "notifications"
            | "notification"
            | "support"
            | "billing"
            | "receipts"
            | "receipt"
            | "mailer-daemon"
            | "calendar-notification"
            | "calendar"
    ) || local.starts_with("no-reply+")
        || local.starts_with("noreply+")
        || local.starts_with("notifications+");
    if machine_local {
        "skip"
    } else {
        "promote"
    }
}

fn audit_group_json(group: &AuditGroup) -> Value {
    json!({
        "identity": group.key,
        "handle": group.handle,
        "displayName": group.display_name,
        "count": group.count,
        "sources": group.sources.iter().cloned().collect::<Vec<_>>(),
        "firstInteractionAt": group.first_interaction_at,
        "latestInteractionAt": group.latest_interaction_at,
        "sampleTitles": group.sample_titles,
        "recommendation": recommendation(group),
    })
}

pub fn audit_participants(
    conn: &Connection,
    json_output: bool,
    args: ParticipantAuditArgs,
) -> Result<(), CliError> {
    let source_id = source_id(conn, args.source_slug)?;
    let min_count = args.min_count.max(1);
    let mut stmt = conn.prepare(
        "SELECT ip.normalized_handle,
                ip.handle,
                ip.display_name,
                s.slug,
                i.title,
                COALESCE(i.occurred_at, i.created_at) AS interaction_at
         FROM interaction_participants ip
         JOIN interactions i ON i.id = ip.interaction_id
         LEFT JOIN sources s ON s.id = ip.source_id
         WHERE ip.person_id IS NULL
           AND (?1 IS NULL OR ip.source_id = ?1)
         ORDER BY ip.normalized_handle, ip.display_name, interaction_at",
    )?;
    let rows = stmt.query_map(params![source_id.as_deref()], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
        ))
    })?;

    let mut groups: BTreeMap<String, AuditGroup> = BTreeMap::new();
    for row in rows {
        let (normalized_handle, handle, display_name, source_slug, title, interaction_at) = row?;
        let key = match normalized_handle.as_deref() {
            Some(handle) if !handle.trim().is_empty() => format!("handle:{handle}"),
            _ => {
                let Some(name) = display_name
                    .as_deref()
                    .map(normalize_name)
                    .filter(|name| !name.is_empty())
                else {
                    continue;
                };
                format!("name:{name}")
            }
        };
        let group = groups.entry(key.clone()).or_insert_with(|| AuditGroup {
            key,
            handle: normalized_handle.clone().or(handle),
            display_name: display_name.clone(),
            ..AuditGroup::default()
        });
        group.count += 1;
        if group.display_name.is_none() {
            group.display_name = display_name;
        }
        if let Some(source_slug) = source_slug {
            group.sources.insert(source_slug);
        }
        if let Some(interaction_at) = interaction_at {
            if group
                .first_interaction_at
                .as_deref()
                .is_none_or(|first| interaction_at.as_str() < first)
            {
                group.first_interaction_at = Some(interaction_at.clone());
            }
            if group
                .latest_interaction_at
                .as_deref()
                .is_none_or(|latest| interaction_at.as_str() > latest)
            {
                group.latest_interaction_at = Some(interaction_at);
            }
        }
        if let Some(title) = title.filter(|title| !title.trim().is_empty()) {
            if group.sample_titles.len() < 3 && !group.sample_titles.contains(&title) {
                group.sample_titles.push(title);
            }
        }
    }

    let mut groups: Vec<AuditGroup> = groups
        .into_values()
        .filter(|group| group.count >= min_count)
        .collect();
    groups.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| b.latest_interaction_at.cmp(&a.latest_interaction_at))
            .then_with(|| a.key.cmp(&b.key))
    });
    groups.truncate(args.limit);
    let promote_candidates = groups
        .iter()
        .filter(|group| recommendation(group) == "promote")
        .count();
    if args.fail_on_promote_candidates && promote_candidates > 0 {
        return Err(CliError::Runtime(format!(
            "{promote_candidates} participant promotion candidate(s) remain"
        )));
    }

    if json_output {
        print_json(&json!({
            "kind": "participant_audit",
            "source": args.source_slug,
            "minCount": min_count,
            "limit": args.limit,
            "promoteCandidates": promote_candidates,
            "participants": groups.iter().map(audit_group_json).collect::<Vec<_>>(),
        }))
    } else {
        for group in groups {
            let label = group
                .handle
                .as_deref()
                .or(group.display_name.as_deref())
                .unwrap_or(group.key.as_str());
            println!("{}\t{}\t{}", group.count, recommendation(&group), label);
        }
        Ok(())
    }
}

fn active_person_exists(conn: &Connection, person_id: &str) -> Result<bool, CliError> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM people WHERE id = ?1 AND archived_at IS NULL)",
        params![person_id],
        |row| row.get(0),
    )
    .map_err(CliError::from)
}

fn require_active_person(conn: &Connection, person_id: &str) -> Result<(), CliError> {
    if active_person_exists(conn, person_id)? {
        Ok(())
    } else {
        Err(CliError::NotFound(format!("person {person_id} not found")))
    }
}

fn person_ids_by_email(conn: &Connection, normalized_email: &str) -> Result<Vec<String>, CliError> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT p.id
         FROM people p
         LEFT JOIN person_emails pe ON pe.person_id = p.id
         WHERE p.archived_at IS NULL
           AND (lower(p.primary_email) = ?1 OR pe.normalized_email = ?1)
         ORDER BY p.created_at ASC, p.id ASC",
    )?;
    let rows = stmt
        .query_map(params![normalized_email], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CliError::from)?;
    Ok(rows)
}

fn find_name_match_without_email(
    conn: &Connection,
    full_name: &str,
) -> Result<Option<String>, CliError> {
    let normalized_name = normalize_name(full_name);
    if normalized_name.is_empty() {
        return Ok(None);
    }
    let mut stmt = conn.prepare(
        "SELECT p.id,
                p.full_name,
                p.primary_email,
                EXISTS (
                  SELECT 1 FROM person_emails pe
                  WHERE pe.person_id = p.id
                  LIMIT 1
                ) AS has_email
         FROM people p
         WHERE p.archived_at IS NULL
         ORDER BY p.created_at ASC, p.id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })?;
    let mut matches = Vec::new();
    for row in rows {
        let (id, candidate_name, primary_email, has_email) = row?;
        if normalize_name(&candidate_name) == normalized_name
            && normalize_email(primary_email.as_deref()).is_none()
            && has_email == 0
        {
            matches.push(id);
        }
    }
    match matches.len() {
        0 => Ok(None),
        1 => Ok(matches.pop()),
        _ => Err(CliError::Runtime(format!(
            "full name '{full_name}' matches multiple email-less people"
        ))),
    }
}

fn person_email_row_exists(
    conn: &Connection,
    person_id: &str,
    normalized_email: &str,
) -> Result<bool, CliError> {
    conn.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM person_emails
           WHERE person_id = ?1 AND normalized_email = ?2
         )",
        params![person_id, normalized_email],
        |row| row.get(0),
    )
    .map_err(CliError::from)
}

fn attach_email_if_safe(
    conn: &Connection,
    person_id: &str,
    email: &str,
    normalized_email: &str,
) -> Result<bool, CliError> {
    let owners = person_ids_by_email(conn, normalized_email)?;
    if owners.iter().any(|owner| owner != person_id) {
        return Err(CliError::Runtime(format!(
            "email {normalized_email} is already owned by another active person"
        )));
    }
    let existed = person_email_row_exists(conn, person_id, normalized_email)?;
    if !existed {
        let primary_email: Option<String> = conn.query_row(
            "SELECT primary_email FROM people WHERE id = ?1",
            params![person_id],
            |row| row.get(0),
        )?;
        let has_primary_row: bool = conn.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM person_emails
               WHERE person_id = ?1 AND is_primary = 1
             )",
            params![person_id],
            |row| row.get(0),
        )?;
        let primary_matches =
            normalize_email(primary_email.as_deref()).as_deref() == Some(normalized_email);
        let is_primary =
            i64::from(!has_primary_row && (primary_email.is_none() || primary_matches));
        conn.execute(
            "INSERT INTO person_emails
               (id, person_id, email, normalized_email, is_primary)
             VALUES (?1,?2,?3,?4,?5)",
            params![new_id(), person_id, email, normalized_email, is_primary],
        )?;
    }
    conn.execute(
        "UPDATE people
         SET primary_email = CASE
               WHEN primary_email IS NULL OR trim(primary_email) = '' THEN ?2
               ELSE primary_email END,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![person_id, email],
    )?;
    Ok(!existed)
}

fn ensure_promoted_person(
    conn: &Connection,
    email: &str,
    normalized_email: &str,
    full_name: &str,
    headline: Option<&str>,
) -> Result<PromotedPerson, CliError> {
    let owners = person_ids_by_email(conn, normalized_email)?;
    let (id, created) = match owners.len() {
        0 => match find_name_match_without_email(conn, full_name)? {
            Some(id) => (id, false),
            None => {
                let id = new_id();
                conn.execute(
                    "INSERT INTO people (id, full_name, primary_email, headline)
                     VALUES (?1,?2,?3,?4)",
                    params![id, full_name, email, normalize_optional(headline)],
                )?;
                (id, true)
            }
        },
        1 => (owners[0].clone(), false),
        _ => {
            return Err(CliError::Runtime(format!(
                "email {normalized_email} is owned by multiple active people"
            )));
        }
    };
    super::fill_blanks(
        conn,
        "people",
        &id,
        &[("headline", normalize_optional(headline))],
    )?;
    let email_attached = attach_email_if_safe(conn, &id, email, normalized_email)?;
    Ok(PromotedPerson {
        id,
        created,
        email_attached,
    })
}

fn apply_promotion_affiliation(
    conn: &Connection,
    person_id: &str,
    org: Option<&str>,
    org_domain: Option<&str>,
    title: Option<&str>,
    current: bool,
) -> Result<(), CliError> {
    let Some(org) = org.map(str::trim).filter(|org| !org.is_empty()) else {
        return Ok(());
    };
    let org_id = super::organization::find_or_create_organization(conn, org, org_domain, None)?;
    super::affiliation::upsert_affiliation(
        conn, person_id, &org_id, title, None, None, None, None, current, current,
    )?;
    Ok(())
}

fn recompute_relationship_intelligence(
    conn: &Connection,
    person_id: &str,
) -> Result<Option<String>, CliError> {
    let last_interaction_at: Option<String> = conn
        .query_row(
            "SELECT MAX(i.occurred_at)
             FROM interactions i
             JOIN interaction_participants ip ON ip.interaction_id = i.id
             WHERE ip.person_id = ?1
               AND i.archived_at IS NULL
               AND i.occurred_at IS NOT NULL",
            params![person_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    conn.execute(
        "UPDATE people
         SET last_interaction_at = ?2,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1
           AND is_self = 0
           AND archived_at IS NULL",
        params![person_id, last_interaction_at.as_deref()],
    )?;
    Ok(last_interaction_at)
}

fn relink_participants_for_handle(
    conn: &Connection,
    normalized_handle: &str,
    person_id: &str,
    from_person_id: Option<&str>,
    display_handle: Option<&str>,
    display_name: Option<&str>,
) -> Result<RelinkResult, CliError> {
    let rows = {
        let mut stmt = conn.prepare(
            "SELECT id, interaction_id
             FROM interaction_participants
             WHERE normalized_handle = ?1
               AND (
                 person_id IS NULL
                 OR (?2 IS NOT NULL AND person_id = ?2)
               )
             ORDER BY interaction_id, created_at, id",
        )?;
        let rows = stmt
            .query_map(params![normalized_handle, from_person_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };

    let mut by_interaction: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (id, interaction_id) in rows {
        by_interaction.entry(interaction_id).or_default().push(id);
    }

    let mut updated_rows = 0;
    let mut merged_rows = 0;
    for (interaction_id, ids) in by_interaction {
        let already_linked: bool = conn.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM interaction_participants
               WHERE interaction_id = ?1 AND person_id = ?2
             )",
            params![interaction_id, person_id],
            |row| row.get(0),
        )?;
        if already_linked {
            for id in ids {
                merged_rows += conn.execute(
                    "DELETE FROM interaction_participants WHERE id = ?1",
                    params![id],
                )?;
            }
            continue;
        }

        let mut ids = ids.into_iter();
        let keep = ids
            .next()
            .expect("participant grouping only contains non-empty id lists");
        updated_rows += conn.execute(
            "UPDATE interaction_participants
             SET person_id = ?2,
                 handle = CASE
                   WHEN (handle IS NULL OR trim(handle) = '') AND ?3 IS NOT NULL
                   THEN ?3 ELSE handle END,
                 display_name = CASE
                   WHEN (display_name IS NULL OR trim(display_name) = '') AND ?4 IS NOT NULL
                   THEN ?4 ELSE display_name END
             WHERE id = ?1",
            params![keep, person_id, display_handle, display_name],
        )?;
        for id in ids {
            merged_rows += conn.execute(
                "DELETE FROM interaction_participants WHERE id = ?1",
                params![id],
            )?;
        }
    }
    recompute_relationship_intelligence(conn, person_id)?;
    if let Some(from_person_id) = from_person_id {
        if from_person_id != person_id {
            recompute_relationship_intelligence(conn, from_person_id)?;
        }
    }
    Ok(RelinkResult {
        updated_rows,
        merged_rows,
    })
}

pub fn promote_participant(
    conn: &mut Connection,
    json_output: bool,
    args: ParticipantPromoteArgs,
) -> Result<(), CliError> {
    let (display_email, normalized_email) = normalized_email_handle(args.handle, "--handle")?;
    let full_name = normalize_title(Some(args.full_name))
        .ok_or_else(|| CliError::Runtime("--full-name cannot be blank".into()))?;
    let tx = conn.transaction()?;
    let person = ensure_promoted_person(
        &tx,
        &display_email,
        &normalized_email,
        &full_name,
        args.headline,
    )?;
    apply_promotion_affiliation(
        &tx,
        &person.id,
        args.org,
        args.org_domain,
        args.title,
        args.current,
    )?;
    let relink = relink_participants_for_handle(
        &tx,
        &normalized_email,
        &person.id,
        None,
        Some(&display_email),
        Some(&full_name),
    )?;
    let last_interaction_at = recompute_relationship_intelligence(&tx, &person.id)?;
    tx.commit()?;

    if json_output {
        print_json(&json!({
            "kind": "participant_promotion",
            "personId": person.id,
            "createdPerson": person.created,
            "emailAttached": person.email_attached,
            "participantsRelinked": relink.updated_rows,
            "participantsMerged": relink.merged_rows,
            "lastInteractionAt": last_interaction_at,
        }))
    } else {
        println!(
            "participant {} -> person {} ({} relinked, {} merged)",
            normalized_email, person.id, relink.updated_rows, relink.merged_rows
        );
        Ok(())
    }
}

fn sync_primary_after_email_removal(
    conn: &Connection,
    person_id: &str,
    removed_normalized_email: &str,
) -> Result<(), CliError> {
    let primary_email: Option<String> = conn.query_row(
        "SELECT primary_email FROM people WHERE id = ?1",
        params![person_id],
        |row| row.get(0),
    )?;
    if normalize_email(primary_email.as_deref()).as_deref() == Some(removed_normalized_email) {
        let next_email: Option<String> = conn
            .query_row(
                "SELECT email FROM person_emails
                 WHERE person_id = ?1
                 ORDER BY is_primary DESC, created_at ASC, id ASC
                 LIMIT 1",
                params![person_id],
                |row| row.get(0),
            )
            .optional()?;
        conn.execute(
            "UPDATE people
             SET primary_email = ?2,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![person_id, next_email.as_deref()],
        )?;
    }

    let has_primary_row: bool = conn.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM person_emails
           WHERE person_id = ?1 AND is_primary = 1
         )",
        params![person_id],
        |row| row.get(0),
    )?;
    if !has_primary_row {
        conn.execute(
            "UPDATE person_emails
             SET is_primary = 1,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = (
               SELECT id FROM person_emails
               WHERE person_id = ?1
               ORDER BY created_at ASC, id ASC
               LIMIT 1
             )",
            params![person_id],
        )?;
    }
    Ok(())
}

pub fn repair_person_email_move(
    conn: &mut Connection,
    json_output: bool,
    args: PersonEmailMoveArgs,
) -> Result<(), CliError> {
    let (display_email, normalized_email) = normalized_email_handle(args.email, "--email")?;
    let tx = conn.transaction()?;
    require_active_person(&tx, args.from_person_id)?;
    require_active_person(&tx, args.to_person_id)?;
    if args.from_person_id == args.to_person_id {
        return Err(CliError::Runtime(
            "--from and --to must be different people".into(),
        ));
    }

    let owners = person_ids_by_email(&tx, &normalized_email)?;
    if !owners.iter().any(|owner| owner == args.from_person_id) {
        return Err(CliError::Runtime(format!(
            "person {} does not own {normalized_email}",
            args.from_person_id
        )));
    }
    if owners
        .iter()
        .any(|owner| owner != args.from_person_id && owner != args.to_person_id)
    {
        return Err(CliError::Runtime(format!(
            "email {normalized_email} is also owned by another active person"
        )));
    }

    let stored_email = tx
        .query_row(
            "SELECT email FROM person_emails
             WHERE person_id = ?1 AND normalized_email = ?2
             ORDER BY is_primary DESC, created_at ASC, id ASC
             LIMIT 1",
            params![args.from_person_id, normalized_email],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .unwrap_or_else(|| display_email.clone());
    let deleted_rows = tx.execute(
        "DELETE FROM person_emails
         WHERE person_id = ?1 AND normalized_email = ?2",
        params![args.from_person_id, normalized_email],
    )?;
    sync_primary_after_email_removal(&tx, args.from_person_id, &normalized_email)?;
    let email_attached =
        attach_email_if_safe(&tx, args.to_person_id, &stored_email, &normalized_email)?;

    let relink = if args.relink_participants {
        relink_participants_for_handle(
            &tx,
            &normalized_email,
            args.to_person_id,
            Some(args.from_person_id),
            Some(&stored_email),
            None,
        )?
    } else {
        RelinkResult {
            updated_rows: 0,
            merged_rows: 0,
        }
    };
    tx.commit()?;

    if json_output {
        print_json(&json!({
            "kind": "person_email_move",
            "email": normalized_email,
            "fromPersonId": args.from_person_id,
            "toPersonId": args.to_person_id,
            "emailRowsMoved": deleted_rows,
            "emailAttached": email_attached,
            "participantsRelinked": relink.updated_rows,
            "participantsMerged": relink.merged_rows,
        }))
    } else {
        println!(
            "email {} moved {} -> {} ({} participant rows relinked)",
            normalized_email, args.from_person_id, args.to_person_id, relink.updated_rows
        );
        Ok(())
    }
}

pub fn repair_participants_relink(
    conn: &mut Connection,
    json_output: bool,
    args: ParticipantRelinkArgs,
) -> Result<(), CliError> {
    let (display_email, normalized_email) = normalized_email_handle(args.handle, "--handle")?;
    let tx = conn.transaction()?;
    require_active_person(&tx, args.person_id)?;
    let relink = relink_participants_for_handle(
        &tx,
        &normalized_email,
        args.person_id,
        None,
        Some(&display_email),
        None,
    )?;
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "participant_relink",
            "handle": normalized_email,
            "personId": args.person_id,
            "participantsRelinked": relink.updated_rows,
            "participantsMerged": relink.merged_rows,
        }))
    } else {
        println!(
            "participant {} -> person {} ({} relinked, {} merged)",
            normalized_email, args.person_id, relink.updated_rows, relink.merged_rows
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn add_interaction_with_participants(conn: &Connection, title: &str, participants: &[&str]) {
        let id = new_id();
        conn.execute(
            "INSERT INTO interactions (id, title, occurred_at)
             VALUES (?1, ?2, '2026-06-01T00:00:00.000Z')",
            params![id, title],
        )
        .unwrap();
        for participant in participants {
            let (display_name, handle) = if let (Some(start), Some(end)) =
                (participant.rfind('<'), participant.rfind('>'))
            {
                (
                    normalize_optional(Some(&participant[..start])),
                    normalize_optional(Some(&participant[start + 1..end])),
                )
            } else {
                (None, Some((*participant).to_string()))
            };
            let normalized_handle = handle.as_deref().map(str::to_lowercase);
            conn.execute(
                "INSERT INTO interaction_participants
                   (id, interaction_id, role, handle, normalized_handle, display_name)
                 VALUES (?1,?2,'attendee',?3,?4,?5)",
                params![new_id(), id, handle, normalized_handle, display_name],
            )
            .unwrap();
        }
    }

    #[test]
    fn promote_participant_creates_person_and_relinks_idempotently() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        add_interaction_with_participants(&conn, "Intro", &["Ada Lovelace <ada@example.com>"]);
        add_interaction_with_participants(&conn, "Follow-up", &["Ada Lovelace <ada@example.com>"]);

        promote_participant(
            &mut conn,
            true,
            ParticipantPromoteArgs {
                handle: "ada@example.com",
                full_name: "Ada Lovelace",
                headline: None,
                org: None,
                org_domain: None,
                title: None,
                current: false,
            },
        )
        .unwrap();
        let person_id: String = conn
            .query_row(
                "SELECT id FROM people WHERE primary_email = 'ada@example.com'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let linked: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM interaction_participants WHERE person_id = ?1",
                params![person_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(linked, 2);

        promote_participant(
            &mut conn,
            true,
            ParticipantPromoteArgs {
                handle: "ada@example.com",
                full_name: "Ada Lovelace",
                headline: Some("Mathematician"),
                org: None,
                org_domain: None,
                title: None,
                current: false,
            },
        )
        .unwrap();
        let people: i64 = conn
            .query_row("SELECT COUNT(*) FROM people", [], |row| row.get(0))
            .unwrap();
        assert_eq!(people, 1, "promotion is idempotent by email");
    }

    #[test]
    fn audit_groups_unresolved_handles_and_excludes_linked_people() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        add_interaction_with_participants(
            &conn,
            "Intro",
            &[
                "Ada Lovelace <ada@example.com>",
                "Grace Hopper <grace@example.com>",
            ],
        );
        add_interaction_with_participants(&conn, "Follow-up", &["Ada Lovelace <ada@example.com>"]);
        promote_participant(
            &mut conn,
            true,
            ParticipantPromoteArgs {
                handle: "grace@example.com",
                full_name: "Grace Hopper",
                headline: None,
                org: None,
                org_domain: None,
                title: None,
                current: false,
            },
        )
        .unwrap();

        let source_id = source_id(&conn, None).unwrap();
        assert!(source_id.is_none());
        let mut stmt = conn
            .prepare(
                "SELECT normalized_handle, COUNT(*)
                 FROM interaction_participants
                 WHERE person_id IS NULL
                 GROUP BY normalized_handle",
            )
            .unwrap();
        let unresolved = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(unresolved, vec![("ada@example.com".to_string(), 2)]);
    }

    #[test]
    fn email_move_transfers_handle_and_relinks_when_requested() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        let from = new_id();
        let to = new_id();
        conn.execute(
            "INSERT INTO people (id, full_name, primary_email)
             VALUES (?1,'Wrong Owner','wrong@example.com'), (?2,'Right Owner',NULL)",
            params![from, to],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO person_emails
               (id, person_id, email, normalized_email, is_primary)
             VALUES (?1,?2,'wrong@example.com','wrong@example.com',1)",
            params![new_id(), from],
        )
        .unwrap();
        add_interaction_with_participants(&conn, "Repair", &["Wrong <wrong@example.com>"]);
        conn.execute(
            "UPDATE interaction_participants SET person_id = ?1 WHERE normalized_handle = 'wrong@example.com'",
            params![from],
        )
        .unwrap();

        repair_person_email_move(
            &mut conn,
            true,
            PersonEmailMoveArgs {
                email: "wrong@example.com",
                from_person_id: &from,
                to_person_id: &to,
                relink_participants: true,
            },
        )
        .unwrap();
        let owner: String = conn
            .query_row(
                "SELECT person_id FROM person_emails WHERE normalized_email = 'wrong@example.com'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(owner, to);
        let linked: String = conn
            .query_row(
                "SELECT person_id FROM interaction_participants WHERE normalized_handle = 'wrong@example.com'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(linked, to);
    }
}
