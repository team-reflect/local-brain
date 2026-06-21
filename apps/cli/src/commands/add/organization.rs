//! `brain add organization` — create or reuse a durable organization. Imports
//! attach people to an employer by name or email domain; dedupe resolves an
//! existing org by external identity, then normalized name, then normalized
//! domain, and enriches blank fields rather than forking a second row.

use rusqlite::{params, Connection, OptionalExtension};

use super::identity::{
    external_kind, find_external_identity, insert_external_identity, source_id,
    ExternalIdentityWrite,
};
use super::text::{normalize_domain, normalize_name, normalize_optional, normalize_title};
use crate::commands::{LinkKind, LinkRef};
use crate::error::CliError;
use crate::id::new_id;

/// Relink a suggestion's cited records to an organization on accept. Interactions,
/// documents, and projects link via their typed join tables (provenance for why
/// the org was proposed). Person links are intentionally skipped — making a cited
/// person an employee is a stronger claim that belongs to `brain affiliate` /
/// `add person --org`, not to ratifying an org proposal.
pub(super) fn insert_organization_links(
    conn: &Connection,
    organization_id: &str,
    links: &[LinkRef],
) -> Result<(), CliError> {
    for link in links {
        let (table, other_col) = match link.kind {
            LinkKind::Interaction => ("interaction_organizations", "interaction_id"),
            LinkKind::Document => ("document_organizations", "document_id"),
            LinkKind::Project => ("project_organizations", "project_id"),
            LinkKind::Person | LinkKind::Organization | LinkKind::Task => continue,
        };
        super::links::insert_join_row(
            conn,
            table,
            "organization_id",
            organization_id,
            other_col,
            &link.id,
            "organization evidence",
        )?;
    }
    Ok(())
}

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

/// Resolve an existing active organization by normalized name, then by normalized
/// domain. Name matching mirrors people/projects (diacritic- and punctuation-
/// folded); domain is a cheaper exact match on the stored value.
fn find_duplicate_organization(
    conn: &Connection,
    name: &str,
    domain: Option<&str>,
) -> Result<Option<String>, CliError> {
    if let Some(id) =
        super::find_by_normalized_name(conn, "organizations", "name", name, normalize_name)?
    {
        return Ok(Some(id));
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
    super::fill_blanks(
        conn,
        "organizations",
        id,
        &[
            ("kind", normalize_optional(args.kind)),
            ("domain", normalize_domain(args.domain)),
            ("location", normalize_optional(args.location)),
            ("summary", normalize_optional(args.summary)),
            ("notes", normalize_optional(args.notes)),
        ],
    )
}

/// Find-or-create an organization by name (then domain), filling a blank domain
/// and kind when supplied. Shared by the person affiliation path and
/// `suggestion accept` so importing/ratifying an employer never forks a second
/// org row and carries the proposed kind through.
pub(super) fn find_or_create_organization(
    conn: &Connection,
    name: &str,
    domain: Option<&str>,
    kind: Option<&str>,
) -> Result<String, CliError> {
    let name = normalize_title(Some(name))
        .ok_or_else(|| CliError::Runtime("an organization needs a name".into()))?;
    if let Some(existing) = find_duplicate_organization(conn, &name, domain)? {
        super::fill_blanks(
            conn,
            "organizations",
            &existing,
            &[
                ("domain", normalize_domain(domain)),
                ("kind", normalize_optional(kind)),
            ],
        )?;
        return Ok(existing);
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO organizations (id, name, domain, kind) VALUES (?1,?2,?3,?4)",
        params![id, name, normalize_domain(domain), normalize_optional(kind)],
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
    super::report_entity(json, "organization", id, duplicate, "duplicate, enriched")
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
    fn normalize_domain_strips_scheme_www_and_path() {
        // Parity with core normalizeDomain (packages/core/src/text/normalize.ts).
        assert_eq!(
            normalize_domain(Some("https://www.Acme.com/team")).as_deref(),
            Some("acme.com")
        );
        assert_eq!(
            normalize_domain(Some("http://Evensen.Design/")).as_deref(),
            Some("evensen.design")
        );
        assert_eq!(
            normalize_domain(Some("  WWW.acme.com  ")).as_deref(),
            Some("acme.com")
        );
        assert_eq!(normalize_domain(Some("   ")), None);
        assert_eq!(normalize_domain(None), None);
    }

    #[test]
    fn find_or_create_fills_blank_domain_and_kind() {
        let conn = brain_schema::open_in_memory().unwrap();
        let id = find_or_create_organization(&conn, "Evensen Design", None, None).unwrap();
        let again = find_or_create_organization(
            &conn,
            "Evensen Design",
            Some("evensendesign.com"),
            Some("studio"),
        )
        .unwrap();
        assert_eq!(id, again, "second call reuses the org");
        let (domain, kind): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT domain, kind FROM organizations WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(domain.as_deref(), Some("evensendesign.com"));
        assert_eq!(kind.as_deref(), Some("studio"), "blank kind is filled");
    }
}
