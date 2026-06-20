//! `brain add organization` — create or reuse a durable organization. Imports
//! attach people to an employer by name or email domain; dedupe resolves an
//! existing org by external identity, then normalized name, then normalized
//! domain, and enriches blank fields rather than forking a second row.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;

use super::identity::{
    external_kind, find_external_identity, insert_external_identity, source_id,
    ExternalIdentityWrite,
};
use super::text::{normalize_name, normalize_optional, normalize_title};
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;

pub struct AddOrganizationArgs<'a> {
    pub name: &'a str,
    pub kind: Option<&'a str>,
    pub domain: Option<&'a str>,
    pub location: Option<&'a str>,
    pub summary: Option<&'a str>,
    pub notes: Option<&'a str>,
    pub source_slug: Option<&'a str>,
    pub external_kind: &'a str,
    pub external_id: Option<&'a str>,
    pub original_url: Option<&'a str>,
    pub allow_duplicate: bool,
}

/// Normalize an org domain for comparison and storage: lowercase, trim, and strip
/// a leading `www.`. Returns `None` for blank.
pub(super) fn normalize_domain(raw: Option<&str>) -> Option<String> {
    normalize_optional(raw).map(|value| {
        let lower = value.to_lowercase();
        lower
            .strip_prefix("www.")
            .map(ToOwned::to_owned)
            .unwrap_or(lower)
    })
}

/// Resolve an existing active organization by normalized name, then by normalized
/// domain. Name matching mirrors people/projects (diacritic- and punctuation-
/// folded); domain is a cheaper exact match on the stored value.
fn find_duplicate_organization(
    conn: &Connection,
    name: &str,
    domain: Option<&str>,
) -> Result<Option<String>, CliError> {
    let target = normalize_name(name);
    if !target.is_empty() {
        let mut stmt = conn.prepare(
            "SELECT id, name FROM organizations
             WHERE archived_at IS NULL
             ORDER BY created_at ASC, id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (id, candidate) = row?;
            if normalize_name(&candidate) == target {
                return Ok(Some(id));
            }
        }
    }
    if let Some(domain) = normalize_domain(domain) {
        let id = conn
            .query_row(
                "SELECT id FROM organizations
                 WHERE archived_at IS NULL
                   AND domain IS NOT NULL
                   AND lower(domain) = ?1
                 ORDER BY created_at ASC, id ASC
                 LIMIT 1",
                params![domain],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if id.is_some() {
            return Ok(id);
        }
    }
    Ok(None)
}

fn enrich_duplicate_organization(
    conn: &Connection,
    id: &str,
    args: &AddOrganizationArgs,
) -> Result<(), CliError> {
    conn.execute(
        "UPDATE organizations
         SET kind = CASE
               WHEN (kind IS NULL OR trim(kind) = '') AND ?1 IS NOT NULL THEN ?1 ELSE kind END,
             domain = CASE
               WHEN (domain IS NULL OR trim(domain) = '') AND ?2 IS NOT NULL THEN ?2 ELSE domain END,
             location = CASE
               WHEN (location IS NULL OR trim(location) = '') AND ?3 IS NOT NULL THEN ?3 ELSE location END,
             summary = CASE
               WHEN (summary IS NULL OR trim(summary) = '') AND ?4 IS NOT NULL THEN ?4 ELSE summary END,
             notes = CASE
               WHEN (notes IS NULL OR trim(notes) = '') AND ?5 IS NOT NULL THEN ?5 ELSE notes END,
             updated_at = CASE
               WHEN ((kind IS NULL OR trim(kind) = '') AND ?1 IS NOT NULL)
                 OR ((domain IS NULL OR trim(domain) = '') AND ?2 IS NOT NULL)
                 OR ((location IS NULL OR trim(location) = '') AND ?3 IS NOT NULL)
                 OR ((summary IS NULL OR trim(summary) = '') AND ?4 IS NOT NULL)
                 OR ((notes IS NULL OR trim(notes) = '') AND ?5 IS NOT NULL)
               THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE updated_at END
         WHERE id = ?6",
        params![
            normalize_optional(args.kind),
            normalize_domain(args.domain),
            normalize_optional(args.location),
            normalize_optional(args.summary),
            normalize_optional(args.notes),
            id,
        ],
    )?;
    Ok(())
}

/// Find-or-create an organization by name (then domain), filling a blank domain
/// when one is supplied. Shared by the person affiliation path so importing an
/// employer never forks a second org row.
pub(super) fn find_or_create_organization(
    conn: &Connection,
    name: &str,
    domain: Option<&str>,
) -> Result<String, CliError> {
    let name = normalize_title(Some(name))
        .ok_or_else(|| CliError::Runtime("an organization needs a name".into()))?;
    if let Some(existing) = find_duplicate_organization(conn, &name, domain)? {
        if let Some(domain) = normalize_domain(domain) {
            conn.execute(
                "UPDATE organizations
                 SET domain = CASE WHEN (domain IS NULL OR trim(domain) = '') THEN ?1 ELSE domain END,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ?2",
                params![domain, existing],
            )?;
        }
        return Ok(existing);
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO organizations (id, name, domain) VALUES (?1,?2,?3)",
        params![id, name, normalize_domain(domain)],
    )?;
    Ok(id)
}

pub fn add_organization(
    conn: &mut Connection,
    json: bool,
    args: AddOrganizationArgs,
) -> Result<(), CliError> {
    let name = normalize_title(Some(args.name))
        .ok_or_else(|| CliError::Runtime("an organization needs a name".into()))?;
    let source_id = source_id(conn, args.source_slug)?;
    let identity_kind = external_kind(args.external_kind);

    let existing_by_external = find_external_identity(
        conn,
        "organization",
        source_id.as_deref(),
        &identity_kind,
        args.external_id,
    )?;
    let existing =
        existing_by_external
            .clone()
            .or(find_duplicate_organization(conn, &name, args.domain)?);

    if let Some(existing) = existing.as_deref() {
        if !args.allow_duplicate {
            let tx = conn.transaction()?;
            enrich_duplicate_organization(&tx, existing, &args)?;
            insert_external_identity(
                &tx,
                ExternalIdentityWrite {
                    entity_type: "organization",
                    entity_id: existing,
                    source_id: source_id.as_deref(),
                    kind: &identity_kind,
                    external_id: args.external_id,
                    url: args.original_url,
                    force_duplicate: false,
                },
            )?;
            tx.commit()?;
            return report_organization(json, existing, true);
        }
    }

    let force_duplicate = existing.is_some();
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO organizations (id, name, kind, domain, location, summary, notes)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            id,
            name,
            normalize_optional(args.kind),
            normalize_domain(args.domain),
            normalize_optional(args.location),
            normalize_optional(args.summary),
            normalize_optional(args.notes),
        ],
    )?;
    insert_external_identity(
        &tx,
        ExternalIdentityWrite {
            entity_type: "organization",
            entity_id: &id,
            source_id: source_id.as_deref(),
            kind: &identity_kind,
            external_id: args.external_id,
            url: args.original_url,
            force_duplicate,
        },
    )?;
    tx.commit()?;
    report_organization(json, &id, false)
}

