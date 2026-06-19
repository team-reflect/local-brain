//! Derived-content and typed-link writers shared by the document and interaction
//! ingest paths: chunking text into `content_chunks` and inserting the join-table
//! rows that connect a record to the people/orgs/projects/tasks it references.

use rusqlite::{params, Connection};

use crate::commands::{LinkKind, LinkRef};
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
