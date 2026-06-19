//! Write commands: `brain add document|interaction|task` and `brain remember`.
//! Each write runs in a single transaction (record + derived chunks + links),
//! mirroring the app's `ingestDocument`/`ingestInteraction` so provenance and
//! dedupe behave identically regardless of which tool wrote the record.

use std::path::Path;

use rusqlite::{params, Connection};
use serde_json::json;
use sha2::{Digest, Sha256};
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

use super::{now_iso, LinkKind, LinkRef};
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;
use crate::text::{chunk_text, content_hash, normalize_text};

fn normalize_optional(raw: Option<&str>) -> Option<String> {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn normalize_email(raw: Option<&str>) -> Option<String> {
    normalize_optional(raw).map(|value| value.to_lowercase())
}

fn normalize_phone(raw: Option<&str>) -> Option<String> {
    normalize_optional(raw)
        .map(|value| value.chars().filter(|c| c.is_ascii_digit()).collect())
        .filter(|value: &String| !value.is_empty())
}

fn normalize_many<'a>(
    raw: impl IntoIterator<Item = &'a str>,
    normalize: fn(Option<&str>) -> Option<String>,
) -> Vec<String> {
    let mut values = Vec::new();
    for item in raw {
        if let Some(value) = normalize(Some(item)) {
            if !values.iter().any(|existing| existing == &value) {
                values.push(value);
            }
        }
    }
    values
}

