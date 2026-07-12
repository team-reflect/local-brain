// Real-SQLite regressions for polymorphic references that SQLite foreign keys
// cannot enforce. These use the production migrations and core IPC bridge.

import { describe, expect, it } from 'vitest'
import { hardDeleteRecord } from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

function insertEmbeddedChunk(database, { id, recordType, recordId }) {
  database
    .prepare(
      'INSERT INTO content_chunks (id, record_type, record_id, chunk_index, text) VALUES (?, ?, ?, 0, ?)',
    )
    .run(id, recordType, recordId, `${id} hard delete marker`)
  database
    .prepare(
      "INSERT INTO chunk_embeddings (chunk_id, content_hash, model_id) VALUES (?, 'h', 'all-MiniLM-L6-v2')",
    )
    .run(id)
}

describe('hard-delete polymorphic reference regressions', () => {
  it('removes the full nested derived-artifact closure and its embeddings', async () => {
    const database = freshDatabase()
    installSqliteBridge(database)
    database.prepare("INSERT INTO people (id, full_name) VALUES ('person-delete', 'Delete Person')").run()
    database
      .prepare(
        "INSERT INTO ai_notes (id, subject_type, subject_id, content) VALUES ('note-direct', 'person', 'person-delete', 'Direct note')",
      )
      .run()
    database
      .prepare(
        "INSERT INTO extracted_facts (id, subject_type, subject_id, key, value_text) VALUES ('fact-nested', 'ai_note', 'note-direct', 'nested', 'Nested fact')",
      )
      .run()
    database
      .prepare(
        "INSERT INTO ai_notes (id, subject_type, subject_id, content) VALUES ('note-nested', 'extracted_fact', 'fact-nested', 'Nested note')",
      )
      .run()
    database
      .prepare(
        "INSERT INTO extracted_facts (id, subject_type, subject_id, key, value_text) VALUES ('fact-deep', 'ai_note', 'note-nested', 'deep', 'Deep fact')",
      )
      .run()

    for (const [id, recordType, recordId] of [
      ['person-chunk', 'person', 'person-delete'],
      ['note-direct-chunk', 'ai_note', 'note-direct'],
      ['fact-nested-chunk', 'extracted_fact', 'fact-nested'],
      ['note-nested-chunk', 'ai_note', 'note-nested'],
      ['fact-deep-chunk', 'extracted_fact', 'fact-deep'],
    ]) {
      insertEmbeddedChunk(database, { id, recordType, recordId })
    }

    await hardDeleteRecord('person', 'person-delete')

    for (const table of [
      'people',
      'ai_notes',
      'extracted_facts',
      'content_chunks',
      'chunk_embeddings',
    ]) {
      expect(database.prepare(`SELECT count(*) AS n FROM ${table}`).get().n).toBe(0)
    }
  })

  it('clears an accepted suggestion result that points at a deleted record', async () => {
    const database = freshDatabase()
    installSqliteBridge(database)
    database.prepare("INSERT INTO projects (id, name) VALUES ('project-delete', 'Delete Project')").run()
    database
      .prepare(
        `INSERT INTO suggestions
           (id, kind, title, status, resolved_record_type, resolved_record_id, resolved_at)
         VALUES
           ('suggestion-accepted', 'create_project', 'Accepted project', 'accepted',
            'project', 'project-delete', '2026-07-12T12:00:00.000Z')`,
      )
      .run()

    await hardDeleteRecord('project', 'project-delete')

    expect(database.prepare('SELECT count(*) AS n FROM projects').get().n).toBe(0)
    expect(
      database
        .prepare(
          `SELECT status, resolved_record_type, resolved_record_id, resolved_at
           FROM suggestions WHERE id = 'suggestion-accepted'`,
        )
        .get(),
    ).toEqual({
      status: 'accepted',
      resolved_record_type: null,
      resolved_record_id: null,
      resolved_at: '2026-07-12T12:00:00.000Z',
    })
  })
})
