//! `brain add person` and `brain add person-from-email`. People are deduped by
//! external identity first, then by email, then by normalized name; a matched
//! person is enriched in place (filling only blank fields) instead of forked.
//! Every write — new record, enrichment, handles, external identity — runs in one
//! transaction so a late failure can never leave a half-updated person.

use rusqlite::{params, Connection};
use serde_json::json;

use super::identity::{
    external_kind, find_external_identity, insert_external_identity, source_id,
    ExternalIdentityWrite,
};
use super::person_import::{assess_person_import, PersonImportAssessment};
use super::text::{
    normalize_email, normalize_many, normalize_name, normalize_optional, normalize_phone,
};
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;

pub struct AddPersonArgs<'a> {
    pub full_name: &'a str,
    pub preferred_name: Option<&'a str>,
    pub emails: Vec<&'a str>,
    pub phones: Vec<&'a str>,
    pub headline: Option<&'a str>,
    pub location: Option<&'a str>,
    pub summary: Option<&'a str>,
    pub notes: Option<&'a str>,
    pub source_slug: Option<&'a str>,
    pub external_kind: &'a str,
    pub external_id: Option<&'a str>,
    pub original_url: Option<&'a str>,
    pub allow_duplicate: bool,
}

/// Find an active person matching by any normalized email, else by normalized
/// name (only when the candidate carries no email handle, so two distinct people
/// who share a name but differ by email are not merged).
fn find_duplicate_person(
    conn: &Connection,
    full_name: &str,
    emails: &[String],
) -> Result<Option<String>, CliError> {
    for email in emails {
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
                params![email],
                |row| row.get::<_, String>(0),
            )
            .ok();
        if id.is_some() {
            return Ok(id);
        }
    }

    let name = normalize_name(full_name);
    if name.is_empty() {
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
                ) AS has_email_handle
         FROM people p
         WHERE p.archived_at IS NULL",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })?;
    for row in rows {
        let (id, candidate, candidate_email, has_email_handle) = row?;
        if normalize_name(&candidate) == name {
            if !emails.is_empty()
                && (normalize_email(candidate_email.as_deref()).is_some() || has_email_handle != 0)
            {
                continue;
            }
            return Ok(Some(id));
        }
    }
    Ok(None)
}

fn has_text(value: &Option<String>) -> bool {
    value.as_deref().is_some_and(|text| !text.trim().is_empty())
}

fn is_blank(value: &Option<String>) -> bool {
    !has_text(value)
}

/// Collapse a blank-or-missing string column to `None` so callers can treat an
/// empty denormalized value the same as an absent one.
fn blank_to_none(value: Option<String>) -> Option<String> {
    value.filter(|text| !text.trim().is_empty())
}

/// Does a *different* active person already own this normalized email, either as
/// their denormalized `people.primary_email` or as a `person_emails` row? Used to
/// keep the one-person-per-email invariant when a record is resolved via external
/// identity (which skips email-based dedupe). `email` must already be normalized
/// (lowercased) so it matches `person_emails.normalized_email` and the lowercased
/// denormalized primary.
fn email_owned_by_other(conn: &Connection, person_id: &str, email: &str) -> Result<bool, CliError> {
    let owned: bool = conn.query_row(
        "SELECT EXISTS(
           SELECT 1
           FROM people p
           LEFT JOIN person_emails pe ON pe.person_id = p.id
           WHERE p.archived_at IS NULL
             AND p.id <> ?2
             AND (lower(p.primary_email) = ?1 OR pe.normalized_email = ?1)
         )",
        params![email, person_id],
        |row| row.get(0),
    )?;
    Ok(owned)
}