fn normalize_name(raw: &str) -> String {
    raw.to_lowercase()
        .nfkd()
        .filter(|c| !is_combining_mark(*c))
        .map(|c| {
            if c.is_alphanumeric() || c.is_whitespace() {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_source_slug(raw: &str) -> String {
    raw.trim().to_lowercase()
}

fn valid_email(email: &str) -> bool {
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.trim().is_empty()
        && !domain.trim().is_empty()
        && domain.contains('.')
        && !email.chars().any(char::is_whitespace)
}

fn source_id(conn: &Connection, slug: Option<&str>) -> Result<Option<String>, CliError> {
    let Some(slug) = slug.map(normalize_source_slug).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let id = conn
        .query_row(
            "SELECT id FROM sources WHERE slug = ?1",
            params![slug],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| {
            CliError::Runtime(format!(
                "unknown source '{slug}' (run `brain source ensure ...`)"
            ))
        })?;
    Ok(Some(id))
}

fn external_kind(raw: &str) -> String {
    normalize_optional(Some(raw)).unwrap_or_else(|| "record".to_string())
}

fn safe_filename(raw: &str) -> String {
    let cleaned = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches(['.', '-'])
        .to_string();
    if cleaned.is_empty() {
        "asset".to_string()
    } else {
        cleaned
    }
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Find a non-archived record in `table` with this content hash (dedupe).
fn find_duplicate(conn: &Connection, table: &str, hash: &str) -> Result<Option<String>, CliError> {
    let sql =
        format!("SELECT id FROM {table} WHERE content_hash = ?1 AND archived_at IS NULL LIMIT 1");
    let id = conn
        .query_row(&sql, params![hash], |row| row.get::<_, String>(0))
        .ok();
    Ok(id)
}

fn find_external_identity(
    conn: &Connection,
    entity_type: &str,
    source_id: Option<&str>,
    kind: &str,
    external_id: Option<&str>,
) -> Result<Option<String>, CliError> {
    let (Some(source_id), Some(external_id)) = (
        source_id,
        normalize_optional(external_id).filter(|value| !value.is_empty()),
    ) else {
        return Ok(None);
    };
    let id = conn
        .query_row(
            "SELECT entity_id
             FROM external_identities
             WHERE entity_type = ?1
               AND source_id = ?2
               AND kind = ?3
               AND external_id = ?4
             LIMIT 1",
            params![entity_type, source_id, kind, external_id],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(id)
}

fn insert_external_identity(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
    source_id: Option<&str>,
    kind: &str,
    external_id: Option<&str>,
    url: Option<&str>,
) -> Result<(), CliError> {
    let (Some(source_id), Some(external_id)) = (
        source_id,
        normalize_optional(external_id).filter(|value| !value.is_empty()),
    ) else {
        return Ok(());
    };
    conn.execute(
        "INSERT OR IGNORE INTO external_identities
         (id, entity_type, entity_id, source_id, kind, external_id, url)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            new_id(),
            entity_type,
            entity_id,
            source_id,
            kind,
            external_id,
            normalize_optional(url),
        ],
    )?;
    Ok(())
}

fn insert_chunks(
    conn: &Connection,
    record_type: &str,
    record_id: &str,
    body: &str,
) -> Result<usize, CliError> {
    let chunks = chunk_text(body);
    for (index, text) in chunks.iter().enumerate() {
        conn.execute(
            "INSERT INTO content_chunks (id, record_type, record_id, chunk_index, text) VALUES (?1,?2,?3,?4,?5)",
            params![new_id(), record_type, record_id, index as i64, text],
        )?;
    }
    Ok(chunks.len())
}

/// Insert the typed link rows for a document/interaction.
fn insert_links(
    conn: &Connection,
    owner: &str,
    owner_id: &str,
    links: &[LinkRef],
) -> Result<(), CliError> {
    for link in links {
        let (table, owner_col, other_col, other) = link_table(owner, link)?;
        let sql = format!(
            "INSERT OR IGNORE INTO {table} (id, {owner_col}, {other_col}) VALUES (?1,?2,?3)"
        );
        conn.execute(&sql, params![new_id(), owner_id, link.id])
            .map_err(|e| CliError::Runtime(format!("could not link {other}: {e}")))?;
    }
    Ok(())
}

/// Map (owner, link) to the join table + columns. `owner` is "document" | "interaction".
fn link_table(
    owner: &str,
    link: &LinkRef,
) -> Result<(&'static str, &'static str, &'static str, &'static str), CliError> {
    let table = match (owner, link.kind) {
        ("document", LinkKind::Person) => ("document_people", "document_id", "person_id", "person"),
        ("document", LinkKind::Organization) => (
            "document_organizations",
            "document_id",
            "organization_id",
            "organization",
        ),
        ("document", LinkKind::Project) => {
            ("project_documents", "document_id", "project_id", "project")
        }
        ("document", LinkKind::Task) => ("task_documents", "document_id", "task_id", "task"),
        ("interaction", LinkKind::Person) => (
            "interaction_participants",
            "interaction_id",
            "person_id",
            "person",
        ),
        ("interaction", LinkKind::Organization) => (
            "interaction_organizations",
            "interaction_id",
            "organization_id",
            "organization",
        ),
        ("interaction", LinkKind::Project) => (
            "project_interactions",
            "interaction_id",
            "project_id",
            "project",
        ),
        ("interaction", LinkKind::Task) => {
            ("task_interactions", "interaction_id", "task_id", "task")
        }
        _ => {
            return Err(CliError::Runtime(format!(
                "{owner} records cannot link to {}",
                record_type(link)
            )));
        }
    };
    Ok(table)
}

struct PersonImportAssessment {
    normalized_name: String,
    email: String,
    should_create_person: bool,
    reason_codes: Vec<&'static str>,
}

fn assess_person_import(raw_name: &str, email: &str) -> PersonImportAssessment {
    let email = normalize_email(Some(email)).unwrap_or_default();
    let (normalized_name, has_route_phrase) = normalize_untrusted_name(raw_name);
    let mut reason_codes = Vec::new();
    if !valid_email(&email) {
        reason_codes.push("invalid_email");
    }
    if is_machine_email(&email) {
        reason_codes.push("machine_email");
    }
    if normalized_name.is_empty() {
        reason_codes.push("missing_name");
    }
    if !normalized_name.is_empty()
        && (normalized_name.eq_ignore_ascii_case(&email)
            || normalized_name.contains('@')
            || normalize_email(Some(&normalized_name)).as_deref() == Some(email.as_str()))
    {
        reason_codes.push("email_as_name");
    }
    // A routing marker (" via ", " from ", " at ") was stripped from the display
    // name. That alone is not disqualifying: senders such as
    // "Robin Spencer via LinkedIn" normalize to a perfectly usable "Robin Spencer".
    // Only flag it when the residual name does not independently read like a
    // capitalized person name, so noise like "noreply via Mailchimp" -> "noreply"
    // is still skipped.
    if has_route_phrase && !looks_like_capitalized_person_name(&normalized_name) {
        reason_codes.push("route_phrase");
    }
    if has_numeric_or_token_noise(&normalized_name) {
        reason_codes.push("numeric_or_token_noise");
    }
    if !normalized_name.is_empty()
        && !reason_codes.iter().any(|code| {
            matches!(
                *code,
                "email_as_name" | "numeric_or_token_noise" | "route_phrase"
            )
        })
        && !looks_like_capitalized_person_name(&normalized_name)
    {
        reason_codes.push("not_capitalized_first_last");
    }

    PersonImportAssessment {
        normalized_name,
        email,
        should_create_person: reason_codes.is_empty(),
        reason_codes,
    }
}

fn normalize_untrusted_name(raw: &str) -> (String, bool) {
    let cleaned = raw
        .trim()
        .trim_matches(|c: char| c == '\'' || c == '"')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let lower = cleaned.to_lowercase();
    let mut route_index = None;
    for needle in [" via ", " from ", " at "] {
        if let Some(index) = lower.rfind(needle) {
            route_index = Some(route_index.map_or(index, |current: usize| current.min(index)));
        }
    }
    let route_stripped = route_index
        .map(|index| cleaned[..index].trim().to_string())
        .unwrap_or(cleaned);
    let parts: Vec<&str> = route_stripped.split(',').map(str::trim).collect();
    // Only invert `Last, First` directory strings when both sides read like a
    // real person name. Org/department labels such as "Acme, Sales" or
    // "Amazon, Customer Service" keep their comma so the downstream
    // capitalized-name guardrail rejects them instead of minting fake people.
    let normalized = if parts.len() == 2 && is_plausible_person_comma_inversion(parts[0], parts[1])
    {
        format!("{} {}", parts[1], parts[0])
    } else {
        route_stripped
    };
    (normalized.trim().to_string(), route_index.is_some())
}

/// Whether `Last, First` should be inverted to `First Last`. We require the
/// segment after the comma to look like a given name (one token, optionally a
/// trailing initial) and reject obvious organization/role labels on either side.
fn is_plausible_person_comma_inversion(last: &str, first: &str) -> bool {
    let last = last.trim();
    let first = first.trim();
    if last.is_empty() || first.is_empty() || is_name_suffix(first) {
        return false;
    }
    if last.split_whitespace().any(is_generic_role_term)
        || first.split_whitespace().any(is_generic_role_term)
    {
        return false;
    }
    if !is_plausible_given_name_segment(first) {
        return false;
    }
    looks_like_capitalized_person_name(&format!("{first} {last}"))
}

/// A `First` segment from a directory `Last, First` string: a single given name,
/// optionally followed by a short initial like `A.`. Two full words (e.g.
/// "Customer Service") are rejected.
fn is_plausible_given_name_segment(first: &str) -> bool {
    let mut words = first.split_whitespace();
    let Some(given) = words.next() else {
        return false;
    };
    if is_generic_role_term(given) {
        return false;
    }
    match words.next() {
        None => true,
        Some(second) => words.next().is_none() && is_name_initial(second),
    }
}

fn is_name_initial(token: &str) -> bool {
    let core = token.trim_end_matches('.');
    core.chars().count() == 1 && core.chars().all(char::is_alphabetic)
}

/// Generic role/department words that signal an organization mailbox rather than
/// a personal name (e.g. "Acme, Sales"). Mirrors the generic locals used by
/// `is_machine_email`.
fn is_generic_role_term(word: &str) -> bool {
    let cleaned = word
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase();
    matches!(
        cleaned.as_str(),
        "accounting"
            | "admin"
            | "billing"
            | "concierge"
            | "contact"
            | "customer"
            | "department"
            | "devs"
            | "education"
            | "finance"
            | "hello"
            | "help"
            | "info"
            | "marketing"
            | "newsletter"
            | "notifications"
            | "ops"
            | "operations"
            | "registration"
            | "sales"
            | "service"
            | "services"
            | "ship"
            | "support"
            | "team"
    )
}

fn is_name_suffix(raw: &str) -> bool {
    matches!(
        raw.trim().trim_matches('.').to_lowercase().as_str(),
        "jr" | "sr" | "ii" | "iii" | "iv" | "md" | "m d" | "do" | "d o" | "phd" | "ph d"
    )
}

fn is_machine_email(email: &str) -> bool {
    if !valid_email(email) {
        return false;
    }
    let (local, domain) = email.split_once('@').unwrap_or(("", ""));
    let generic = [
        "accounting",
        "admin",
        "announcements",
        "billing",
        "concierge",
        "contact",
        "customer.service",
        "customerservice",
        "devs",
        "do-not-reply",
        "donotreply",
        "education",
        "finance",
        "hello",
        "help",
        "info",
        "marketing",
        "newsletter",
        "no-reply",
        "noreply",
        "notifications",
        "ops",
        "operations",
        "postmaster",
        "registration",
        "sales",
        "ship",
        "support",
        "team",
        "test",
    ];
    if generic.contains(&local) {
        return true;
    }
    if [
        "bounce",
        "bounces",
        "mailer-daemon",
        "notification",
        "notifications",
        "reply",
        "replies",
    ]
    .iter()
    .any(|prefix| {
        local == *prefix
            || local.starts_with(&format!("{prefix}."))
            || local.starts_with(&format!("{prefix}-"))
            || local.starts_with(&format!("{prefix}_"))
    }) {
        return true;
    }
    if local.starts_with("no.reply")
        || local.starts_with("no-reply")
        || local.starts_with("noreply")
        || local.starts_with("do-not-reply")
        || local.starts_with("donotreply")
    {
        return true;
    }
    if [
        "adobesign.com",
        "docusign.net",
        "email.pandadoc.net",
        "facebookmail.com",
        "info.vercel.com",
        "login.customer.io",
        "team.twilio.com",
    ]
    .contains(&domain)
    {
        return true;
    }
    if domain.ends_with(".bnc.salesforce.com") {
        return true;
    }
    let compact: String = local
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    compact.len() >= 28 && compact.chars().any(|c| c.is_ascii_digit())
}

fn has_numeric_or_token_noise(name: &str) -> bool {
    let compact: String = name.chars().filter(|c| c.is_alphanumeric()).collect();
    name.chars().any(|c| c.is_ascii_digit())
        || (compact.chars().count() >= 24 && compact.chars().any(|c| c.is_ascii_digit()))
}

fn looks_like_capitalized_person_name(name: &str) -> bool {
    let without_suffix = strip_name_suffix(name);
    let words: Vec<&str> = without_suffix.split_whitespace().collect();
    if words.len() < 2 || words.len() > 6 {
        return false;
    }
    let particles = [
        "de", "del", "der", "van", "von", "da", "di", "la", "le", "du",
    ];
    words.iter().all(|word| {
        // A surviving comma marks an un-inverted org string (e.g. "Acme,") that
        // normalize_untrusted_name deliberately left alone — not a person name.
        if word.contains(',') {
            return false;
        }
        let trimmed = word.trim_matches(|c: char| c == '\'' || c == '.' || c == '-');
        if trimmed.is_empty() {
            return false;
        }
        let lower = trimmed.to_lowercase();
        if particles.contains(&lower.as_str()) {
            return true;
        }
        trimmed
            .chars()
            .next()
            .map(|c| c.is_uppercase())
            .unwrap_or(false)
    })
}

fn strip_name_suffix(name: &str) -> String {
    let parts: Vec<&str> = name.split_whitespace().collect();
    if let Some(last) = parts.last() {
        if is_name_suffix(last.trim_start_matches(',')) {
            return parts[..parts.len().saturating_sub(1)].join(" ");
        }
    }
    name.to_string()
}

pub struct AddPersonArgs<'a> {
    pub full_name: &'a str,
    pub preferred_name: Option<&'a str>,
    pub emails: Vec<&'a str>,
    pub phones: Vec<&'a str>,
    pub headline: Option<&'a str>,
    pub location: Option<&'a str>,
    pub summary: Option<&'a str>,
    pub notes: Option<&'a str>,
    pub reconnect_interval_days: Option<i64>,
    pub source_slug: Option<&'a str>,
    pub external_kind: &'a str,
    pub external_id: Option<&'a str>,
    pub original_url: Option<&'a str>,
    pub allow_duplicate: bool,
}

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

fn enrich_duplicate_person(
    conn: &Connection,
    id: &str,
    args: &AddPersonArgs,
    emails: &[String],
    phones: &[String],
) -> Result<bool, CliError> {
    let preferred_name = normalize_optional(args.preferred_name);
    let primary_email = emails.first().cloned();
    let primary_phone = phones.first().cloned();
    let headline = normalize_optional(args.headline);
    let location = normalize_optional(args.location);
    let summary = normalize_optional(args.summary);
    let notes = normalize_optional(args.notes);
    let reconnect_interval_days = args.reconnect_interval_days;

    let current = conn.query_row(
        "SELECT preferred_name, primary_email, primary_phone, headline, location,
                summary, notes, reconnect_interval_days
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
                row.get::<_, Option<i64>>(7)?,
            ))
        },
    )?;

    let changed = (has_text(&preferred_name) && is_blank(&current.0))
        || (has_text(&primary_email) && is_blank(&current.1))
        || (has_text(&primary_phone) && is_blank(&current.2))
        || (has_text(&headline) && is_blank(&current.3))
        || (has_text(&location) && is_blank(&current.4))
        || (has_text(&summary) && is_blank(&current.5))
        || (has_text(&notes) && is_blank(&current.6))
        || (reconnect_interval_days.is_some() && current.7.is_none());

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
             reconnect_interval_days = CASE
               WHEN reconnect_interval_days IS NULL AND ?8 IS NOT NULL
               THEN ?8 ELSE reconnect_interval_days END,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?9",
        params![
            preferred_name,
            primary_email,
            primary_phone,
            headline,
            location,
            summary,
            notes,
            reconnect_interval_days,
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
    for (index, email) in emails.iter().enumerate() {
        conn.execute(
            "INSERT OR IGNORE INTO person_emails
             (id, person_id, email, normalized_email, is_primary, source_id)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                new_id(),
                person_id,
                email,
                email,
                if index == 0 { 1 } else { 0 },
                source_id,
            ],
        )?;
    }
    for (index, phone) in phones.iter().enumerate() {
        conn.execute(
            "INSERT OR IGNORE INTO person_phones
             (id, person_id, phone, normalized_phone, is_primary, source_id)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                new_id(),
                person_id,
                phone,
                normalize_phone(Some(phone)).unwrap_or_else(|| phone.clone()),
                if index == 0 { 1 } else { 0 },
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
    if let Some(existing) = existing {
        if !args.allow_duplicate {
            insert_person_handles(conn, &existing, &emails, &phones, source_id.as_deref())?;
            enrich_duplicate_person(conn, &existing, &args, &emails, &phones)?;
            insert_external_identity(
                conn,
                "person",
                &existing,
                source_id.as_deref(),
                &kind,
                args.external_id,
                args.original_url,
            )?;
            return report_person(json, &existing, true);
        }
    }

    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO people (
           id, full_name, preferred_name, primary_email, primary_phone, headline,
           location, summary, notes, reconnect_interval_days
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            id,
            full_name,
            normalize_optional(args.preferred_name),
            emails.first(),
            phones.first(),
            normalize_optional(args.headline),
            normalize_optional(args.location),
            normalize_optional(args.summary),
            normalize_optional(args.notes),
            args.reconnect_interval_days,
        ],
    )?;
    insert_person_handles(&tx, &id, &emails, &phones, source_id.as_deref())?;
    insert_external_identity(
        &tx,
        "person",
        &id,
        source_id.as_deref(),
        &kind,
        args.external_id,
        args.original_url,
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
        insert_person_handles(conn, &existing, &emails, &[], source_id.as_deref())?;
        enrich_duplicate_person_email(conn, &existing, &assessment.email)?;
        insert_external_identity(
            conn,
            "person",
            &existing,
            source_id.as_deref(),
            "contact",
            args.external_id,
            None,
        )?;
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
        "person",
        &id,
        source_id.as_deref(),
        "contact",
        args.external_id,
        None,
    )?;
    tx.commit()?;
    report_person_assessment(json, Some(&id), true, false, &assessment)
}

pub struct AddAssetArgs<'a> {
    pub file: &'a Path,
    pub kind: &'a str,
    pub mime_type: Option<&'a str>,
    pub original_filename: Option<&'a str>,
    pub original_url: Option<&'a str>,
    pub role: &'a str,
    pub caption: Option<&'a str>,
    pub links: Vec<LinkRef>,
    pub allow_duplicate: bool,
}

struct DuplicateAsset {
    id: String,
    storage_path: String,
}

fn find_duplicate_asset(conn: &Connection, hash: &str) -> Result<Option<DuplicateAsset>, CliError> {
    let asset = conn
        .query_row(
            "SELECT id, storage_path FROM assets WHERE content_hash = ?1 AND archived_at IS NULL LIMIT 1",
            params![hash],
            |row| {
                Ok(DuplicateAsset {
                    id: row.get(0)?,
                    storage_path: row.get(1)?,
                })
            },
        )
        .ok();
    Ok(asset)
}

fn storage_path_exists(conn: &Connection, storage_path: &str) -> Result<bool, CliError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM assets WHERE storage_path = ?1",
        params![storage_path],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn asset_destination(
    assets_path: &Path,
    storage_path: &str,
) -> Result<std::path::PathBuf, CliError> {
    let relative = storage_path.strip_prefix("assets/").ok_or_else(|| {
        CliError::Runtime(format!(
            "invalid asset storage path '{storage_path}' (expected assets/...)"
        ))
    })?;
    Ok(assets_path.join(relative))
}

fn ensure_asset_file(assets_path: &Path, storage_path: &str, bytes: &[u8]) -> Result<(), CliError> {
    let destination = asset_destination(assets_path, storage_path)?;
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            CliError::Runtime(format!("could not create {}: {e}", parent.display()))
        })?;
    }
    let needs_write = match std::fs::read(&destination) {
        Ok(existing) => existing != bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => true,
        Err(e) => {
            return Err(CliError::Runtime(format!(
                "could not read {}: {e}",
                destination.display()
            )));
        }
    };
    if needs_write {
        std::fs::write(&destination, bytes).map_err(|e| {
            CliError::Runtime(format!("could not write {}: {e}", destination.display()))
        })?;
    }
    Ok(())
}

