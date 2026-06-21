//! `brain add project` — create or reuse a manually curated durable project.
//! Imports can link recurring Gmail threads, Granola meetings, tasks, people, and
//! documents to an existing project, but they should not create project rows from
//! inferred source topics.

use rusqlite::{params, Connection};

use super::identity::{
    external_kind, find_external_identity, insert_external_identity, source_id,
    ExternalIdentityWrite,
};
use super::text::{normalize_optional, normalize_title, squish};
use crate::commands::{LinkKind, LinkRef};
use crate::error::CliError;
use crate::id::new_id;

pub struct AddProjectArgs<'a> {
    pub name: &'a str,
    pub status: &'a str,
    pub kind: Option<&'a str>,
    pub summary: Option<&'a str>,
    pub notes: Option<&'a str>,
    pub started_on: Option<&'a str>,
    pub target_date: Option<&'a str>,
    pub source_slug: Option<&'a str>,
    pub external_kind: &'a str,
    pub external_id: Option<&'a str>,
    pub original_url: Option<&'a str>,
    pub links: Vec<LinkRef>,
    pub allow_duplicate: bool,
}

fn find_duplicate_project(conn: &Connection, name: &str) -> Result<Option<String>, CliError> {
    // Projects dedupe on the squished (case-preserved) name, matching
    // `normalize_title`; `squish` is its normalizer without the empty→None step,
    // which `find_by_normalized_name` handles itself.
    super::find_by_normalized_name(conn, "projects", "name", name, squish)
}

fn enrich_duplicate_project(
    conn: &Connection,
    id: &str,
    args: &AddProjectArgs,
) -> Result<(), CliError> {
    super::fill_blanks(
        conn,
        "projects",
        id,
        &[
            ("kind", normalize_optional(args.kind)),
            ("summary", normalize_optional(args.summary)),
            ("notes", normalize_optional(args.notes)),
            ("started_on", normalize_optional(args.started_on)),
            ("target_date", normalize_optional(args.target_date)),
        ],
    )
}

pub(super) fn insert_project_links(
    conn: &Connection,
    project_id: &str,
    links: &[LinkRef],
) -> Result<(), CliError> {
    for link in links {
        let (table, other_col, other) = match link.kind {
            LinkKind::Person => ("project_people", "person_id", "person"),
            LinkKind::Organization => ("project_organizations", "organization_id", "organization"),
            LinkKind::Document => ("project_documents", "document_id", "document"),
            LinkKind::Interaction => ("project_interactions", "interaction_id", "interaction"),
            LinkKind::Task => {
                let changed = conn.execute(
                    "UPDATE tasks
                     SET project_id = ?1,
                         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     WHERE id = ?2",
                    params![project_id, link.id],
                )?;
                if changed == 0 {
                    return Err(CliError::Runtime(
                        "could not link task: no matching task".into(),
                    ));
                }
                continue;
            }
            LinkKind::Project => {
                return Err(CliError::Runtime(
                    "project records cannot link to another project yet".into(),
                ));
            }
        };
        super::links::insert_join_row(
            conn,
            table,
            "project_id",
            project_id,
            other_col,
            &link.id,
            other,
        )?;
    }
    Ok(())
}

fn enrich_existing_project(
    tx: &Connection,
    existing: &str,
    args: &AddProjectArgs,
    source_id: Option<&str>,
    identity_kind: &str,
) -> Result<(), CliError> {
    enrich_duplicate_project(tx, existing, args)?;
    insert_project_links(tx, existing, &args.links)?;
    insert_external_identity(
        tx,
        ExternalIdentityWrite {
            entity_type: "project",
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

/// Find-or-create a project by normalized name, filling a blank summary. Used by
/// `suggestion accept` so ratifying a proposed project never forks a second row
/// when the user already created one with the same name.
pub(super) fn find_or_create_project(
    conn: &Connection,
    name: &str,
    summary: Option<&str>,
) -> Result<String, CliError> {
    let name = normalize_title(Some(name))
        .ok_or_else(|| CliError::Runtime("a project needs a name".into()))?;
    if let Some(existing) = find_duplicate_project(conn, &name)? {
        super::fill_blanks(
            conn,
            "projects",
            &existing,
            &[("summary", normalize_optional(summary))],
        )?;
        return Ok(existing);
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO projects (id, name, status, summary) VALUES (?1,?2,'active',?3)",
        params![id, name, normalize_optional(summary)],
    )?;
    Ok(id)
}

pub fn add_project(
    conn: &mut Connection,
    json: bool,
    args: AddProjectArgs,
) -> Result<(), CliError> {
    let name = normalize_title(Some(args.name))
        .ok_or_else(|| CliError::Runtime("a project needs a name".into()))?;
    let status = normalize_optional(Some(args.status)).unwrap_or_else(|| "active".to_string());
    let source_id = source_id(conn, args.source_slug)?;
    let identity_kind = external_kind(args.external_kind);

    let existing_by_external = find_external_identity(
        conn,
        "project",
        source_id.as_deref(),
        &identity_kind,
        args.external_id,
    )?;
    if let Some(existing) = existing_by_external.as_deref() {
        if !args.allow_duplicate {
            let tx = conn.transaction()?;
            enrich_existing_project(&tx, existing, &args, source_id.as_deref(), &identity_kind)?;
            tx.commit()?;
            return report_project(json, existing, true);
        }
    }

    let existing_by_name = find_duplicate_project(conn, &name)?;
    if let Some(existing) = existing_by_name.as_deref() {
        if !args.allow_duplicate {
            let tx = conn.transaction()?;
            enrich_existing_project(&tx, existing, &args, source_id.as_deref(), &identity_kind)?;
            tx.commit()?;
            return report_project(json, existing, true);
        }
    }

    let force_duplicate = existing_by_external.is_some() || existing_by_name.is_some();
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO projects
         (id, name, status, kind, summary, notes, started_on, target_date)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            id,
            name,
            status,
            normalize_optional(args.kind),
            normalize_optional(args.summary),
            normalize_optional(args.notes),
            normalize_optional(args.started_on),
            normalize_optional(args.target_date),
        ],
    )?;
    insert_project_links(&tx, &id, &args.links)?;
    insert_external_identity(
        &tx,
        ExternalIdentityWrite {
            entity_type: "project",
            entity_id: &id,
            source_id: source_id.as_deref(),
            kind: &identity_kind,
            external_id: args.external_id,
            url: args.original_url,
            force_duplicate,
        },
    )?;
    tx.commit()?;
    report_project(json, &id, false)
}

fn report_project(json: bool, id: &str, duplicate: bool) -> Result<(), CliError> {
    super::report_entity(json, "project", id, duplicate, "duplicate, enriched")
}
