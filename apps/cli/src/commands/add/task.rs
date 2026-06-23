//! `brain add task` — create a task and wire its links: people, organizations,
//! documents, and interactions go through typed join tables. A task's project is
//! the direct `tasks.project_id` association because launch tasks belong to at
//! most one project.

use rusqlite::{params, types::Value as SqlValue, Connection, OptionalExtension};
use serde_json::json;

use super::links::insert_evidence_refs;
use super::text::{normalize_optional, normalize_title};
use crate::commands::{now_iso, EvidenceRef, LinkKind, LinkRef};
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;

pub struct AddTaskArgs<'a> {
    pub title: &'a str,
    pub status: &'a str,
    pub due_at: Option<&'a str>,
    pub project_id: Option<String>,
    pub links: Vec<LinkRef>,
    pub evidence: Vec<EvidenceRef>,
    pub assignee_ids: Vec<String>,
}

pub struct UpdateTaskArgs<'a> {
    pub id: &'a str,
    pub title: Option<&'a str>,
    pub description: Option<&'a str>,
    pub status: Option<&'a str>,
    pub due_at: Option<&'a str>,
    pub scheduled_for: Option<&'a str>,
    pub links: Vec<LinkRef>,
    pub evidence: Vec<EvidenceRef>,
}

pub struct CompleteTaskArgs<'a> {
    pub id: &'a str,
    pub evidence: Vec<EvidenceRef>,
}

pub fn add_task(conn: &mut Connection, json: bool, args: AddTaskArgs) -> Result<(), CliError> {
    let project_links = args
        .links
        .iter()
        .filter(|link| matches!(link.kind, LinkKind::Project))
        .count();
    if project_links > 1 {
        return Err(CliError::Runtime(
            "a task can link to only one project".into(),
        ));
    }
    // Collect assignee ids up-front so person links can skip those already
    // handled as assignees (prevents duplicate task_people rows).
    use std::collections::HashSet;
    let assignee_set: HashSet<&str> = args.assignee_ids.iter().map(|s| s.as_str()).collect();
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO tasks (id, title, status, due_at, project_id) VALUES (?1,?2,?3,?4,?5)",
        params![id, args.title, args.status, args.due_at, args.project_id],
    )?;
    for link in &args.links {
        match link.kind {
            LinkKind::Person => {
                // Skip generic link if this person is already being inserted as
                // an assignee; the assignee loop below writes the canonical row.
                if assignee_set.contains(link.id.as_str()) {
                    continue;
                }
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
            LinkKind::Document => {
                tx.execute(
                    "INSERT OR IGNORE INTO task_documents (id, task_id, document_id) VALUES (?1,?2,?3)",
                    params![new_id(), id, link.id],
                )?;
            }
            LinkKind::Interaction => {
                tx.execute(
                    "UPDATE tasks SET origin_interaction_id = COALESCE(origin_interaction_id, ?1) WHERE id = ?2",
                    params![link.id, id],
                )?;
                tx.execute(
                    "INSERT OR IGNORE INTO task_interactions (id, task_id, interaction_id) VALUES (?1,?2,?3)",
                    params![new_id(), id, link.id],
                )?;
            }
        }
    }
    // Iterate the deduplicated set so that repeating --assignee <id> does not
    // attempt a second insert and hit the UNIQUE (task_id, person_id) constraint.
    for assignee_id in &assignee_set {
        tx.execute(
            "INSERT INTO task_people (id, task_id, person_id, role) VALUES (?1,?2,?3,'assignee')",
            params![new_id(), id, assignee_id],
        )?;
    }
    insert_evidence_refs(&tx, "task", &id, &args.evidence)?;
    tx.commit()?;
    if json {
        print_json(&json!({
            "kind": "task",
            "id": id,
            "evidence": args.evidence.len(),
            "assigneeCount": assignee_set.len(),
        }))
    } else {
        println!("task {id}");
        Ok(())
    }
}

fn require_active_task(conn: &Connection, id: &str) -> Result<(), CliError> {
    let exists = conn
        .query_row(
            "SELECT 1 FROM tasks WHERE id = ?1 AND archived_at IS NULL LIMIT 1",
            params![id],
            |_| Ok(()),
        )
        .optional()?;
    exists.ok_or_else(|| CliError::NotFound(format!("no active task {id}")))
}

fn normalize_status(raw: &str) -> Result<String, CliError> {
    let status = raw.trim().to_lowercase();
    match status.as_str() {
        "open" | "waiting" | "done" | "cancelled" => Ok(status),
        _ => Err(CliError::Runtime(format!(
            "invalid task status '{raw}' (expected open, waiting, done, or cancelled)"
        ))),
    }
}

