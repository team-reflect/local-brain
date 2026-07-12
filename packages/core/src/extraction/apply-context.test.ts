import { describe, expect, it } from 'vitest'
import { ApplyContext } from './apply-context'
import type { SourceLinks } from './apply-store'

function emptyLinks(): SourceLinks {
  return { person: new Set(), organization: new Set(), project: new Set(), task: new Set() }
}

function makeContext(minConfidence: number): ApplyContext {
  return new ApplyContext(
    { recordType: 'document', recordId: 'doc1' },
    minConfidence,
    { people: [], organizations: [], projects: [] },
    emptyLinks(),
    new Map(),
  )
}

describe('ApplyContext.accepts', () => {
  it('writes entities at or above the threshold and ones with no confidence', () => {
    const ctx = makeContext(0.5)
    expect(ctx.accepts(0.5)).toBe(true)
    expect(ctx.accepts(0.9)).toBe(true)
    expect(ctx.accepts(null)).toBe(true)
    expect(ctx.accepts(undefined)).toBe(true)
    expect(ctx.accepts(0.49)).toBe(false)
  })

  it('writes everything at the default threshold of 0', () => {
    const ctx = makeContext(0)
    expect(ctx.accepts(0)).toBe(true)
    expect(ctx.accepts(0.01)).toBe(true)
  })
})

describe('ApplyContext.hasUnresolved', () => {
  it('is false when every non-null ref resolved', () => {
    const ctx = makeContext(0)
    ctx.resolve('p1', 'person', 'id1')
    expect(ctx.hasUnresolved(['p1', null, undefined])).toBe(false)
  })

  it('is true when any non-null ref is missing from resolved', () => {
    const ctx = makeContext(0)
    ctx.resolve('p1', 'person', 'id1')
    expect(ctx.hasUnresolved(['p1', 'p2'])).toBe(true)
  })
})

describe('ApplyContext.suggest', () => {
  it('captures held-back entities with normalized null fields', () => {
    const ctx = makeContext(0.5)
    ctx.suggest('task', undefined, 'Ship it', undefined)
    expect(ctx.summary.suggestions).toEqual([
      { kind: 'task', ref: null, label: 'Ship it', confidence: null },
    ])
  })
})

describe('ApplyContext.statements', () => {
  it('emits buckets in FK-dependency order', () => {
    const ctx = makeContext(0)
    // Tag each bucket with a sentinel so we can assert the emit order.
    ctx.inserts.evidence.push('evidence' as unknown as never)
    ctx.inserts.people.push('people' as unknown as never)
    ctx.inserts.memories.push('memories' as unknown as never)
    ctx.inserts.contentChunks.push('content-chunks' as unknown as never)
    ctx.inserts.tasks.push('tasks' as unknown as never)
    expect(ctx.statements()).toEqual(['people', 'tasks', 'memories', 'content-chunks', 'evidence'])
  })
})