fn record_type(link: &LinkRef) -> &'static str {
    match link.kind {
        LinkKind::Person => "person",
        LinkKind::Organization => "organization",
        LinkKind::Project => "project",
        LinkKind::Task => "task",
        LinkKind::Document => "document",
        LinkKind::Interaction => "interaction",
    }
}

fn insert_asset_links(
    conn: &Connection,
    asset_id: &str,
    links: &[LinkRef],
    role: &str,
    caption: Option<&str>,
) -> Result<usize, CliError> {
    let mut inserted = 0;
    for link in links {
        let changed = conn.execute(
            "INSERT OR IGNORE INTO asset_links
             (id, asset_id, record_type, record_id, role, caption)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                new_id(),
                asset_id,
                record_type(link),
                link.id,
                normalize_optional(Some(role)),
                normalize_optional(caption),
            ],
        )?;
        inserted += changed;
    }
    Ok(inserted)
}

pub fn add_asset(
    conn: &mut Connection,
    assets_path: Option<&Path>,
    json: bool,
    args: AddAssetArgs,
) -> Result<(), CliError> {
    let Some(assets_path) = assets_path else {
        return Err(CliError::Runtime(
            "asset import requires a brain root; pass --brain <dir> or set BRAIN_ROOT".into(),
        ));
    };
    let bytes = std::fs::read(args.file)
        .map_err(|e| CliError::Runtime(format!("could not read {}: {e}", args.file.display())))?;
    let hash = hash_bytes(&bytes);
    if let Some(existing) = find_duplicate_asset(conn, &hash)? {
        if !args.allow_duplicate {
            ensure_asset_file(assets_path, &existing.storage_path, &bytes)?;
            let tx = conn.transaction()?;
            let linked =
                insert_asset_links(&tx, &existing.id, &args.links, args.role, args.caption)?;
            tx.commit()?;
            return report_asset(json, &existing.id, true, linked);
        }
    }

    let id = new_id();
    let original_filename = normalize_optional(args.original_filename).or_else(|| {
        args.file
            .file_name()
            .and_then(|name| name.to_str())
            .map(ToOwned::to_owned)
    });
    let filename = safe_filename(original_filename.as_deref().unwrap_or("asset"));
    let prefix = hash.get(0..2).unwrap_or("00");
    let default_storage_path = format!("assets/objects/{prefix}/{hash}-{filename}");
    let needs_unique_name =
        args.allow_duplicate || storage_path_exists(conn, &default_storage_path)?;
    let stored_name = if needs_unique_name {
        format!("{hash}-{id}-{filename}")
    } else {
        format!("{hash}-{filename}")
    };
    let relative_path = format!("assets/objects/{prefix}/{stored_name}");

    let original_path = args
        .file
        .canonicalize()
        .ok()
        .map(|path| path.display().to_string());
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO assets (
           id, kind, mime_type, byte_size, content_hash, storage_path,
           original_filename, original_path, original_url
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            id,
            args.kind,
            normalize_optional(args.mime_type),
            bytes.len() as i64,
            hash,
            relative_path,
            original_filename,
            original_path,
            normalize_optional(args.original_url),
        ],
    )?;
    let linked = insert_asset_links(&tx, &id, &args.links, args.role, args.caption)?;
    tx.commit()?;
    if let Err(err) = ensure_asset_file(assets_path, &relative_path, &bytes) {
        if let Err(cleanup_err) = conn.execute("DELETE FROM assets WHERE id = ?1", params![&id]) {
            return Err(CliError::Runtime(format!(
                "{err}; additionally could not remove asset manifest {id}: {cleanup_err}"
            )));
        }
        return Err(err);
    }
    report_asset(json, &id, false, linked)
}

