//! `brain add task` — create a task and wire its links: people/organizations go
//! through join tables, a project link sets the `tasks.project_id` column.

use rusqlite::{params, Connection};
use serde_json::json;

use crate::commands::{LinkKind, LinkRef};
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;

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