fn enrich_duplicate_person(
    conn: &Connection,
    id: &str,
    args: &AddPersonArgs,
    emails: &[String],
    phones: &[String],
) -> Result<bool, CliError> {
    let preferred_name = normalize_optional(args.preferred_name);
    // Never promote an address another active person already owns into the blank
    // denormalized people.primary_email: insert_person_handles already skips such
    // emails for person_emails, so without this the external-id dedupe path could
    // leave the normalized table clean while stamping someone else's address onto
    // this person's primary_email. See email_owned_by_other.
    let primary_email = match emails.first() {
        Some(email) if !email_owned_by_other(conn, id, email)? => Some(email.clone()),
        _ => None,
    };
    let primary_phone = phones.first().cloned();
    let headline = normalize_optional(args.headline);
    let location = normalize_optional(args.location);
    let summary = normalize_optional(args.summary);
    let notes = normalize_optional(args.notes);

    let current = conn.query_row(
        "SELECT preferred_name, primary_email, primary_phone, headline, location,
                summary, notes
         FROM people
         WHERE id = ?1",
        params![id],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        },
    )?;

    let changed = (has_text(&preferred_name) && is_blank(&current.0))
        || (has_text(&primary_email) && is_blank(&current.1))
        || (has_text(&primary_phone) && is_blank(&current.2))
        || (has_text(&headline) && is_blank(&current.3))
        || (has_text(&location) && is_blank(&current.4))
        || (has_text(&summary) && is_blank(&current.5))
        || (has_text(&notes) && is_blank(&current.6));

    if !changed {
        return Ok(false);
    }

    conn.execute(
        "UPDATE people
         SET preferred_name = CASE
               WHEN (preferred_name IS NULL OR trim(preferred_name) = '') AND ?1 IS NOT NULL
               THEN ?1 ELSE preferred_name END,
             primary_email = CASE
               WHEN (primary_email IS NULL OR trim(primary_email) = '') AND ?2 IS NOT NULL
               THEN ?2 ELSE primary_email END,
             primary_phone = CASE
               WHEN (primary_phone IS NULL OR trim(primary_phone) = '') AND ?3 IS NOT NULL
               THEN ?3 ELSE primary_phone END,
             headline = CASE
               WHEN (headline IS NULL OR trim(headline) = '') AND ?4 IS NOT NULL
               THEN ?4 ELSE headline END,
             location = CASE
               WHEN (location IS NULL OR trim(location) = '') AND ?5 IS NOT NULL
               THEN ?5 ELSE location END,
             summary = CASE
               WHEN (summary IS NULL OR trim(summary) = '') AND ?6 IS NOT NULL
               THEN ?6 ELSE summary END,
             notes = CASE
               WHEN (notes IS NULL OR trim(notes) = '') AND ?7 IS NOT NULL
               THEN ?7 ELSE notes END,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?8",
        params![
            preferred_name,
            primary_email,
            primary_phone,
            headline,
            location,
            summary,
            notes,
            id,
        ],
    )?;
    Ok(true)
}

fn enrich_duplicate_person_email(
    conn: &Connection,
    id: &str,
    email: &str,
) -> Result<bool, CliError> {
    let email = normalize_email(Some(email));
    let current = conn.query_row(
        "SELECT primary_email FROM people WHERE id = ?1",
        params![id],
        |row| row.get::<_, Option<String>>(0),
    )?;
    if !has_text(&email) || !is_blank(&current) {
        return Ok(false);
    }
    // Mirror enrich_duplicate_person / insert_person_handles: never stamp an
    // address another active person already owns onto this blank primary_email.
    if let Some(addr) = email.as_deref() {
        if email_owned_by_other(conn, id, addr)? {
            return Ok(false);
        }
    }
    conn.execute(
        "UPDATE people
         SET primary_email = ?1,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?2",
        params![email, id],
    )?;
    Ok(true)
}

fn insert_person_handles(
    conn: &Connection,
    person_id: &str,
    emails: &[String],
    phones: &[String],
    source_id: Option<&str>,
) -> Result<(), CliError> {
    // On duplicate-person enrichment the record may already own a primary
    // handle. Only a person that has none yet should get one promoted; otherwise
    // a re-import that adds secondary addresses would leave the person with
    // multiple primary emails or phones.
    //
    // A legacy person can record its primary *only* in the denormalized
    // people.primary_email / people.primary_phone columns, with no is_primary
    // row in person_emails / person_phones yet. When that column is set we must
    // promote the handle that matches it (syncing the normalized table) rather
    // than blindly promoting index 0, which on a re-import could mark a
    // different, freshly imported address as primary while the denormalized
    // column still points elsewhere. The new-person path also pre-populates the
    // denormalized column from the first handle, so matching keeps that handle
    // primary too.
    let (primary_email, primary_phone): (Option<String>, Option<String>) = conn.query_row(
        "SELECT primary_email, primary_phone FROM people WHERE id = ?1",
        params![person_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let primary_email = blank_to_none(primary_email);
    let primary_phone = blank_to_none(primary_phone);

    let has_primary_email: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM person_emails WHERE person_id = ?1 AND is_primary = 1)",
        params![person_id],
        |row| row.get(0),
    )?;
    for (index, email) in emails.iter().enumerate() {
        // person_emails is only unique per person_id, so without this guard a
        // record resolved via external identity (which skips email-based dedupe)
        // could attach an address another active person already owns, breaking
        // the one-person-per-email invariant find_duplicate_person enforces.
        // Skip any email a *different* active person already holds.
        if email_owned_by_other(conn, person_id, email)? {
            continue;
        }
        // Compare against the denormalized primary case-insensitively: imported
        // emails are lowercased, but a legacy people.primary_email may not be, so
        // raw string equality would fail to sync the matching handle to primary.
        let is_primary_handle = !has_primary_email
            && match primary_email.as_deref() {
                Some(primary) => normalize_email(Some(primary)).as_deref() == Some(email.as_str()),
                None => index == 0,
            };
        let is_primary = i64::from(is_primary_handle);
        conn.execute(
            "INSERT OR IGNORE INTO person_emails
             (id, person_id, email, normalized_email, is_primary, source_id)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![new_id(), person_id, email, email, is_primary, source_id],
        )?;
    }
    let has_primary_phone: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM person_phones WHERE person_id = ?1 AND is_primary = 1)",
        params![person_id],
        |row| row.get(0),
    )?;
    for (index, phone) in phones.iter().enumerate() {
        // Match the denormalized primary by its digit-only form: a legacy
        // people.primary_phone can be stored with different formatting than the
        // imported handle, so raw string equality would miss the same number and
        // never sync it to is_primary.
        let is_primary_handle = !has_primary_phone
            && match primary_phone.as_deref() {
                Some(primary) => {
                    let normalized_primary = normalize_phone(Some(primary));
                    normalized_primary.is_some()
                        && normalized_primary == normalize_phone(Some(phone))
                }
                None => index == 0,
            };
        let is_primary = i64::from(is_primary_handle);
        conn.execute(
            "INSERT OR IGNORE INTO person_phones
             (id, person_id, phone, normalized_phone, is_primary, source_id)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                new_id(),
                person_id,
                phone,
                normalize_phone(Some(phone)).unwrap_or_else(|| phone.clone()),
                is_primary,
                source_id,
            ],
        )?;
    }
    Ok(())
}