pub struct AddDocumentArgs<'a> {
    pub title: Option<&'a str>,
    pub kind: Option<&'a str>,
    pub body: String,
    pub links: Vec<LinkRef>,
    pub allow_duplicate: bool,
}

pub fn add_document(
    conn: &mut Connection,
    json: bool,
    args: AddDocumentArgs,
) -> Result<(), CliError> {
    let body = normalize_text(&args.body);
    let hash = content_hash(&body);
    if let Some(existing) = find_duplicate(conn, "documents", &hash)? {
        if !args.allow_duplicate {
            return report_record(json, "document", &existing, true, 0);
        }
    }
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO documents (id, title, kind, body_text, content_hash) VALUES (?1,?2,?3,?4,?5)",
        params![id, args.title, args.kind, body, hash],
    )?;
    let count = insert_chunks(&tx, "document", &id, &body)?;
    insert_links(&tx, "document", &id, &args.links)?;
    tx.commit()?;
    report_record(json, "document", &id, false, count)
}

pub struct AddInteractionArgs<'a> {
    pub title: Option<&'a str>,
    pub kind: &'a str,
    pub occurred_at: Option<&'a str>,
    pub source_slug: Option<&'a str>,
    pub external_id: Option<&'a str>,
    pub original_url: Option<&'a str>,
    pub body: String,
    pub links: Vec<LinkRef>,
    pub raw_participants: Vec<&'a str>,
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
             updated_at = CASE
               WHEN ((external_id IS NULL OR trim(external_id) = '') AND ?1 IS NOT NULL)
                 OR ((original_url IS NULL OR trim(original_url) = '') AND ?2 IS NOT NULL)
               THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE updated_at END
         WHERE id = ?3",
        params![
            normalize_optional(args.external_id),
            normalize_optional(args.original_url),
            id,
        ],
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

