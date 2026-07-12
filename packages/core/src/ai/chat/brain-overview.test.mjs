import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from '../../db/sqlite-harness.mjs'
import { loadChatBrainOverview } from './brain-overview.ts'

describe('loadChatBrainOverview', () => {
  beforeEach(() => installSqliteBridge(freshDatabase()))

  it('loads bounded record, date, vocabulary, self, and project context', async () => {
    await db
      .insertInto('people')
      .values({
        id: 'person-self',
        fullName: 'Alex Example',
        preferredName: 'Alex',
        headline: 'Builder',
        isSelf: 1,
        updatedAt: '2026-01-02T00:00:00.000Z',
      })
      .execute()
    await db
      .insertInto('projects')
      .values({ id: 'project-active', name: 'Atlas', status: 'active', targetDate: '2026-12-01' })
      .execute()
    await db
      .insertInto('projects')
      .values({ id: 'project-done', name: 'Done', status: 'done', completedOn: '2026-01-01' })
      .execute()
    await db
      .insertInto('interactions')
      .values([
        { id: 'interaction-1', kind: 'email', title: 'One', occurredAt: '2026-02-01T00:00:00.000Z' },
        { id: 'interaction-2', kind: 'email', title: 'Two', occurredAt: '2026-03-01T00:00:00.000Z' },
        { id: 'interaction-3', kind: 'meeting', title: 'Three', occurredAt: '2026-04-01T00:00:00.000Z' },
      ])
      .execute()
    await db.insertInto('tags').values({ id: 'tag-1', name: 'Priority', slug: 'priority' }).execute()
    await db
      .insertInto('taggings')
      .values([
        { id: 'tagging-1', tagId: 'tag-1', recordType: 'project', recordId: 'project-active' },
        { id: 'tagging-2', tagId: 'tag-1', recordType: 'interaction', recordId: 'interaction-1' },
      ])
      .execute()

    const overview = await loadChatBrainOverview()

    expect(overview.recordCounts).toMatchObject({ person: 1, project: 2, interaction: 3 })
    expect(overview.earliestRecordDate).toBe('2026-01-02T00:00:00.000Z')
    expect(overview.latestRecordDate).toBeTruthy()
    expect(overview.interactionKinds).toEqual([
      { value: 'email', count: 2 },
      { value: 'meeting', count: 1 },
    ])
    expect(overview.tags).toEqual([{ value: 'Priority', slug: 'priority', count: 2 }])
    expect(overview.self).toEqual({
      recordId: 'person-self',
      name: 'Alex Example',
      preferredName: 'Alex',
      headline: 'Builder',
    })
    expect(overview.activeProjects.map((project) => project.name)).toEqual(['Atlas'])
  })

  it('reports empty vocabularies without inventing defaults', async () => {
    const overview = await loadChatBrainOverview()

    expect(overview).toMatchObject({
      recordCounts: {},
      earliestRecordDate: null,
      latestRecordDate: null,
      interactionKinds: [],
      interactionKindsTruncated: false,
      tags: [],
      tagsTruncated: false,
      self: null,
      activeProjects: [],
    })
  })

  it('caps kind and tag vocabularies and reports truncation', async () => {
    for (let index = 0; index < 13; index += 1) {
      await db
        .insertInto('interactions')
        .values({ id: `interaction-${index}`, kind: `kind-${index}`, title: `Interaction ${index}` })
        .execute()
    }
    for (let index = 0; index < 21; index += 1) {
      await db
        .insertInto('tags')
        .values({ id: `tag-${index}`, name: `Tag ${index}`, slug: `tag-${index}` })
        .execute()
      await db
        .insertInto('taggings')
        .values({
          id: `tagging-${index}`,
          tagId: `tag-${index}`,
          recordType: 'interaction',
          recordId: 'interaction-0',
        })
        .execute()
    }

    const overview = await loadChatBrainOverview()

    expect(overview.interactionKinds).toHaveLength(12)
    expect(overview.interactionKindsTruncated).toBe(true)
    expect(overview.tags).toHaveLength(20)
    expect(overview.tagsTruncated).toBe(true)
  })
})
