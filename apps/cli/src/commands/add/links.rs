//! Derived-content and typed-link writers shared by the document and interaction
//! ingest paths: chunking text into `content_chunks` and inserting the join-table
//! rows that connect a record to the people/orgs/projects/tasks it references.

use std::collections::HashMap;

use rusqlite::{params, params_from_iter, Connection, OptionalExtension};

use crate::commands::{to_like_pattern_lower, EvidenceLocator, EvidenceRef, LinkKind, LinkRef};
use crate::error::CliError;
use crate::id::new_id;
use crate::text::{chunk_text, content_hash};

/// Insert one ordered chunk row, stamping its `content_hash`.
///
/// The hash is what the embedding pipeline diffs against (`chunk_embeddings`):
/// it only re-embeds a chunk when the stored `content_chunks.content_hash` no
/// longer matches the embedded one, so every writer of chunk text MUST keep the
/// hash in lockstep with the text. The Rust `content_hash` is the same
/// normalized-text SHA-256 as the app's `contentHash`, so a CLI-written chunk
/// and an app-written chunk hash identically.
fn insert_chunk_row(
    conn: &Connection,
    record_type: &str,
    record_id: &str,
    chunk_index: i64,
    text: &str,
) -> Result<(), CliError> {
    conn.execute(
        "INSERT INTO content_chunks (id, record_type, record_id, chunk_index, text, content_hash)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![
            new_id(),
            record_type,
            record_id,
            chunk_index,
            text,
            content_hash(text),
        ],
    )?;
    Ok(())
}

/// Exact-duplicate maintenance stats for one record's derived chunks.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(super) struct ExactChunkDedupeStats {
    pub duplicate_chunks: usize,
    pub evidence_refs_repointed: usize,
    pub embeddings_deleted: usize,
    pub hashes_refreshed: usize,
}

#[derive(Debug)]
struct ExistingChunk {
    id: String,
    chunk_index: i64,
    text: String,
    content_hash: Option<String>,
}

fn count_duplicate_dependents(
    conn: &Connection,
    duplicate_ids: &[&str],
) -> Result<(usize, usize), CliError> {
    // Bound each statement well below SQLite's host-parameter limit. Numbered
    // parameters can be reused by both subqueries, so each batch needs only one
    // binding per duplicate id rather than one query per duplicate row.
    const BATCH_SIZE: usize = 500;

    let mut evidence_refs = 0;
    let mut embeddings = 0;
    for batch in duplicate_ids.chunks(BATCH_SIZE) {
        let placeholders = (1..=batch.len())
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT
               (SELECT COUNT(*) FROM evidence_refs WHERE chunk_id IN ({placeholders})),
               (SELECT COUNT(*) FROM chunk_embeddings WHERE chunk_id IN ({placeholders}))"
        );
        let (batch_evidence_refs, batch_embeddings): (i64, i64) =
            conn.query_row(&sql, params_from_iter(batch.iter().copied()), |row| {
                Ok((row.get(0)?, row.get(1)?))
            })?;
        evidence_refs += batch_evidence_refs as usize;
        embeddings += batch_embeddings as usize;
    }
    Ok((evidence_refs, embeddings))
}