fn report_organization(json: bool, id: &str, duplicate: bool) -> Result<(), CliError> {
    if json {
        print_json(&json!({
            "kind": "organization",
            "id": id,
            "isDuplicate": duplicate,
        }))
    } else {
        if duplicate {
            println!("organization {id} (duplicate, enriched)");
        } else {
            println!("organization {id}");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn org_args<'a>(name: &'a str, domain: Option<&'a str>) -> AddOrganizationArgs<'a> {
        AddOrganizationArgs {
            name,
            kind: None,
            domain,
            location: None,
            summary: None,
            notes: None,
            source_slug: Some("manual"),
            external_kind: "record",
            external_id: None,
            original_url: None,
            allow_duplicate: false,
        }
    }

    #[test]
    fn add_organization_dedupes_by_name_then_domain() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        add_organization(
            &mut conn,
            true,
            org_args("Evensen Design", Some("evensendesign.com")),
        )
        .unwrap();
        // Same name (different casing/spacing) must dedupe, not fork.
        add_organization(&mut conn, true, org_args("  evensen   design ", None)).unwrap();
        // Same domain under a different display name must also dedupe.
        add_organization(
            &mut conn,
            true,
            org_args("Evensen Design Studio", Some("www.evensendesign.com")),
        )
        .unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM organizations WHERE archived_at IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "name and domain dedupe must reuse one org");
    }

    #[test]
    fn find_or_create_fills_blank_domain() {
        let conn = brain_schema::open_in_memory().unwrap();
        let id = find_or_create_organization(&conn, "Evensen Design", None).unwrap();
        let again = find_or_create_organization(&conn, "Evensen Design", Some("evensendesign.com"))
            .unwrap();
        assert_eq!(id, again, "second call reuses the org");
        let domain: Option<String> = conn
            .query_row(
                "SELECT domain FROM organizations WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(domain.as_deref(), Some("evensendesign.com"));
    }
}