pub fn add_interaction(
    conn: &mut Connection,
    json: bool,
    args: AddInteractionArgs,
) -> Result<(), CliError> {
    let body = normalize_text(&args.body);
    let hash = content_hash(&body);
    let source_id = source_id(conn, args.source_slug)?;
    if let Some(existing) = find_external_identity(
        conn,
        "interaction",
        source_id.as_deref(),
        "record",
        args.external_id,
    )? {
        if !args.allow_duplicate {
            let tx = conn.transaction()?;
            enrich_duplicate_interaction(&tx, &existing, &args)?;
            insert_links(&tx, "interaction", &existing, &args.links)?;
            insert_raw_participants(&tx, &existing, source_id.as_deref(), &args.raw_participants)?;
            insert_external_identity(
                &tx,
                "interaction",
                &existing,
                source_id.as_deref(),
                "record",
                args.external_id,
                args.original_url,
            )?;
            tx.commit()?;
            return report_record(json, "interaction", &existing, true, 0);
        }
    }
    if let Some(existing) =
        find_duplicate_interaction(conn, &hash, args.external_id, source_id.as_deref())?
    {
        if !args.allow_duplicate {
            let tx = conn.transaction()?;
            enrich_duplicate_interaction(&tx, &existing, &args)?;
            insert_links(&tx, "interaction", &existing, &args.links)?;
            insert_raw_participants(&tx, &existing, source_id.as_deref(), &args.raw_participants)?;
            insert_external_identity(
                &tx,
                "interaction",
                &existing,
                source_id.as_deref(),
                "record",
                args.external_id,
                args.original_url,
            )?;
            tx.commit()?;
            return report_record(json, "interaction", &existing, true, 0);
        }
    }
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO interactions
         (id, kind, title, body_text, occurred_at, external_id, original_url, content_hash)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            id,
            args.kind,
            args.title,
            body,
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
        "interaction",
        &id,
        source_id.as_deref(),
        "record",
        args.external_id,
        args.original_url,
    )?;
    tx.commit()?;
    report_record(json, "interaction", &id, false, count)
}

