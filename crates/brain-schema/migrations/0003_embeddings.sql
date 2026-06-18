-- 0003_embeddings.sql
--
-- Derived vector index over content_chunks (Reflect-embeddings port). Like the
-- FTS tables, this is a rebuildable projection of the durable product data — the
-- chunk text lives in content_chunks, and the vectors here can be dropped and
-- regenerated without losing anything. sqlite-vec must be registered on the
-- connection before this runs (see brain-schema::register_sqlite_vec).
--
-- vec0 keys rows by an integer rowid, but content_chunks.id is TEXT, so
-- chunk_embeddings carries an INTEGER id that doubles as the chunk_vectors rowid.
-- There is intentionally no foreign key to content_chunks: the embedding pipeline
-- owns this lifecycle (embed_apply / embed_delete / embed_clear) so a content
-- chunk rewrite cannot silently cascade-delete vectors mid-rebuild.

CREATE TABLE chunk_embeddings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_id     TEXT NOT NULL,          -- content_chunks.id this vector was built from
  content_hash TEXT NOT NULL,          -- SHA-256 of the chunk text that was embedded
  model_id     TEXT NOT NULL,          -- embedding model id; a change forces re-embed
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (chunk_id, model_id)
);

CREATE INDEX chunk_embeddings_chunk ON chunk_embeddings (chunk_id);

-- 384-dim MiniLM vectors, cosine distance. chunk_vectors.rowid == chunk_embeddings.id.
CREATE VIRTUAL TABLE chunk_vectors USING vec0(embedding float[384] distance_metric=cosine);
