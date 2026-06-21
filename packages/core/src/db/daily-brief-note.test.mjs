import { beforeEach, describe, expect, it } from 'vitest'
import { db, latestDailyBriefNote, saveDailyBriefNote } from '../index'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

describe('daily brief AI notes', () => {
  beforeEach(() => installSqliteBridge(freshDatabase()))

  it('stores the latest generated daily brief and indexes chunks', async () => {
    await saveDailyBriefNote({
      date: '2026-06-21',
      title: 'Daily brief - 2026-06-21',
      content: 'First brief.',
      model: 'openai/gpt-5.5',
      generatedAt: '2026-06-21T08:00:00.000Z',
    })
    await saveDailyBriefNote({
      date: '2026-06-21',
      title: 'Daily brief - 2026-06-21',
      content: 'Second brief.\n\n- Follow up on launch.',
      model: 'openai/gpt-5.5',
      generatedAt: '2026-06-21T09:00:00.000Z',
    })

    const latest = await latestDailyBriefNote('2026-06-21')
    expect(latest?.content).toBe('Second brief.\n\n- Follow up on launch.')
    expect(latest?.kind).toBe('daily_brief')
    expect(latest?.subjectType).toBe('daily_brief')
    expect(latest?.subjectId).toBe('2026-06-21')

    const chunks = await db
      .selectFrom('contentChunks')
      .select(['recordType', 'recordId', 'text'])
      .where('recordId', '=', latest?.id ?? '')
      .execute()
    expect(chunks).toEqual([
      {
        recordType: 'ai_note',
        recordId: latest?.id,
        text: 'Second brief.\n\n- Follow up on launch.',
      },
    ])
  })
})