pub struct AddTaskArgs<'a> {
    pub title: &'a str,
    pub status: &'a str,
    pub due_at: Option<&'a str>,
    pub project_id: Option<String>,
    pub links: Vec<LinkRef>,
}

pub fn add_task(conn: &mut Connection, json: bool, args: AddTaskArgs) -> Result<(), CliError> {
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO tasks (id, title, status, due_at, project_id) VALUES (?1,?2,?3,?4,?5)",
        params![id, args.title, args.status, args.due_at, args.project_id],
    )?;
    // Person/organization links go through task join tables; project via column above.
    for link in &args.links {
        match link.kind {
            LinkKind::Person => {
                tx.execute(
                    "INSERT INTO task_people (id, task_id, person_id) VALUES (?1,?2,?3)",
                    params![new_id(), id, link.id],
                )?;
            }
            LinkKind::Organization => {
                tx.execute(
                    "INSERT INTO task_organizations (id, task_id, organization_id) VALUES (?1,?2,?3)",
                    params![new_id(), id, link.id],
                )?;
            }
            LinkKind::Project => {
                tx.execute(
                    "UPDATE tasks SET project_id = ?1 WHERE id = ?2",
                    params![link.id, id],
                )?;
            }
            LinkKind::Task => {
                return Err(CliError::Runtime(
                    "a task cannot link to another task".into(),
                ));
            }
            LinkKind::Document | LinkKind::Interaction => {
                return Err(CliError::Runtime(
                    "a task can only link to people, organizations, or projects".into(),
                ));
            }
        }
    }
    tx.commit()?;
    if json {
        print_json(&json!({ "kind": "task", "id": id }))
    } else {
        println!("task {id}");
        Ok(())
    }
}

