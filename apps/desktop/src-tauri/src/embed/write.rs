//! Embedding-table writes: `chunk_embeddings` rows + their vec0 vectors. Plain
//! functions over a [`Connection`]; the command layer ([`super`]) wraps them in
//! one identity-guarded transaction via `DbState::with_expected_connection_mut`.
//!
//! The chunk text is the durable unit (`content_chunks`); these rows are a
//! rebuildable projection keyed by `content_chunks.id`. `chunk_embeddings.id` is
//! the integer rowid the `chunk_vectors` vec0 table needs, since the content
//! chunk id is TEXT.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;

use crate::error::{AppError, AppResult};

/// The expected vector width (all-MiniLM-L6-v2). vec0 also enforces this, but we
/// reject early with a clear message rather than a generic constraint error.
const VECTOR_DIM: usize = 384;

/// One freshly-embedded content chunk, built in TS (`@local-brain/core`). The
/// pipeline only sends chunks it actually embedded (hash-skip lives there), so a
/// vector is always present.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedChunk {
    pub(super) chunk_id: String,
    pub(super) content_hash: String,
    pub(super) model_id: String,
    pub(super) vector: Vec<f32>,
}

/// vec0 accepts a JSON-text vector; build it without a serde round-trip.
fn vector_json(vector: &[f32]) -> String {
    let mut out = String::with_capacity(vector.len() * 10 + 2);
    out.push('[');
    for (i, value) in vector.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&value.to_string());
    }
    out.push(']');
    out
}

/// Upsert each chunk's embedding: replace any prior `(chunk_id, model_id)` row
/// and its vector, then insert the new pair. Returns how many were applied.
pub(super) fn apply_chunks(conn: &Connection, chunks: &[EmbeddedChunk]) -> AppResult<usize> {
    // Validate the entire payload before replacing any vectors. Embedding happens
    // outside the DB lock, so a record edit can replace/delete a chunk while the
    // model is running; applying that now-stale vector would make semantic search
    // disagree with the durable chunk text.
    for chunk in chunks {
        if chunk.vector.len() != VECTOR_DIM {
            return Err(AppError::parse(format!(
                "embedding for chunk {} has {} dims, expected {VECTOR_DIM}",
                chunk.chunk_id,
                chunk.vector.len()
            )));
        }

        let current_hash: Option<Option<String>> = conn
            .prepare_cached("SELECT content_hash FROM content_chunks WHERE id = ?1")?
            .query_row(params![chunk.chunk_id], |row| row.get(0))
            .optional()?;
        match current_hash {
            Some(Some(hash)) if hash == chunk.content_hash => {}
            Some(_) => {
                return Err(AppError::stale(format!(
                    "content chunk {} changed while its embedding was being generated",
                    chunk.chunk_id
                )));
            }
            None => {
                return Err(AppError::stale(format!(
                    "content chunk {} no longer exists",
                    chunk.chunk_id
                )));
            }
        }
    }

    let mut applied = 0;
    for chunk in chunks {
        // Replace any existing embedding for this chunk + model (re-embed path).
        let existing: Option<i64> = conn
            .prepare_cached(
                "SELECT id FROM chunk_embeddings WHERE chunk_id = ?1 AND model_id = ?2",
            )?
            .query_row(params![chunk.chunk_id, chunk.model_id], |row| row.get(0))
            .optional()?;
        if let Some(id) = existing {
            conn.prepare_cached("DELETE FROM chunk_vectors WHERE rowid = ?1")?
                .execute(params![id])?;
            conn.prepare_cached("DELETE FROM chunk_embeddings WHERE id = ?1")?
                .execute(params![id])?;
        }

        conn.prepare_cached(
            "INSERT INTO chunk_embeddings (chunk_id, content_hash, model_id) VALUES (?1, ?2, ?3)",
        )?
        .execute(params![chunk.chunk_id, chunk.content_hash, chunk.model_id])?;
        let id = conn.last_insert_rowid();
        conn.prepare_cached("INSERT INTO chunk_vectors(rowid, embedding) VALUES (?1, ?2)")?
            .execute(params![id, vector_json(&chunk.vector)])?;
        applied += 1;
    }
    Ok(applied)
}

/// Drop every embedding + vector for the given content-chunk ids (pruning rows
/// whose source chunk no longer exists). Returns rows deleted.
pub(super) fn delete_chunks(conn: &Connection, chunk_ids: &[String]) -> AppResult<usize> {
    let mut deleted = 0;
    for chunk_id in chunk_ids {
        conn.prepare_cached(
            "DELETE FROM chunk_vectors WHERE rowid IN \
               (SELECT id FROM chunk_embeddings WHERE chunk_id = ?1)",
        )?
        .execute(params![chunk_id])?;
        deleted += conn
            .prepare_cached("DELETE FROM chunk_embeddings WHERE chunk_id = ?1")?
            .execute(params![chunk_id])?;
    }
    Ok(deleted)
}

