//! `brain add project` — create or reuse a manually curated durable project.
//! Imports can link recurring Gmail threads, Granola meetings, tasks, people, and
//! documents to an existing project, but they should not create project rows from
//! inferred source topics.

use rusqlite::{params, Connection};
use serde_json::json;

use super::identity::{
    external_kind, find_external_identity, insert_external_identity, source_id,
    ExternalIdentityWrite,
};
use super::text::{normalize_optional, normalize_title};
use crate::commands::{LinkKind, LinkRef};
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;

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
    let name = normalize_title(Some(name));
    let Some(name) = name else {
        return Ok(None);
    };
    let mut stmt = conn.prepare(
        "SELECT id, name FROM projects
         WHERE archived_at IS NULL
         ORDER BY created_at ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (id, candidate) = row?;
        if normalize_title(Some(&candidate)).as_deref() == Some(name.as_str()) {
            return Ok(Some(id));
        }
    }
    Ok(None)
}

fn enrich_duplicate_project(
    conn: &Connection,
    id: &str,
    args: &AddProjectArgs,
) -> Result<(), CliError> {
    conn.execute(
        "UPDATE projects
         SET kind = CASE
               WHEN (kind IS NULL OR trim(kind) = '') AND ?1 IS NOT NULL
               THEN ?1 ELSE kind END,
             summary = CASE
               WHEN (summary IS NULL OR trim(summary) = '') AND ?2 IS NOT NULL
               THEN ?2 ELSE summary END,
             notes = CASE
               WHEN (notes IS NULL OR trim(notes) = '') AND ?3 IS NOT NULL
               THEN ?3 ELSE notes END,
             started_on = CASE
               WHEN (started_on IS NULL OR trim(started_on) = '') AND ?4 IS NOT NULL
               THEN ?4 ELSE started_on END,
             target_date = CASE
               WHEN (target_date IS NULL OR trim(target_date) = '') AND ?5 IS NOT NULL
               THEN ?5 ELSE target_date END,
             updated_at = CASE
               WHEN ((kind IS NULL OR trim(kind) = '') AND ?1 IS NOT NULL)
                 OR ((summary IS NULL OR trim(summary) = '') AND ?2 IS NOT NULL)
                 OR ((notes IS NULL OR trim(notes) = '') AND ?3 IS NOT NULL)
                 OR ((started_on IS NULL OR trim(started_on) = '') AND ?4 IS NOT NULL)
                 OR ((target_date IS NULL OR trim(target_date) = '') AND ?5 IS NOT NULL)
               THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE updated_at END
         WHERE id = ?6",
        params![
            normalize_optional(args.kind),
            normalize_optional(args.summary),
            normalize_optional(args.notes),
            normalize_optional(args.started_on),
            normalize_optional(args.target_date),
            id,
        ],
    )?;
    Ok(())
}

fn insert_project_links(
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
            LinkKind::Task => ("project_tasks", "task_id", "task"),
            LinkKind::Project => {
                return Err(CliError::Runtime(
                    "project records cannot link to another project yet".into(),
                ));
            }
        };
        let sql = format!(
            "INSERT OR IGNORE INTO {table} (id, project_id, {other_col}) VALUES (?1,?2,?3)"
        );
        conn.execute(&sql, params![new_id(), project_id, link.id])
            .map_err(|e| CliError::Runtime(format!("could not link {other}: {e}")))?;
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
    if json {
        print_json(&json!({
            "kind": "project",
            "id": id,
            "isDuplicate": duplicate,
        }))
    } else {
        if duplicate {
            println!("project {id} (duplicate, enriched)");
        } else {
            println!("project {id}");
        }
        Ok(())
    }
}
