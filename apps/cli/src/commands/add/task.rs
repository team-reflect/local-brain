//! `brain add task` — create a task and wire its links: people, organizations,
//! documents, and interactions go through typed join tables. A task's project is
//! the direct `tasks.project_id` association because launch tasks belong to at
//! most one project.

use rusqlite::{params, Connection};
use serde_json::json;

use super::links::insert_evidence_refs;
use crate::commands::{EvidenceRef, LinkKind, LinkRef};
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
