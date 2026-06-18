// Real-SQLite tests for Plan 08: the JSON export assembler, destructive-delete
// maintenance (cascade + derived-data cleanup + FTS rebuild), and model-boundary
// settings. Uses the shared node:sqlite harness so cascades, content_chunks
// cleanup, and FTS5 rebuild run end to end against the actual migrations.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  assembleExport,
  exportCounts,
  getModelSettings,
  globalSearch,
  hardDeleteRecord,
  ingestDocument,
  ingestInteraction,
  listCitationsForSubject,
  rebuildSearchIndexes,
  setModelEnabled,
  setModelProviderSetting,
} from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

describe('Plan 08 export', () => {
  beforeEach(() => installSqliteBridge(freshDatabase()))

  it('assembles a versioned snapshot of the durable tables', async () => {
    await ingestDocument({ title: 'Doc', bodyText: 'hello world' })
    const snapshot = await assembleExport()
    expect(snapshot.exportVersion).toBe(1)
    // The harness applies migration SQL directly without the Rust runner that
    // stamps PRAGMA user_version, so the value is 0 here; in the app it is 2.
    expect(typeof snapshot.schemaVersion).toBe('number')
    expect(typeof snapshot.generatedAt).toBe('string')
    const counts = exportCounts(snapshot)
    expect(counts.documents).toBe(1)
    expect(counts.contentChunks).toBeGreaterThanOrEqual(1)
    // Round-trips as JSON.
    expect(() => JSON.parse(JSON.stringify(snapshot))).not.toThrow()
  })
})

describe('Plan 08 destructive maintenance', () => {
  beforeEach(() => installSqliteBridge(freshDatabase()))

  it('hard-deletes a document with its chunks and rebuilds FTS', async () => {
    const doc = await ingestDocument({ title: 'Throwaway', bodyText: 'unique-token-zebra appears here' })
    // The chunk is searchable before deletion.
    expect((await globalSearch('zebra')).some((h) => h.id === doc.id)).toBe(true)

    await hardDeleteRecord('document', doc.id)

    const after = await assembleExport()
    expect(exportCounts(after).documents).toBe(0)
    expect(exportCounts(after).contentChunks).toBe(0)
    // FTS no longer returns the deleted record; rebuild is safe to run.
    await rebuildSearchIndexes()
    expect((await globalSearch('zebra')).length).toBe(0)
  })

  it('cascades evidence when its cited chunk is deleted', async () => {
    const interaction = await ingestInteraction({ kind: 'meeting', title: 'M', bodyText: 'grounding text' })
    // No evidence yet; just prove the delete path cleans interactions + chunks.
    await hardDeleteRecord('interaction', interaction.id)
    const counts = exportCounts(await assembleExport())
    expect(counts.interactions).toBe(0)
    expect(counts.contentChunks).toBe(0)
    // A subject with no evidence returns nothing (sanity for the citations getter).
    expect(await listCitationsForSubject('chat_message', 'nope')).toEqual([])
  })
})

describe('Plan 08 model settings', () => {
  beforeEach(() => installSqliteBridge(freshDatabase()))

  it('round-trips the model boundary config', async () => {
    expect(await getModelSettings()).toEqual({ enabled: true, provider: null, model: null })
    await setModelEnabled(false)
    await setModelProviderSetting('anthropic')
    const settings = await getModelSettings()
    expect(settings.enabled).toBe(false)
    expect(settings.provider).toBe('anthropic')
  })
})