pub struct RememberArgs<'a> {
    pub kind: &'a str,
    pub claim: &'a str,
    pub links: Vec<LinkRef>,
}

/// `brain remember` — add a hidden memory (atomic claim) with direct provenance
/// links to the records it is about.
pub fn remember(conn: &mut Connection, json: bool, args: RememberArgs) -> Result<(), CliError> {
    let id = new_id();
    let created = now_iso(conn)?;
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO memories (id, kind, claim, valid_from) VALUES (?1,?2,?3,?4)",
        params![id, args.kind, args.claim, created],
    )?;
    for link in &args.links {
        let record_type = match link.kind {
            LinkKind::Person => "person",
            LinkKind::Organization => "organization",
            LinkKind::Project => "project",
            LinkKind::Task => "task",
            LinkKind::Document => "document",
            LinkKind::Interaction => "interaction",
        };
        tx.execute(
            "INSERT INTO memory_links (id, memory_id, record_type, record_id) VALUES (?1,?2,?3,?4)",
            params![new_id(), id, record_type, link.id],
        )?;
    }
    tx.commit()?;
    if json {
        print_json(&json!({ "kind": "memory", "id": id, "links": args.links.len() }))
    } else {
        println!("memory {id}");
        Ok(())
    }
}

fn report_record(
    json: bool,
    kind: &str,
    id: &str,
    duplicate: bool,
    chunk_count: usize,
) -> Result<(), CliError> {
    if json {
        print_json(&json!({
            "kind": kind,
            "id": id,
            "isDuplicate": duplicate,
            "chunkCount": chunk_count,
        }))
    } else {
        if duplicate {
            println!("{kind} {id} (duplicate, skipped)");
        } else {
            println!("{kind} {id} ({chunk_count} chunks)");
        }
        Ok(())
    }
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

fn report_asset(json: bool, id: &str, duplicate: bool, linked: usize) -> Result<(), CliError> {
    if json {
        print_json(&json!({
            "kind": "asset",
            "id": id,
            "isDuplicate": duplicate,
            "linkCount": linked,
        }))
    } else {
        if duplicate {
            println!("asset {id} (duplicate, linked {linked})");
        } else {
            println!("asset {id} (linked {linked})");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comma_inverts_plausible_person_names() {
        // Classic directory "Last, First" forms become "First Last".
        assert_eq!(normalize_untrusted_name("Smith, John").0, "John Smith");
        assert_eq!(normalize_untrusted_name("Doe, Jane A.").0, "Jane A. Doe");
        assert_eq!(
            normalize_untrusted_name("van der Berg, Maria").0,
            "Maria van der Berg"
        );
    }

    #[test]
    fn comma_keeps_org_labels_intact() {
        // Org/department labels must NOT be reversed into fake people.
        assert_eq!(normalize_untrusted_name("Acme, Sales").0, "Acme, Sales");
        assert_eq!(
            normalize_untrusted_name("Amazon, Customer Service").0,
            "Amazon, Customer Service"
        );
    }

    #[test]
    fn org_comma_labels_are_not_person_names() {
        // The downstream guardrail rejects the un-inverted comma strings, so no
        // person is minted for them.
        assert!(!looks_like_capitalized_person_name("Acme, Sales"));
        assert!(!looks_like_capitalized_person_name(
            "Amazon, Customer Service"
        ));
        // A real inverted person name still passes.
        assert!(looks_like_capitalized_person_name("John Smith"));
    }

    #[test]
    fn assess_skips_org_comma_labels() {
        let acme = assess_person_import("Acme, Sales", "person@example.com");
        assert!(!acme.should_create_person);
        assert!(acme.reason_codes.contains(&"not_capitalized_first_last"));

        let amazon = assess_person_import("Amazon, Customer Service", "buyer@example.com");
        assert!(!amazon.should_create_person);
        assert!(amazon.reason_codes.contains(&"not_capitalized_first_last"));
    }

    #[test]
    fn assess_creates_plausible_inverted_person() {
        let person = assess_person_import("Smith, John", "john@example.com");
        assert_eq!(person.normalized_name, "John Smith");
        assert!(person.should_create_person, "{:?}", person.reason_codes);
    }

    #[test]
    fn route_phrase_strips_to_usable_person_name() {
        // A routing marker is stripped, leaving a clean person name.
        let (name, had_route) = normalize_untrusted_name("Robin Spencer via LinkedIn");
        assert_eq!(name, "Robin Spencer");
        assert!(had_route);
    }

    #[test]
    fn assess_creates_person_after_stripping_route_phrase() {
        // Legitimate senders whose display name carries a routing marker must
        // still create a person once the marker is removed.
        for raw in [
            "Robin Spencer via LinkedIn",
            "Robin Spencer from Acme",
            "Robin Spencer at LinkedIn",
        ] {
            let person = assess_person_import(raw, "robin@example.com");
            assert_eq!(person.normalized_name, "Robin Spencer", "{raw}");
            assert!(
                person.should_create_person,
                "{raw} reason_codes: {:?}",
                person.reason_codes
            );
            assert!(
                !person.reason_codes.contains(&"route_phrase"),
                "{raw} should not be flagged route_phrase: {:?}",
                person.reason_codes
            );
        }
    }

    #[test]
    fn assess_skips_route_phrase_noise() {
        // When stripping the routing marker leaves something that is not a
        // capitalized person name, the import is still skipped and flagged.
        let noise = assess_person_import("noreply via Mailchimp", "sender@example.com");
        assert!(!noise.should_create_person);
        assert!(
            noise.reason_codes.contains(&"route_phrase"),
            "{:?}",
            noise.reason_codes
        );
    }

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
}
