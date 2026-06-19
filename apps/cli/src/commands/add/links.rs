//! Derived-content and typed-link writers shared by the document and interaction
//! ingest paths: chunking text into `content_chunks` and inserting the join-table
//! rows that connect a record to the people/orgs/projects/tasks it references.

use rusqlite::{params, Connection};

use crate::commands::{EvidenceRef, LinkKind, LinkRef};
use crate::error::CliError;
use crate::id::new_id;
use crate::text::chunk_text;

/// Chunk `body` and insert the ordered `content_chunks` rows for a record,
/// returning the chunk count. The chunking is the Rust twin of the app's, so the
/// derived FTS/embedding data matches regardless of which writer ingested it.
pub(super) fn insert_chunks(
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

pub(super) fn replace_chunks(
    conn: &Connection,
    record_type: &str,
    record_id: &str,
    body: &str,
) -> Result<usize, CliError> {
    conn.execute(
        "DELETE FROM content_chunks WHERE record_type = ?1 AND record_id = ?2",
        params![record_type, record_id],
    )?;
    insert_chunks(conn, record_type, record_id, body)
}

/// Attach exact chunk evidence to a memory or task.
pub(super) fn insert_evidence_refs(
    conn: &Connection,
    subject_type: &str,
    subject_id: &str,
    evidence: &[EvidenceRef],
) -> Result<(), CliError> {
    for reference in evidence {
        let record_type = match reference.kind {
            LinkKind::Document | LinkKind::Interaction => reference.kind.as_str(),
            _ => {
                return Err(CliError::Runtime(format!(
                    "{subject_type} evidence must cite a document or interaction"
                )));
            }
        };
        let chunk_id = conn
            .query_row(
                "SELECT id FROM content_chunks
                 WHERE record_type = ?1 AND record_id = ?2 AND chunk_index = ?3
                 LIMIT 1",
                params![record_type, reference.id, reference.chunk_index],
                |row| row.get::<_, String>(0),
            )
            .map_err(|_| {
                CliError::Runtime(format!(
                    "could not find evidence chunk {record_type}:{}#{}",
                    reference.id, reference.chunk_index
                ))
            })?;
        conn.execute(
            "INSERT INTO evidence_refs (id, subject_type, subject_id, chunk_id)
             VALUES (?1,?2,?3,?4)",
            params![new_id(), subject_type, subject_id, chunk_id],
        )?;
    }
    Ok(())
}

/// Insert the typed link rows for a document/interaction.
pub(super) fn insert_links(
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
                link.kind.as_str()
            )));
        }
    };
    Ok(table)
}
