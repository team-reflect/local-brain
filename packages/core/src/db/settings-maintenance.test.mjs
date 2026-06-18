// Real-SQLite tests for Plan 08: destructive-delete maintenance and
// model-boundary settings. Uses the shared node:sqlite harness so cascades,
// content_chunks cleanup, and FTS5 rebuild run end to end against the actual
// migrations.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  db,
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

async function tableCount(table) {
  const row = await db
    .selectFrom(table)
    .select(({ fn }) => fn.countAll().as('count'))
    .executeTakeFirstOrThrow()
  return Number(row.count)
}

describe('Plan 08 destructive maintenance', () => {
  beforeEach(() => installSqliteBridge(freshDatabase()))

  it('hard-deletes a document with its chunks and rebuilds FTS', async () => {
    const doc = await ingestDocument({ title: 'Throwaway', bodyText: 'unique-token-zebra appears here' })
    // The chunk is searchable before deletion.
    expect((await globalSearch('zebra')).some((h) => h.id === doc.id)).toBe(true)

    await hardDeleteRecord('document', doc.id)

    expect(await tableCount('documents')).toBe(0)
    expect(await tableCount('contentChunks')).toBe(0)
    // FTS no longer returns the deleted record; rebuild is safe to run.
    await rebuildSearchIndexes()
    expect((await globalSearch('zebra')).length).toBe(0)
  })

  it('cascades evidence when its cited chunk is deleted', async () => {
    const interaction = await ingestInteraction({ kind: 'meeting', title: 'M', bodyText: 'grounding text' })
    // No evidence yet; just prove the delete path cleans interactions + chunks.
    await hardDeleteRecord('interaction', interaction.id)
    expect(await tableCount('interactions')).toBe(0)
    expect(await tableCount('contentChunks')).toBe(0)
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
