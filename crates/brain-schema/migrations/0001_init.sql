-- Foundation bookkeeping only.
--
-- The durable product schema (people, organizations, affiliations, projects,
-- tasks, interactions, documents, content_chunks, memories, memory_links,
-- evidence_refs, tags, taggings, chat_conversations, chat_messages, settings,
-- plus join tables, indexes, and FTS5) is added in Plan 02. This initial
-- migration exists so the open/migrate path, pragmas, and schema-version
-- bookkeeping are exercised from the first PR.

CREATE TABLE schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO schema_meta (key, value) VALUES ('app', 'local-brain');