fn insert_task_link(conn: &Connection, task_id: &str, link: &LinkRef) -> Result<(), CliError> {
    match link.kind {
        LinkKind::Person => {
            conn.execute(
                "INSERT OR IGNORE INTO task_people (id, task_id, person_id) VALUES (?1,?2,?3)",
                params![new_id(), task_id, link.id],
            )?;
        }
        LinkKind::Organization => {
            conn.execute(
                "INSERT OR IGNORE INTO task_organizations (id, task_id, organization_id)
                 VALUES (?1,?2,?3)",
                params![new_id(), task_id, link.id],
            )?;
        }
        LinkKind::Project => {
            conn.execute(
                "UPDATE tasks SET project_id = ?1 WHERE id = ?2",
                params![link.id, task_id],
            )?;
        }
        LinkKind::Task => {
            return Err(CliError::Runtime(
                "a task cannot link to another task".into(),
            ));
        }
        LinkKind::Document => {
            conn.execute(
                "INSERT OR IGNORE INTO task_documents (id, task_id, document_id)
                 VALUES (?1,?2,?3)",
                params![new_id(), task_id, link.id],
            )?;
        }
        LinkKind::Interaction => {
            conn.execute(
                "UPDATE tasks
                 SET origin_interaction_id = COALESCE(origin_interaction_id, ?1)
                 WHERE id = ?2",
                params![link.id, task_id],
            )?;
            conn.execute(
                "INSERT OR IGNORE INTO task_interactions (id, task_id, interaction_id)
                 VALUES (?1,?2,?3)",
                params![new_id(), task_id, link.id],
            )?;
        }
    }
    Ok(())
}

fn update_task_fields(
    conn: &Connection,
    id: &str,
    title: Option<String>,
    description: Option<Option<String>>,
    status: Option<String>,
    due_at: Option<Option<String>>,
    scheduled_for: Option<Option<String>>,
) -> Result<(), CliError> {
    let mut set_clauses = Vec::new();
    let mut params = Vec::new();
    if let Some(title) = title {
        set_clauses.push(format!("title = ?{}", params.len() + 1));
        params.push(SqlValue::from(title));
    }
    if let Some(description) = description {
        set_clauses.push(format!("description = ?{}", params.len() + 1));
        params.push(description.map(SqlValue::from).unwrap_or(SqlValue::Null));
    }
    if let Some(status) = status {
        set_clauses.push(format!("status = ?{}", params.len() + 1));
        params.push(SqlValue::from(status));
    }
    if let Some(due_at) = due_at {
        set_clauses.push(format!("due_at = ?{}", params.len() + 1));
        params.push(due_at.map(SqlValue::from).unwrap_or(SqlValue::Null));
    }
    if let Some(scheduled_for) = scheduled_for {
        set_clauses.push(format!("scheduled_for = ?{}", params.len() + 1));
        params.push(scheduled_for.map(SqlValue::from).unwrap_or(SqlValue::Null));
    }
    set_clauses.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')".to_string());
    params.push(SqlValue::from(id.to_string()));
    let sql = format!(
        "UPDATE tasks SET {} WHERE id = ?{}",
        set_clauses.join(", "),
        params.len()
    );
    conn.execute(&sql, rusqlite::params_from_iter(params))?;
    Ok(())
}

pub fn update_task(
    conn: &mut Connection,
    json: bool,
    args: UpdateTaskArgs,
) -> Result<(), CliError> {
    if args.evidence.is_empty() {
        return Err(CliError::Runtime(
            "tasks update requires at least one --evidence reference".into(),
        ));
    }
    let project_links = args
        .links
        .iter()
        .filter(|link| matches!(link.kind, LinkKind::Project))
        .count();
    if project_links > 1 {
        return Err(CliError::Runtime(
            "a task can link to only one project".into(),
        ));
    }

    let title = args
        .title
        .map(|raw| {
            normalize_title(Some(raw))
                .ok_or_else(|| CliError::Runtime("a task title cannot be blank".into()))
        })
        .transpose()?;
    let description = args.description.map(|raw| normalize_optional(Some(raw)));
    let status = args.status.map(normalize_status).transpose()?;
    let due_at = args.due_at.map(|raw| normalize_optional(Some(raw)));
    let scheduled_for = args.scheduled_for.map(|raw| normalize_optional(Some(raw)));

    let tx = conn.transaction()?;
    require_active_task(&tx, args.id)?;
    update_task_fields(
        &tx,
        args.id,
        title,
        description,
        status,
        due_at,
        scheduled_for,
    )?;
    for link in &args.links {
        insert_task_link(&tx, args.id, link)?;
    }
    insert_evidence_refs(&tx, "task", args.id, &args.evidence)?;
    tx.commit()?;

    if json {
        print_json(&json!({
            "kind": "task",
            "id": args.id,
            "links": args.links.len(),
            "evidence": args.evidence.len(),
        }))
    } else {
        println!("task {} updated", args.id);
        Ok(())
    }
}

pub fn complete_task(
    conn: &mut Connection,
    json: bool,
    args: CompleteTaskArgs,
) -> Result<(), CliError> {
    if args.evidence.is_empty() {
        return Err(CliError::Runtime(
            "tasks complete requires at least one --evidence reference".into(),
        ));
    }
    let completed_at = now_iso(conn)?;
    let tx = conn.transaction()?;
    require_active_task(&tx, args.id)?;
    tx.execute(
        "UPDATE tasks
         SET status = 'done', completed_at = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?2",
        params![completed_at, args.id],
    )?;
    insert_evidence_refs(&tx, "task", args.id, &args.evidence)?;
    tx.commit()?;

    if json {
        print_json(&json!({
            "kind": "task",
            "id": args.id,
            "status": "done",
            "evidence": args.evidence.len(),
        }))
    } else {
        println!("task {} completed", args.id);
        Ok(())
    }
}
