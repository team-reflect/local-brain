//! Derived-content and typed-link writers shared by the document and interaction
//! ingest paths: chunking text into `content_chunks` and inserting the join-table
//! rows that connect a record to the people/orgs/projects/tasks it references.

use rusqlite::{params, Connection};

use crate::commands::{to_like_pattern_lower, EvidenceLocator, EvidenceRef, LinkKind, LinkRef};
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
    let chunks = chunk_text(body);
    for (index, text) in chunks.iter().enumerate() {
        let chunk_index = index as i64;
        let existing_id = conn
            .query_row(
                "SELECT id FROM content_chunks
                 WHERE record_type = ?1 AND record_id = ?2 AND chunk_index = ?3
                 LIMIT 1",
                params![record_type, record_id, chunk_index],
                |row| row.get::<_, String>(0),
            )
            .ok();
        if let Some(existing_id) = existing_id {
            conn.execute(
                "UPDATE content_chunks SET text = ?1 WHERE id = ?2",
                params![text, existing_id],
            )?;
        } else {
            conn.execute(
                "INSERT INTO content_chunks (id, record_type, record_id, chunk_index, text)
                 VALUES (?1,?2,?3,?4,?5)",
                params![new_id(), record_type, record_id, chunk_index, text],
            )?;
        }
    }
    conn.execute(
        "DELETE FROM content_chunks
         WHERE record_type = ?1 AND record_id = ?2 AND chunk_index >= ?3",
        params![record_type, record_id, chunks.len() as i64],
    )?;
    Ok(chunks.len())
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
        let chunk_id = match &reference.locator {
            EvidenceLocator::Chunk(chunk_index) => conn
                .query_row(
                    "SELECT id FROM content_chunks
                     WHERE record_type = ?1 AND record_id = ?2 AND chunk_index = ?3
                     LIMIT 1",
                    params![record_type, reference.id, chunk_index],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|_| {
                    CliError::Runtime(format!(
                        "could not find evidence chunk {record_type}:{}#{chunk_index}",
                        reference.id
                    ))
                })?,
            EvidenceLocator::Quote(quote) => {
                // Resolve the lowest-index chunk whose text contains the quote
                // (case-insensitive), so an agent can cite by phrase without
                // knowing chunk boundaries. LIKE wildcards in the quote are escaped.
                // A blank pattern or no matching chunk both collapse to the same
                // "not found" error rather than silently matching everything.
                let chunk = to_like_pattern_lower(quote).and_then(|pattern| {
                    conn.query_row(
                        "SELECT id FROM content_chunks
                         WHERE record_type = ?1 AND record_id = ?2
                           AND lower(text) LIKE ?3 ESCAPE '\\'
                         ORDER BY chunk_index ASC
                         LIMIT 1",
                        params![record_type, reference.id, pattern],
                        |row| row.get::<_, String>(0),
                    )
                    .ok()
                });
                chunk.ok_or_else(|| {
                    CliError::Runtime(format!(
                        "could not find a {record_type}:{} chunk containing quote {quote:?}",
                        reference.id
                    ))
                })?
            }
        };
        conn.execute(
            "INSERT INTO evidence_refs (id, subject_type, subject_id, chunk_id)
             VALUES (?1,?2,?3,?4)",
            params![new_id(), subject_type, subject_id, chunk_id],
        )?;
    }
    Ok(())
}

/// Insert one `INSERT OR IGNORE` row into a two-id join table, mapping any SQL
/// error to a readable "could not link {label}" message. `owner_col`/`other_col`
/// are the table's two id columns. Every typed-link writer (documents,
/// interactions, projects, organizations) funnels through here so the
/// INSERT-OR-IGNORE boilerplate lives in one place; each writer keeps its own
/// kind→table policy match because those policies genuinely differ.
pub(super) fn insert_join_row(
    conn: &Connection,
    table: &str,
    owner_col: &str,
    owner_id: &str,
    other_col: &str,
    other_id: &str,
    label: &str,
) -> Result<(), CliError> {
    let sql =
        format!("INSERT OR IGNORE INTO {table} (id, {owner_col}, {other_col}) VALUES (?1,?2,?3)");
    conn.execute(&sql, params![new_id(), owner_id, other_id])
        .map_err(|e| CliError::Runtime(format!("could not link {label}: {e}")))?;
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
        insert_join_row(conn, table, owner_col, owner_id, other_col, &link.id, other)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_two_chunks(conn: &Connection) {
        conn.execute(
            "INSERT INTO interactions (id, title) VALUES ('i1', 'Thread')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO content_chunks (id, record_type, record_id, chunk_index, text)
             VALUES ('c0','interaction','i1',0,'intro about the living room light fixture')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO content_chunks (id, record_type, record_id, chunk_index, text)
             VALUES ('c1','interaction','i1',1,'the Powder Bathroom sink decision and lead times')",
            [],
        )
        .unwrap();
    }

    #[test]
    fn quote_evidence_resolves_to_the_containing_chunk_case_insensitively() {
        let conn = brain_schema::open_in_memory().unwrap();
        seed_two_chunks(&conn);
        let evidence = vec![EvidenceRef {
            kind: LinkKind::Interaction,
            id: "i1".into(),
            locator: EvidenceLocator::Quote("powder bathroom SINK".into()),
        }];
        insert_evidence_refs(&conn, "memory", "m1", &evidence).unwrap();
        let chunk_id: String = conn
            .query_row(
                "SELECT chunk_id FROM evidence_refs WHERE subject_id = 'm1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            chunk_id, "c1",
            "quote resolves to the chunk that contains it"
        );
    }

    #[test]
    fn quote_with_no_match_errors_clearly() {
        let conn = brain_schema::open_in_memory().unwrap();
        seed_two_chunks(&conn);
        let evidence = vec![EvidenceRef {
            kind: LinkKind::Interaction,
            id: "i1".into(),
            locator: EvidenceLocator::Quote("a phrase that appears nowhere".into()),
        }];
        let result = insert_evidence_refs(&conn, "memory", "m1", &evidence);
        assert!(
            result.is_err(),
            "an unmatched quote must error, not silently skip"
        );
    }
}
