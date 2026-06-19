//! `brain add task` — create a task and wire its links: people, organizations,
//! projects, documents, and interactions go through their typed join tables.

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
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO tasks (id, title, status, due_at, project_id) VALUES (?1,?2,?3,?4,?5)",
        params![id, args.title, args.status, args.due_at, args.project_id],
    )?;
    // Keep the denormalized `project_id` filled for read paths while also
    // writing the typed join rows that preserve evidence and graph edges.
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
                tx.execute(
                    "INSERT OR IGNORE INTO project_tasks (id, project_id, task_id) VALUES (?1,?2,?3)",
                    params![new_id(), link.id, id],
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
    insert_evidence_refs(&tx, "task", &id, &args.evidence)?;
    tx.commit()?;
    if json {
        print_json(&json!({ "kind": "task", "id": id, "evidence": args.evidence.len() }))
    } else {
        println!("task {id}");
        Ok(())
    }
}