/// Wipe the whole embedding projection (rebuild / model change). Returns the
/// number of `chunk_embeddings` rows removed.
pub(super) fn clear(conn: &Connection) -> AppResult<usize> {
    conn.execute("DELETE FROM chunk_vectors", [])?;
    Ok(conn.execute("DELETE FROM chunk_embeddings", [])?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit_vector(seed: f32) -> Vec<f32> {
        let mut v = vec![0.0f32; VECTOR_DIM];
        v[0] = seed;
        v
    }

    fn db() -> Connection {
        brain_schema::open_in_memory().expect("in-memory database")
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    fn chunk(id: &str, hash: &str, vector: Vec<f32>) -> EmbeddedChunk {
        EmbeddedChunk {
            chunk_id: id.to_string(),
            content_hash: hash.to_string(),
            model_id: "all-MiniLM-L6-v2".to_string(),
            vector,
        }
    }

    fn source_chunk(conn: &Connection, id: &str, hash: &str) {
        conn.execute(
            "INSERT INTO content_chunks \
             (id, record_type, record_id, chunk_index, text, content_hash) \
             VALUES (?1, 'document', ?1, 0, 'text', ?2)",
            params![id, hash],
        )
        .unwrap();
    }

    #[test]
    fn apply_inserts_row_and_vector() {
        let conn = db();
        source_chunk(&conn, "c1", "h1");
        let applied = apply_chunks(&conn, &[chunk("c1", "h1", unit_vector(1.0))]).unwrap();
        assert_eq!(applied, 1);
        assert_eq!(count(&conn, "chunk_embeddings"), 1);
        assert_eq!(count(&conn, "chunk_vectors"), 1);
    }

    #[test]
    fn apply_is_idempotent_per_chunk_and_model() {
        let conn = db();
        source_chunk(&conn, "c1", "h1");
        apply_chunks(&conn, &[chunk("c1", "h1", unit_vector(1.0))]).unwrap();
        // Re-embed the same chunk (e.g. after a rebuild): one row, not two.
        conn.execute(
            "UPDATE content_chunks SET content_hash = 'h2' WHERE id = 'c1'",
            [],
        )
        .unwrap();
        apply_chunks(&conn, &[chunk("c1", "h2", unit_vector(0.5))]).unwrap();
        assert_eq!(count(&conn, "chunk_embeddings"), 1);
        assert_eq!(count(&conn, "chunk_vectors"), 1);
        let hash: String = conn
            .query_row(
                "SELECT content_hash FROM chunk_embeddings WHERE chunk_id='c1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hash, "h2", "the latest embedding wins");
    }

    #[test]
    fn delete_removes_rows_and_vectors() {
        let conn = db();
        source_chunk(&conn, "c1", "h1");
        source_chunk(&conn, "c2", "h2");
        apply_chunks(
            &conn,
            &[
                chunk("c1", "h1", unit_vector(1.0)),
                chunk("c2", "h2", unit_vector(0.5)),
            ],
        )
        .unwrap();
        let deleted = delete_chunks(&conn, &["c1".to_string()]).unwrap();
        assert_eq!(deleted, 1);
        assert_eq!(count(&conn, "chunk_embeddings"), 1);
        assert_eq!(count(&conn, "chunk_vectors"), 1);
    }

    #[test]
    fn clear_wipes_everything() {
        let conn = db();
        source_chunk(&conn, "c1", "h1");
        source_chunk(&conn, "c2", "h2");
        apply_chunks(
            &conn,
            &[
                chunk("c1", "h1", unit_vector(1.0)),
                chunk("c2", "h2", unit_vector(0.5)),
            ],
        )
        .unwrap();
        let removed = clear(&conn).unwrap();
        assert_eq!(removed, 2);
        assert_eq!(count(&conn, "chunk_embeddings"), 0);
        assert_eq!(count(&conn, "chunk_vectors"), 0);
    }

    #[test]
    fn apply_rejects_wrong_dimension() {
        let conn = db();
        source_chunk(&conn, "c1", "h1");
        let result = apply_chunks(&conn, &[chunk("c1", "h1", vec![1.0, 2.0, 3.0])]);
        assert!(result.is_err(), "a non-384 vector must be rejected");
    }

    #[test]
    fn apply_rejects_missing_or_changed_source_chunks() {
        let conn = db();
        let missing = apply_chunks(&conn, &[chunk("gone", "h1", unit_vector(1.0))]);
        assert!(matches!(missing, Err(AppError::Stale { .. })));

        source_chunk(&conn, "c1", "new-hash");
        let changed = apply_chunks(&conn, &[chunk("c1", "old-hash", unit_vector(1.0))]);
        assert!(matches!(changed, Err(AppError::Stale { .. })));
        assert_eq!(count(&conn, "chunk_embeddings"), 0);
        assert_eq!(count(&conn, "chunk_vectors"), 0);
    }
}