pub fn add_person(conn: &mut Connection, json: bool, args: AddPersonArgs) -> Result<(), CliError> {
    let full_name = args.full_name.trim();
    if full_name.is_empty() {
        return Err(CliError::Runtime("--full-name cannot be blank".into()));
    }
    let emails = normalize_many(args.emails.iter().copied(), normalize_email);
    let phones = normalize_many(args.phones.iter().copied(), normalize_optional);
    let source_id = source_id(conn, args.source_slug)?;
    let kind = external_kind(args.external_kind);

    let existing_by_external = find_external_identity(
        conn,
        "person",
        source_id.as_deref(),
        &kind,
        args.external_id,
    )?;
    let existing = existing_by_external.or(find_duplicate_person(conn, full_name, &emails)?);
    // True when we fall through to the new-record path *despite* a match existing,
    // i.e. `--allow-duplicate` forced a fork. The new record must not steal the
    // matched record's external identity.
    let force_duplicate = existing.is_some() && args.allow_duplicate;
    if let Some(existing) = existing {
        if !args.allow_duplicate {
            // Apply the handle, enrichment, and external-identity writes as one
            // transaction so a late failure cannot leave a half-updated record,
            // matching the new-person and duplicate-interaction paths.
            let tx = conn.transaction()?;
            insert_person_handles(&tx, &existing, &emails, &phones, source_id.as_deref())?;
            enrich_duplicate_person(&tx, &existing, &args, &emails, &phones)?;
            insert_external_identity(
                &tx,
                ExternalIdentityWrite {
                    entity_type: "person",
                    entity_id: &existing,
                    source_id: source_id.as_deref(),
                    kind: &kind,
                    external_id: args.external_id,
                    url: args.original_url,
                    force_duplicate: false,
                },
            )?;
            tx.commit()?;
            return report_person(json, &existing, true);
        }
    }

    let id = new_id();
    let tx = conn.transaction()?;
    // Never stamp an address another active person already owns onto the new
    // record's denormalized people.primary_email: insert_person_handles skips
    // such emails for person_emails, so without this guard a --allow-duplicate
    // fork (or any new-person path) could show a stolen address on
    // people.primary_email with no matching person_emails row, breaking the
    // one-person-per-email invariant the duplicate/enrichment paths enforce.
    // See email_owned_by_other.
    let primary_email = match emails.first() {
        Some(email) if !email_owned_by_other(&tx, &id, email)? => Some(email.clone()),
        _ => None,
    };
    tx.execute(
        "INSERT INTO people (
           id, full_name, preferred_name, primary_email, primary_phone, headline,
           location, summary, notes
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            id,
            full_name,
            normalize_optional(args.preferred_name),
            primary_email,
            phones.first(),
            normalize_optional(args.headline),
            normalize_optional(args.location),
            normalize_optional(args.summary),
            normalize_optional(args.notes),
        ],
    )?;
    insert_person_handles(&tx, &id, &emails, &phones, source_id.as_deref())?;
    insert_external_identity(
        &tx,
        ExternalIdentityWrite {
            entity_type: "person",
            entity_id: &id,
            source_id: source_id.as_deref(),
            kind: &kind,
            external_id: args.external_id,
            url: args.original_url,
            force_duplicate,
        },
    )?;
    tx.commit()?;
    report_person(json, &id, false)
}

pub struct AddPersonFromEmailArgs<'a> {
    pub full_name: &'a str,
    pub email: &'a str,
    pub source_slug: Option<&'a str>,
    pub external_id: Option<&'a str>,
}