fn existing_chunks(
    conn: &Connection,
    record_type: &str,
    record_id: &str,
) -> Result<Vec<ExistingChunk>, CliError> {
    let mut stmt = conn.prepare(
        "SELECT id, chunk_index, text, content_hash
         FROM content_chunks
         WHERE record_type = ?1 AND record_id = ?2
         ORDER BY chunk_index ASC, id ASC",
    )?;
    let rows = stmt.query_map(params![record_type, record_id], |row| {
        Ok(ExistingChunk {
            id: row.get(0)?,
            chunk_index: row.get(1)?,
            text: row.get(2)?,
            content_hash: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Preview or apply exact-text de-duplication for one record's rebuildable
/// `content_chunks` projection.
///
/// The durable source body is never touched. Before deleting a later duplicate,
/// evidence refs are moved to the earliest byte-identical chunk, so citations
/// keep the same text and quote offsets. Remaining chunks are compacted in their
/// original order while retaining their ids. Duplicate embedding rows/vectors
/// are removed because they are a rebuildable projection too.
pub(super) fn dedupe_exact_chunks_for_record(
    conn: &Connection,
    record_type: &str,
    record_id: &str,
    apply: bool,
) -> Result<ExactChunkDedupeStats, CliError> {
    let chunks = existing_chunks(conn, record_type, record_id)?;
    let mut canonical_by_text: HashMap<&str, &str> = HashMap::new();
    let mut survivors = Vec::new();
    let mut duplicates = Vec::new();

    for chunk in &chunks {
        if let Some(canonical_id) = canonical_by_text.get(chunk.text.as_str()) {
            duplicates.push((chunk.id.as_str(), *canonical_id));
        } else {
            canonical_by_text.insert(chunk.text.as_str(), chunk.id.as_str());
            survivors.push(chunk);
        }
    }

    let mut stats = ExactChunkDedupeStats {
        duplicate_chunks: duplicates.len(),
        ..ExactChunkDedupeStats::default()
    };
    let duplicate_ids = duplicates
        .iter()
        .map(|(duplicate_id, _)| *duplicate_id)
        .collect::<Vec<_>>();
    (stats.evidence_refs_repointed, stats.embeddings_deleted) =
        count_duplicate_dependents(conn, &duplicate_ids)?;
    stats.hashes_refreshed = survivors
        .iter()
        .filter(|chunk| chunk.content_hash.as_deref() != Some(content_hash(&chunk.text).as_str()))
        .count();

    if !apply {
        return Ok(stats);
    }

    for (duplicate_id, canonical_id) in duplicates {
        conn.execute(
            "UPDATE evidence_refs SET chunk_id = ?1 WHERE chunk_id = ?2",
            params![canonical_id, duplicate_id],
        )?;
        conn.execute(
            "DELETE FROM chunk_vectors
             WHERE rowid IN (SELECT id FROM chunk_embeddings WHERE chunk_id = ?1)",
            params![duplicate_id],
        )?;
        conn.execute(
            "DELETE FROM chunk_embeddings WHERE chunk_id = ?1",
            params![duplicate_id],
        )?;
        conn.execute(
            "DELETE FROM content_chunks WHERE id = ?1",
            params![duplicate_id],
        )?;
    }

    // Deleting a later duplicate leaves a hole. Moving survivors in ascending
    // original order is conflict-free because every lower destination is either
    // the same survivor index or a duplicate row that was just removed.
    for (new_index, chunk) in survivors.iter().enumerate() {
        let hash = content_hash(&chunk.text);
        if chunk.chunk_index != new_index as i64
            || chunk.content_hash.as_deref() != Some(hash.as_str())
        {
            conn.execute(
                "UPDATE content_chunks
                 SET chunk_index = ?1, content_hash = ?2
                 WHERE id = ?3",
                params![new_index as i64, hash, chunk.id],
            )?;
        }
    }

    Ok(stats)
}

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
        insert_chunk_row(conn, record_type, record_id, index as i64, text)?;
    }
    Ok(chunks.len())
}

/// Re-chunk `body` over a record's existing chunks: refresh the text (and hash)
/// of rows still in range, insert any new tail rows, and drop rows the shorter
/// body no longer needs. Updating `content_hash` alongside `text` is what makes
/// a re-import/enrich actually re-embed — without it the embedding pipeline sees
/// an unchanged hash and serves a stale vector for the old text. A changed
/// surviving chunk keeps its stable id (and therefore its evidence links), but
/// quote offsets described the superseded text and are cleared.
pub(super) fn replace_chunks(
    conn: &Connection,
    record_type: &str,
    record_id: &str,
    body: &str,
) -> Result<usize, CliError> {
    // Legacy imports may contain repeated quoted-history chunks. Collapse them
    // before the index-preserving replacement so a shifted unique chunk keeps
    // its original id and any evidence refs to a duplicate are not cascaded.
    dedupe_exact_chunks_for_record(conn, record_type, record_id, true)?;
    let chunks = chunk_text(body);
    for (index, text) in chunks.iter().enumerate() {
        let chunk_index = index as i64;
        let existing = conn
            .query_row(
                "SELECT id, text FROM content_chunks
                 WHERE record_type = ?1 AND record_id = ?2 AND chunk_index = ?3
                 LIMIT 1",
                params![record_type, record_id, chunk_index],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        if let Some((existing_id, existing_text)) = existing {
            conn.execute(
                "UPDATE content_chunks SET text = ?1, content_hash = ?2 WHERE id = ?3",
                params![text, content_hash(text), existing_id],
            )?;
            if existing_text != *text {
                conn.execute(
                    "UPDATE evidence_refs
                     SET quote_start = NULL, quote_end = NULL
                     WHERE chunk_id = ?1",
                    params![existing_id],
                )?;
            }
        } else {
            insert_chunk_row(conn, record_type, record_id, chunk_index, text)?;
        }
    }
    conn.execute(
        "DELETE FROM content_chunks
         WHERE record_type = ?1 AND record_id = ?2 AND chunk_index >= ?3",
        params![record_type, record_id, chunks.len() as i64],
    )?;
    Ok(chunks.len())
}

/// Attach exact chunk evidence to a memory, task, fact, or AI artifact.
pub(super) fn insert_evidence_refs(
    conn: &Connection,
    subject_type: &str,
    subject_id: &str,
    evidence: &[EvidenceRef],
) -> Result<(), CliError> {
    for reference in evidence {
        let record_type = reference.record_type.as_str();
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
            record_type: "interaction".into(),
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
            record_type: "interaction".into(),
            id: "i1".into(),
            locator: EvidenceLocator::Quote("a phrase that appears nowhere".into()),
        }];
        let result = insert_evidence_refs(&conn, "memory", "m1", &evidence);
        assert!(
            result.is_err(),
            "an unmatched quote must error, not silently skip"
        );
    }

    #[test]
    fn insert_chunks_stamps_the_content_hash() {
        let conn = brain_schema::open_in_memory().unwrap();
        conn.execute("INSERT INTO documents (id, title) VALUES ('d1', 'Doc')", [])
            .unwrap();
        insert_chunks(&conn, "document", "d1", "the original body text").unwrap();
        let hash: Option<String> = conn
            .query_row(
                "SELECT content_hash FROM content_chunks WHERE record_type='document' AND record_id='d1' AND chunk_index=0",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            hash.as_deref(),
            Some(content_hash("the original body text").as_str())
        );
    }

    #[test]
    fn replace_chunks_refreshes_content_hash_when_text_changes() {
        // Regression: replacing a chunk's text must also refresh its content_hash,
        // or the embedding pipeline's `cc.content_hash != ce.content_hash` staleness
        // check never fires and a re-import/enrich serves a stale vector.
        let conn = brain_schema::open_in_memory().unwrap();
        conn.execute("INSERT INTO documents (id, title) VALUES ('d1', 'Doc')", [])
            .unwrap();
        replace_chunks(&conn, "document", "d1", "first version of the body").unwrap();
        let first: String = conn
            .query_row(
                "SELECT content_hash FROM content_chunks WHERE record_id='d1' AND chunk_index=0",
                [],
                |row| row.get(0),
            )
            .unwrap();

        replace_chunks(&conn, "document", "d1", "a completely different body").unwrap();
        let (second_text, second_hash): (String, String) = conn
            .query_row(
                "SELECT text, content_hash FROM content_chunks WHERE record_id='d1' AND chunk_index=0",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(second_text, "a completely different body");
        assert_ne!(
            first, second_hash,
            "changed text must change the stored hash"
        );
        assert_eq!(second_hash, content_hash("a completely different body"));
    }

    #[test]
    fn replace_chunks_invalidates_only_offsets_for_changed_text() {
        let conn = brain_schema::open_in_memory().unwrap();
        conn.execute("INSERT INTO documents (id, title) VALUES ('d1', 'Doc')", [])
            .unwrap();
        replace_chunks(&conn, "document", "d1", "first version of the body").unwrap();
        let chunk_id: String = conn
            .query_row(
                "SELECT id FROM content_chunks WHERE record_id='d1' AND chunk_index=0",
                [],
                |row| row.get(0),
            )
            .unwrap();
        conn.execute(
            "INSERT INTO evidence_refs
               (id, subject_type, subject_id, chunk_id, quote_start, quote_end, note)
             VALUES ('e1', 'memory', 'm1', ?1, 6, 13, 'keep the evidence link')",
            params![chunk_id],
        )
        .unwrap();

        replace_chunks(&conn, "document", "d1", "first version of the body").unwrap();
        let unchanged_offsets: (Option<i64>, Option<i64>) = conn
            .query_row(
                "SELECT quote_start, quote_end FROM evidence_refs WHERE id='e1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(unchanged_offsets, (Some(6), Some(13)));

        replace_chunks(&conn, "document", "d1", "a corrected version of the body").unwrap();
        let (stable_chunk_id, quote_start, quote_end, note): (
            String,
            Option<i64>,
            Option<i64>,
            String,
        ) = conn
            .query_row(
                "SELECT evidence_refs.chunk_id, quote_start, quote_end, note
                 FROM evidence_refs WHERE id='e1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(stable_chunk_id, chunk_id);
        assert_eq!((quote_start, quote_end), (None, None));
        assert_eq!(note, "keep the evidence link");
    }
}
