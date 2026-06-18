//! Write commands: `brain add document|interaction|task` and `brain remember`.
//! Each write runs in a single transaction (record + derived chunks + links),
//! mirroring the app's `ingestDocument`/`ingestInteraction` so provenance and
//! dedupe behave identically regardless of which tool wrote the record.

use rusqlite::{params, Connection};
use serde_json::json;

use super::{now_iso, LinkKind, LinkRef};
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;
use crate::text::{chunk_text, content_hash, normalize_text};

/// Find a non-archived record in `table` with this content hash (dedupe).
fn find_duplicate(conn: &Connection, table: &str, hash: &str) -> Result<Option<String>, CliError> {
    let sql =
        format!("SELECT id FROM {table} WHERE content_hash = ?1 AND archived_at IS NULL LIMIT 1");
    let id = conn
        .query_row(&sql, params![hash], |row| row.get::<_, String>(0))
        .ok();
    Ok(id)
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
        let (table, owner_col, other_col, other) = link_table(owner, link);
        let sql = format!("INSERT INTO {table} (id, {owner_col}, {other_col}) VALUES (?1,?2,?3)");
        conn.execute(&sql, params![new_id(), owner_id, link.id])
            .map_err(|e| CliError::Runtime(format!("could not link {other}: {e}")))?;
    }
    Ok(())
}

/// Map (owner, link) to the join table + columns. `owner` is "document" | "interaction".
fn link_table(
    owner: &str,
    link: &LinkRef,
) -> (&'static str, &'static str, &'static str, &'static str) {
    match (owner, link.kind) {
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
        _ => unreachable!("owner is always document or interaction"),
    }
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
    pub body: String,
    pub links: Vec<LinkRef>,
    pub allow_duplicate: bool,
}

pub fn add_interaction(
    conn: &mut Connection,
    json: bool,
    args: AddInteractionArgs,
) -> Result<(), CliError> {
    let body = normalize_text(&args.body);
    let hash = content_hash(&body);
    if let Some(existing) = find_duplicate(conn, "interactions", &hash)? {
        if !args.allow_duplicate {
            return report_record(json, "interaction", &existing, true, 0);
        }
    }
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO interactions (id, kind, title, body_text, occurred_at, content_hash) VALUES (?1,?2,?3,?4,?5,?6)",
        params![id, args.kind, args.title, body, args.occurred_at, hash],
    )?;
    let count = insert_chunks(&tx, "interaction", &id, &body)?;
    insert_links(&tx, "interaction", &id, &args.links)?;
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