pub fn add_person_from_email(
    conn: &mut Connection,
    json: bool,
    args: AddPersonFromEmailArgs,
) -> Result<(), CliError> {
    let assessment = assess_person_import(args.full_name, args.email);
    if !assessment.should_create_person {
        return report_person_assessment(json, None, false, false, &assessment);
    }
    let source_id = source_id(conn, args.source_slug)?;
    let emails = vec![assessment.email.clone()];
    let existing_by_external = find_external_identity(
        conn,
        "person",
        source_id.as_deref(),
        "contact",
        args.external_id,
    )?;
    let existing = existing_by_external.or(find_duplicate_person(
        conn,
        &assessment.normalized_name,
        &emails,
    )?);
    if let Some(existing) = existing {
        // Same atomicity guarantee as add_person's duplicate path: handle,
        // enrichment, and external-identity writes commit together or not at all.
        let tx = conn.transaction()?;
        insert_person_handles(&tx, &existing, &emails, &[], source_id.as_deref())?;
        enrich_duplicate_person_email(&tx, &existing, &assessment.email)?;
        insert_external_identity(
            &tx,
            ExternalIdentityWrite {
                entity_type: "person",
                entity_id: &existing,
                source_id: source_id.as_deref(),
                kind: "contact",
                external_id: args.external_id,
                url: None,
                force_duplicate: false,
            },
        )?;
        tx.commit()?;
        return report_person_assessment(json, Some(&existing), false, true, &assessment);
    }

    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO people (id, full_name, primary_email, notes)
         VALUES (?1,?2,?3,?4)",
        params![
            id,
            &assessment.normalized_name,
            &assessment.email,
            format!(
                "Imported from untrusted email display name: {}",
                args.full_name
            ),
        ],
    )?;
    insert_person_handles(&tx, &id, &emails, &[], source_id.as_deref())?;
    insert_external_identity(
        &tx,
        ExternalIdentityWrite {
            entity_type: "person",
            entity_id: &id,
            source_id: source_id.as_deref(),
            kind: "contact",
            external_id: args.external_id,
            url: None,
            force_duplicate: false,
        },
    )?;
    tx.commit()?;
    report_person_assessment(json, Some(&id), true, false, &assessment)
}

fn report_person(json: bool, id: &str, duplicate: bool) -> Result<(), CliError> {
    if json {
        print_json(&json!({
            "kind": "person",
            "id": id,
            "isDuplicate": duplicate,
        }))
    } else {
        if duplicate {
            println!("person {id} (duplicate, skipped)");
        } else {
            println!("person {id}");
        }
        Ok(())
    }
}

fn report_person_assessment(
    json: bool,
    id: Option<&str>,
    created: bool,
    duplicate: bool,
    assessment: &PersonImportAssessment,
) -> Result<(), CliError> {
    if json {
        print_json(&json!({
            "kind": "person",
            "id": id,
            "created": created,
            "isDuplicate": duplicate,
            "normalizedName": assessment.normalized_name,
            "reasonCodes": assessment.reason_codes,
        }))
    } else {
        match id {
            Some(id) if duplicate => println!("person {id} (duplicate, skipped)"),
            Some(id) => println!("person {id}"),
            None => println!("person skipped: {}", assessment.reason_codes.join(", ")),
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn person_args<'a>(
        full_name: &'a str,
        emails: Vec<&'a str>,
        phones: Vec<&'a str>,
        external_id: Option<&'a str>,
    ) -> AddPersonArgs<'a> {
        AddPersonArgs {
            full_name,
            preferred_name: None,
            emails,
            phones,
            headline: None,
            location: None,
            summary: None,
            notes: None,
            source_slug: Some("manual"),
            external_kind: "contact",
            external_id,
            original_url: None,
            allow_duplicate: false,
        }
    }

    fn single_person_id(conn: &Connection, full_name: &str) -> String {
        conn.query_row(
            "SELECT id FROM people WHERE full_name = ?1 LIMIT 1",
            params![full_name],
            |row| row.get::<_, String>(0),
        )
        .unwrap()
    }

    #[test]
    fn add_person_duplicate_path_rolls_back_on_late_failure() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // Seed the active person via the new-person path (no external id yet).
        add_person(
            &mut conn,
            true,
            person_args("Robin Spencer", vec!["robin@example.com"], vec![], None),
        )
        .unwrap();
        let person_id = single_person_id(&conn, "Robin Spencer");

        // Force the final duplicate-path write (insert_external_identity) to fail
        // by removing its table. The earlier source-scoped lookup degrades to
        // "no match" gracefully, so the duplicate is still detected by email.
        conn.execute("DROP TABLE external_identities", []).unwrap();

        let result = add_person(
            &mut conn,
            true,
            // A new phone handle is written before the failing step.
            person_args(
                "Robin Spencer",
                vec!["robin@example.com"],
                vec!["+1 555 0103"],
                Some("ext-1"),
            ),
        );
        assert!(result.is_err(), "expected the missing-table write to error");

        let phone_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM person_phones WHERE person_id = ?1",
                params![person_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            phone_count, 0,
            "duplicate-path handle write must roll back when a later step fails"
        );
    }

    #[test]
    fn duplicate_enrichment_keeps_single_primary_handle() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // New-person path: the first email and phone must be promoted to primary.
        add_person(
            &mut conn,
            true,
            person_args(
                "Robin Spencer",
                vec!["robin@example.com"],
                vec!["+1 555 0100"],
                None,
            ),
        )
        .unwrap();
        let person_id = single_person_id(&conn, "Robin Spencer");

        let primary_emails = |conn: &Connection| -> i64 {
            conn.query_row(
                "SELECT COUNT(*) FROM person_emails WHERE person_id = ?1 AND is_primary = 1",
                params![person_id],
                |row| row.get(0),
            )
            .unwrap()
        };
        let primary_phones = |conn: &Connection| -> i64 {
            conn.query_row(
                "SELECT COUNT(*) FROM person_phones WHERE person_id = ?1 AND is_primary = 1",
                params![person_id],
                |row| row.get(0),
            )
            .unwrap()
        };
        assert_eq!(
            primary_emails(&conn),
            1,
            "new person gets one primary email"
        );
        assert_eq!(
            primary_phones(&conn),
            1,
            "new person gets one primary phone"
        );

        // Duplicate enrichment: a re-import that only adds secondary addresses
        // must not promote the new rows to primary. The brand-new address is
        // listed *first* so the batch's index-0 slot is a genuinely new row
        // (the buggy `index == 0` rule would flag it primary); the existing
        // primary trails it so the duplicate still resolves to this person.
        add_person(
            &mut conn,
            true,
            person_args(
                "Robin Spencer",
                vec!["robin.work@example.com", "robin@example.com"],
                vec!["+1 555 0200", "+1 555 0100"],
                None,
            ),
        )
        .unwrap();

        let email_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM person_emails WHERE person_id = ?1",
                params![person_id],
                |row| row.get(0),
            )
            .unwrap();
        let phone_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM person_phones WHERE person_id = ?1",
                params![person_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(email_count, 2, "secondary email row was added");
        assert_eq!(phone_count, 2, "secondary phone row was added");
        assert_eq!(
            primary_emails(&conn),
            1,
            "duplicate enrichment must not create a second primary email"
        );
        assert_eq!(
            primary_phones(&conn),
            1,
            "duplicate enrichment must not create a second primary phone"
        );
    }

    #[test]
    fn legacy_denormalized_primary_blocks_handle_promotion() {
        // A legacy person can carry only the denormalized people.primary_email /
        // people.primary_phone columns with no is_primary row in person_emails /
        // person_phones yet. Importing a new handle for such a person must not
        // promote it to primary, or the is_primary flag would point somewhere
        // other than the denormalized primary columns still record.
        let conn = brain_schema::open_in_memory().unwrap();
        let person_id = new_id();
        conn.execute(
            "INSERT INTO people (id, full_name, primary_email, primary_phone)
             VALUES (?1, 'Robin Spencer', 'robin@example.com', '+15550100')",
            params![person_id],
        )
        .unwrap();

        insert_person_handles(
            &conn,
            &person_id,
            &["robin.work@example.com".to_string()],
            &["+15550200".to_string()],
            None,
        )
        .unwrap();

        let primary_emails: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM person_emails WHERE person_id = ?1 AND is_primary = 1",
                params![person_id],
                |row| row.get(0),
            )
            .unwrap();
        let primary_phones: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM person_phones WHERE person_id = ?1 AND is_primary = 1",
                params![person_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            primary_emails, 0,
            "legacy denormalized primary_email must block promoting the imported email"
        );
        assert_eq!(
            primary_phones, 0,
            "legacy denormalized primary_phone must block promoting the imported phone"
        );
    }

    #[test]
    fn legacy_denormalized_primary_syncs_to_handle_despite_formatting() {
        // The denormalized columns can carry a differently-cased email or a
        // differently-formatted phone than the imported (normalized) handles.
        // Promotion must match on the normalized form so the same address/number
        // gets is_primary = 1, keeping person_emails / person_phones in sync with
        // the legacy people.primary_email / people.primary_phone columns.
        let conn = brain_schema::open_in_memory().unwrap();
        let person_id = new_id();
        conn.execute(
            "INSERT INTO people (id, full_name, primary_email, primary_phone)
             VALUES (?1, 'Robin Spencer', 'Robin@Example.COM', '+1 (555) 010-0100')",
            params![person_id],
        )
        .unwrap();

        insert_person_handles(
            &conn,
            &person_id,
            &["robin@example.com".to_string()],
            &["+15550100100".to_string()],
            None,
        )
        .unwrap();

        let primary_email: Option<String> = conn
            .query_row(
                "SELECT email FROM person_emails
                 WHERE person_id = ?1 AND is_primary = 1",
                params![person_id],
                |row| row.get(0),
            )
            .ok();
        assert_eq!(
            primary_email.as_deref(),
            Some("robin@example.com"),
            "case-insensitive primary_email match must sync the handle to primary"
        );

        let primary_phone: Option<String> = conn
            .query_row(
                "SELECT phone FROM person_phones
                 WHERE person_id = ?1 AND is_primary = 1",
                params![person_id],
                |row| row.get(0),
            )
            .ok();
        assert_eq!(
            primary_phone.as_deref(),
            Some("+15550100100"),
            "differently-formatted primary_phone must still sync the handle to primary"
        );
    }

    #[test]
    fn external_identity_dedupe_does_not_steal_another_persons_email() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // Alice owns alice@example.com (external id ext-alice).
        add_person(
            &mut conn,
            true,
            person_args(
                "Alice Owner",
                vec!["alice@example.com"],
                vec![],
                Some("ext-alice"),
            ),
        )
        .unwrap();
        let alice_id = single_person_id(&conn, "Alice Owner");

        // Bob is a separate active person carrying external id ext-bob.
        add_person(
            &mut conn,
            true,
            person_args(
                "Bob Other",
                vec!["bob@example.com"],
                vec![],
                Some("ext-bob"),
            ),
        )
        .unwrap();
        let bob_id = single_person_id(&conn, "Bob Other");

        // Re-import ext-bob (resolves to Bob via external identity, skipping
        // email-based dedupe) but supplying Alice's email. Bob must not absorb an
        // address another active person already owns.
        add_person(
            &mut conn,
            true,
            person_args(
                "Bob Other",
                vec!["alice@example.com"],
                vec![],
                Some("ext-bob"),
            ),
        )
        .unwrap();

        let bob_has_alice_email: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM person_emails
                 WHERE person_id = ?1 AND normalized_email = 'alice@example.com'",
                params![bob_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            bob_has_alice_email, 0,
            "external-id dedupe must not attach an email owned by another person"
        );

        // The one-person-per-email invariant still holds: a single active person
        // owns alice@example.com, and it is Alice.
        let owners: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT p.id)
                 FROM people p
                 LEFT JOIN person_emails pe ON pe.person_id = p.id
                 WHERE p.archived_at IS NULL
                   AND (lower(p.primary_email) = 'alice@example.com'
                        OR pe.normalized_email = 'alice@example.com')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(owners, 1, "exactly one active person may own the email");
        assert_ne!(alice_id, bob_id, "Alice and Bob are distinct people");
    }

    #[test]
    fn add_person_reimport_after_archive_repoints_external_identity() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // First import: an active person carrying external id "ext-1".
        add_person(
            &mut conn,
            true,
            person_args(
                "Robin Spencer",
                vec!["robin@example.com"],
                vec![],
                Some("ext-1"),
            ),
        )
        .unwrap();
        let archived_id = single_person_id(&conn, "Robin Spencer");
        conn.execute(
            "UPDATE people SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
            params![archived_id],
        )
        .unwrap();

        // Re-import the same external id with a distinct name/email so neither the
        // external-identity lookup (archived) nor the name/email fallback matches.
        // A fresh active person must be created.
        add_person(
            &mut conn,
            true,
            person_args(
                "Robin Spencer Reborn",
                vec!["robin.reborn@example.com"],
                vec![],
                Some("ext-1"),
            ),
        )
        .unwrap();
        let active_id = single_person_id(&conn, "Robin Spencer Reborn");
        assert_ne!(active_id, archived_id, "expected a brand new active person");

        // The single (source, kind, external_id) identity row must now point at
        // the new active record, not the archived one.
        let identity_target: String = conn
            .query_row(
                "SELECT entity_id FROM external_identities
                 WHERE entity_type = 'person' AND kind = 'contact' AND external_id = 'ext-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            identity_target, active_id,
            "archived re-import must re-point the external identity to the active record"
        );

        // A later import with the same external id now dedupes onto the active
        // record instead of creating a third person.
        add_person(
            &mut conn,
            true,
            person_args(
                "Totally Different Name",
                vec!["different@example.com"],
                vec![],
                Some("ext-1"),
            ),
        )
        .unwrap();
        let active_people: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM people WHERE archived_at IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            active_people, 1,
            "external-id dedupe must reuse the active record after a re-point"
        );
    }

    #[test]
    fn add_person_reimport_does_not_clobber_active_external_identity() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // Two distinct active people; only the first owns external id "ext-1".
        add_person(
            &mut conn,
            true,
            person_args(
                "Alice Owner",
                vec!["alice@example.com"],
                vec![],
                Some("ext-1"),
            ),
        )
        .unwrap();
        let owner_id = single_person_id(&conn, "Alice Owner");

        // Re-importing "ext-1" while the owner is still active must dedupe onto the
        // owner and leave the identity row untouched (never re-point to anyone).
        add_person(
            &mut conn,
            true,
            person_args(
                "Alice Owner",
                vec!["alice@example.com"],
                vec![],
                Some("ext-1"),
            ),
        )
        .unwrap();
        let identity_target: String = conn
            .query_row(
                "SELECT entity_id FROM external_identities
                 WHERE entity_type = 'person' AND kind = 'contact' AND external_id = 'ext-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            identity_target, owner_id,
            "an active external identity must not be re-pointed on re-import"
        );
    }

    #[test]
    fn add_person_reimport_refreshes_external_identity_url_on_same_active_record() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // First import: an active person carrying external id "ext-1" but no URL.
        add_person(
            &mut conn,
            true,
            person_args(
                "Robin Spencer",
                vec!["robin@example.com"],
                vec![],
                Some("ext-1"),
            ),
        )
        .unwrap();
        let person_id = single_person_id(&conn, "Robin Spencer");
        let stored_url: Option<String> = conn
            .query_row(
                "SELECT url FROM external_identities
                 WHERE entity_type = 'person' AND kind = 'contact' AND external_id = 'ext-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored_url, None, "first import should leave the URL null");

        // Re-import the same external id (dedupes onto the same active person) now
        // carrying an original URL. The duplicate path must fill the null URL.
        add_person(
            &mut conn,
            true,
            AddPersonArgs {
                original_url: Some("https://example.com/robin"),
                ..person_args(
                    "Robin Spencer",
                    vec!["robin@example.com"],
                    vec![],
                    Some("ext-1"),
                )
            },
        )
        .unwrap();
        let same_person = single_person_id(&conn, "Robin Spencer");
        assert_eq!(same_person, person_id, "re-import must dedupe, not fork");
        let filled_url: Option<String> = conn
            .query_row(
                "SELECT url FROM external_identities
                 WHERE entity_type = 'person' AND kind = 'contact' AND external_id = 'ext-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            filled_url.as_deref(),
            Some("https://example.com/robin"),
            "duplicate re-import must fill a previously null external-identity URL"
        );

        // A later re-import with a changed URL must refresh the stored value.
        add_person(
            &mut conn,
            true,
            AddPersonArgs {
                original_url: Some("https://example.com/robin-updated"),
                ..person_args(
                    "Robin Spencer",
                    vec!["robin@example.com"],
                    vec![],
                    Some("ext-1"),
                )
            },
        )
        .unwrap();
        let refreshed_url: Option<String> = conn
            .query_row(
                "SELECT url FROM external_identities
                 WHERE entity_type = 'person' AND kind = 'contact' AND external_id = 'ext-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            refreshed_url.as_deref(),
            Some("https://example.com/robin-updated"),
            "duplicate re-import must refresh a changed external-identity URL"
        );

        // A URL-less re-import must not clobber the stored URL back to null.
        add_person(
            &mut conn,
            true,
            person_args(
                "Robin Spencer",
                vec!["robin@example.com"],
                vec![],
                Some("ext-1"),
            ),
        )
        .unwrap();
        let preserved_url: Option<String> = conn
            .query_row(
                "SELECT url FROM external_identities
                 WHERE entity_type = 'person' AND kind = 'contact' AND external_id = 'ext-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            preserved_url.as_deref(),
            Some("https://example.com/robin-updated"),
            "a URL-less re-import must not clobber an existing external-identity URL"
        );
    }

    #[test]
    fn add_person_from_email_duplicate_path_rolls_back_on_late_failure() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // Seed an active person with a blank primary email so the duplicate path
        // performs a visible enrichment that should also roll back.
        add_person(
            &mut conn,
            true,
            person_args("Robin Spencer", vec![], vec![], None),
        )
        .unwrap();
        let person_id = single_person_id(&conn, "Robin Spencer");

        conn.execute("DROP TABLE external_identities", []).unwrap();

        let result = add_person_from_email(
            &mut conn,
            true,
            AddPersonFromEmailArgs {
                full_name: "Robin Spencer",
                email: "robin@example.com",
                source_slug: Some("gmail"),
                external_id: Some("msg-1"),
            },
        );
        assert!(result.is_err(), "expected the missing-table write to error");

        let (primary_email, email_handles): (Option<String>, i64) = conn
            .query_row(
                "SELECT p.primary_email,
                        (SELECT COUNT(*) FROM person_emails pe WHERE pe.person_id = p.id)
                 FROM people p WHERE p.id = ?1",
                params![person_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            primary_email, None,
            "duplicate-path enrichment must roll back when a later step fails"
        );
        assert_eq!(
            email_handles, 0,
            "duplicate-path handle write must roll back when a later step fails"
        );
    }

    #[test]
    fn external_identity_dedupe_does_not_enrich_blank_primary_with_owned_email() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // Alice owns alice@example.com (external id ext-alice).
        add_person(
            &mut conn,
            true,
            person_args(
                "Alice Owner",
                vec!["alice@example.com"],
                vec![],
                Some("ext-alice"),
            ),
        )
        .unwrap();

        // Bob is a separate active person carrying external id ext-bob but, crucially,
        // a *blank* denormalized primary_email so the enrichment path is live.
        add_person(
            &mut conn,
            true,
            person_args("Bob Other", vec![], vec![], Some("ext-bob")),
        )
        .unwrap();
        let bob_id = single_person_id(&conn, "Bob Other");

        // Re-import ext-bob (resolves to Bob via external identity, skipping
        // email-based dedupe) supplying Alice's address. insert_person_handles
        // already refuses the owned email; the denormalized enrichment path must
        // refuse it too, or people.primary_email gets stamped with Alice's address
        // while person_emails stays clean.
        add_person(
            &mut conn,
            true,
            person_args(
                "Bob Other",
                vec!["alice@example.com"],
                vec![],
                Some("ext-bob"),
            ),
        )
        .unwrap();

        let bob_primary: Option<String> = conn
            .query_row(
                "SELECT primary_email FROM people WHERE id = ?1",
                params![bob_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            bob_primary, None,
            "blank primary_email must not be enriched with an email another active person owns"
        );

        // The denormalized column and the normalized table stay consistent: a
        // single active person owns alice@example.com.
        let owners: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT p.id)
                 FROM people p
                 LEFT JOIN person_emails pe ON pe.person_id = p.id
                 WHERE p.archived_at IS NULL
                   AND (lower(p.primary_email) = 'alice@example.com'
                        OR pe.normalized_email = 'alice@example.com')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(owners, 1, "exactly one active person may own the email");
    }

    #[test]
    fn add_person_from_email_does_not_enrich_blank_primary_with_owned_email() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // Alice owns alice@example.com.
        add_person(
            &mut conn,
            true,
            person_args("Alice Owner", vec!["alice@example.com"], vec![], None),
        )
        .unwrap();

        // Bob: an active person with a blank primary_email and a Gmail-sourced
        // external identity, so an add_person_from_email re-import resolves to him
        // via external identity (skipping email-based dedupe) and exercises
        // enrich_duplicate_person_email.
        let bob_id = new_id();
        conn.execute(
            "INSERT INTO people (id, full_name) VALUES (?1, 'Bob Other')",
            params![bob_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO external_identities
               (id, entity_type, entity_id, source_id, kind, external_id)
             VALUES (?1, 'person', ?2, 'source_gmail', 'contact', 'msg-bob')",
            params![new_id(), bob_id],
        )
        .unwrap();

        add_person_from_email(
            &mut conn,
            true,
            AddPersonFromEmailArgs {
                full_name: "Bob Other",
                email: "alice@example.com",
                source_slug: Some("gmail"),
                external_id: Some("msg-bob"),
            },
        )
        .unwrap();

        let bob_primary: Option<String> = conn
            .query_row(
                "SELECT primary_email FROM people WHERE id = ?1",
                params![bob_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            bob_primary, None,
            "email-import enrichment must not stamp an owned email onto a blank primary_email"
        );
        let bob_has_alice_email: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM person_emails
                 WHERE person_id = ?1 AND normalized_email = 'alice@example.com'",
                params![bob_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            bob_has_alice_email, 0,
            "email-import dedupe must not attach an email owned by another person"
        );
    }

    #[test]
    fn allow_duplicate_person_does_not_steal_external_identity() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // First import: an active person owning external id ext-1.
        add_person(
            &mut conn,
            true,
            person_args(
                "Robin Spencer",
                vec!["robin@example.com"],
                vec![],
                Some("ext-1"),
            ),
        )
        .unwrap();
        let original_id = single_person_id(&conn, "Robin Spencer");

        // A forced duplicate import for the *same* external id must succeed (the
        // identity insert must not error on the unique-constraint conflict) and
        // must leave the identity pointing at the original active record.
        add_person(
            &mut conn,
            true,
            AddPersonArgs {
                allow_duplicate: true,
                ..person_args(
                    "Robin Spencer",
                    vec!["robin.alt@example.com"],
                    vec![],
                    Some("ext-1"),
                )
            },
        )
        .unwrap();

        let active_people: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM people WHERE archived_at IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            active_people, 2,
            "allow-duplicate must fork a second record"
        );

        let identity_rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM external_identities
                 WHERE kind = 'contact' AND external_id = 'ext-1'",
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
                 WHERE kind = 'contact' AND external_id = 'ext-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            identity_target, original_id,
            "a forced duplicate must not steal the original record's external identity"
        );
    }

    #[test]
    fn allow_duplicate_fork_does_not_set_owned_primary_email() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // Alice: an active person who owns alice@example.com.
        add_person(
            &mut conn,
            true,
            person_args("Alice Smith", vec!["alice@example.com"], vec![], None),
        )
        .unwrap();
        let original_id = single_person_id(&conn, "Alice Smith");

        // A forced duplicate that re-imports Alice's address forks a new record.
        // insert_person_handles skips the owned email for person_emails, so the
        // new people.primary_email must not be stamped with it either — otherwise
        // the fork shows a stolen address with no matching person_emails row.
        add_person(
            &mut conn,
            true,
            AddPersonArgs {
                allow_duplicate: true,
                ..person_args("Alice Smith", vec!["alice@example.com"], vec![], None)
            },
        )
        .unwrap();

        let fork_id: String = conn
            .query_row(
                "SELECT id FROM people WHERE archived_at IS NULL AND id <> ?1",
                params![original_id],
                |row| row.get(0),
            )
            .unwrap();

        let fork_primary_email: Option<String> = conn
            .query_row(
                "SELECT primary_email FROM people WHERE id = ?1",
                params![fork_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            fork_primary_email, None,
            "a forced duplicate must not stamp an owned email onto its primary_email"
        );

        // The skipped email must leave no person_emails row on the fork, keeping
        // the one-person-per-email invariant intact.
        let fork_email_rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM person_emails WHERE person_id = ?1",
                params![fork_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            fork_email_rows, 0,
            "the owned email is skipped, so the fork holds no person_emails row"
        );

        // Alice still solely owns the address.
        let owners: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM people p
                 LEFT JOIN person_emails pe ON pe.person_id = p.id
                 WHERE p.archived_at IS NULL
                   AND (lower(p.primary_email) = 'alice@example.com'
                        OR pe.normalized_email = 'alice@example.com')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            owners, 1,
            "alice@example.com must stay owned by exactly one person"
        );
    }
}
