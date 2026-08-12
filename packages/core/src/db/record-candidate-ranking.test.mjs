// Retrieval-ranking regressions against the real launch SQLite schema and FTS triggers.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  createDocument,
  createInteraction,
  createPerson,
  db,
  newId,
  searchRecordCandidates,
} from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

describe('record candidate ranking (real SQLite)', () => {
  beforeEach(() => {
    installSqliteBridge(freshDatabase())
  })

  it('deduplicates quoted email chunks and keeps the answer-bearing rate passage', async () => {
    const interactionId = await createInteraction({
      kind: 'email',
      title: 'Gmail: JPMorgan Mortgage Application',
      occurredAt: '2026-01-23T09:00:00Z',
    })
    await db
      .deleteFrom('contentChunks')
      .where('recordType', '=', 'interaction')
      .where('recordId', '=', interactionId)
      .execute()

    const repeatedQuote = 'Quoted history: Rate product reference guide for account servicing.'
    const chunks = Array.from({ length: 10 }, (_, index) => ({
      id: newId(),
      recordType: 'interaction',
      recordId: interactionId,
      chunkIndex: index,
      text: repeatedQuote,
      contentHash: 'same-repeated-quote-hash',
    }))
    chunks.push(
      {
        id: newId(),
        recordType: 'interaction',
        recordId: interactionId,
        chunkIndex: chunks.length,
        text: 'QUOTED   HISTORY: Rate product reference guide for account servicing.',
        contentHash: 'whitespace-variant-hash',
      },
      {
        id: newId(),
        recordType: 'interaction',
        recordId: interactionId,
        chunkIndex: chunks.length + 1,
        text: `J.P. Morgan terms\nProduct: 7y/6m ARM\n${'Account servicing detail. '.repeat(13)}\nRate (locked with auto-debit): 5.125%`,
        contentHash: 'answer-passage-hash',
      },
    )
    await db.insertInto('contentChunks').values(chunks).execute()

    await createDocument({
      title: 'Corporate growth rate assumptions',
      bodyText: 'The growth rate assumptions are reviewed quarterly.',
    })
    await createDocument({
      title: 'Investment product catalogue',
      bodyText: 'The catalogue lists every investment product.',
    })
    await createInteraction({
      kind: 'email',
      title: 'Mortgage rate product question',
      bodyText: 'What is my mortgage rate and product?',
      occurredAt: '2026-08-12T09:00:00Z',
    })
    await createInteraction({
      kind: 'meeting',
      title: 'Today mortgage discussion',
      bodyText: 'Product: possibly an ARM\nRate: under 5% (uncertain conversational estimate)',
      occurredAt: '2026-08-12T10:00:00Z',
    })
    for (let index = 0; index < 24; index += 1) {
      await createInteraction({
        kind: 'note',
        title: `Mortgage rate product question ${index}`,
        occurredAt: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
      })
    }

    const result = await searchRecordCandidates('what is my mortgage rate and product', {
      mode: 'lexical',
      limit: 5,
    })
    const candidate = result.candidates.find((item) => item.recordRef === `interaction:${interactionId}`)

    expect(result.candidates[0]?.recordRef).toBe(`interaction:${interactionId}`)
    expect(candidate).toBeDefined()
    expect(candidate.evidence.some((evidence) => evidence.snippet.includes('5.125%'))).toBe(true)
    expect(
      candidate.evidence.filter((evidence) => /reference guide/iu.test(evidence.snippet)),
    ).toHaveLength(1)
  })

  it('ranks full useful-term coverage above an incidental labeled number', async () => {
    await createDocument({
      title: 'Incidental metric',
      bodyText: 'Total: 99.9%',
    })
    const completeMatch = await createDocument({
      title: 'Coverage note',
      bodyText: 'The vendor renewal total workflow is ready.',
    })

    const result = await searchRecordCandidates('vendor renewal total', {
      mode: 'lexical',
      recordTypes: ['document'],
      limit: 2,
    })

    expect(result.candidates[0]?.recordRef).toBe(`document:${completeMatch}`)
  })

  it('does not credit a query term that only appears inside a longer field token', async () => {
    await createDocument({
      title: 'Rateplan Project',
      summary: 'Rateplan terms are confirmed.',
    })
    const completeMatch = await createDocument({
      title: 'Project financing note',
      summary: 'Rate terms are confirmed.',
    })

    const result = await searchRecordCandidates('rate project', {
      mode: 'lexical',
      recordTypes: ['document'],
      limit: 2,
    })

    expect(result.candidates[0]?.recordRef).toBe(`document:${completeMatch}`)
  })

  it('does not let embedded title substrings crowd an exact summary token out of the direct limit', async () => {
    const completeMatch = await createDocument({
      title: 'Target financing note',
      summary: 'Rate terms are confirmed.',
    })
    for (let index = 0; index < 12; index += 1) {
      await createDocument({ title: `Corporate filing ${index}` })
    }

    const result = await searchRecordCandidates('rate', {
      mode: 'lexical',
      recordTypes: ['document'],
      limit: 1,
    })

    expect(result.candidates[0]?.recordRef).toBe(`document:${completeMatch}`)
    expect(result.candidates[0]?.matchReasons).toContain('summary')
    expect(result.candidates[0]?.matchReasons).not.toContain('title')
  })

  it('keeps multi-token title matches across ordinary punctuation', async () => {
    const phraseMatch = await createDocument({ title: 'North-Star launch plan' })
    await createDocument({
      title: 'North planning note',
      summary: 'A different star is under review.',
    })

    const result = await searchRecordCandidates('north star', {
      mode: 'lexical',
      recordTypes: ['document'],
      limit: 1,
    })

    expect(result.candidates[0]?.recordRef).toBe(`document:${phraseMatch}`)
    expect(result.candidates[0]?.matchReasons).toContain('title')
  })

  it('finds typed-only email local and domain tokens across punctuation before limiting', async () => {
    const personId = await createPerson({
      fullName: 'Typed Email Contact',
      primaryEmail: 'orchid@northwind.example',
    })
    for (let index = 0; index < 8; index += 1) {
      await createPerson({ fullName: `Recent Contact ${index}` })
    }

    for (const query of ['orchid', 'northwind']) {
      const result = await searchRecordCandidates(query, {
        mode: 'lexical',
        recordTypes: ['person'],
        limit: 1,
      })
      expect(result.candidates[0]?.recordRef).toBe(`person:${personId}`)
      expect(result.candidates[0]?.matchReasons).toContain('typed_field')
    }
  })

  it('finds a typed-only parenthesized phone area code before limiting', async () => {
    const personId = await createPerson({
      fullName: 'Typed Phone Contact',
      primaryPhone: '(415) 555-0199',
    })
    for (let index = 0; index < 8; index += 1) {
      await createPerson({ fullName: `Recent Phone Contact ${index}` })
    }

    const result = await searchRecordCandidates('415', {
      mode: 'lexical',
      recordTypes: ['person'],
      limit: 1,
    })

    expect(result.candidates[0]?.recordRef).toBe(`person:${personId}`)
    expect(result.candidates[0]?.matchReasons).toContain('typed_field')
  })

  it('uses exact FTS tokens for coverage before applying the lexical candidate limit', async () => {
    const completeMatch = await createDocument({
      title: 'Older target',
    })
    await db.deleteFrom('contentChunks')
      .where('recordType', '=', 'document')
      .where('recordId', '=', completeMatch)
      .execute()
    await db.insertInto('contentChunks').values({
      id: newId(),
      recordType: 'document',
      recordId: completeMatch,
      chunkIndex: 0,
      text: `${'Background context. '.repeat(2_000)} Rate project terms are confirmed.`,
    }).execute()
    for (let index = 0; index < 8; index += 1) {
      await createDocument({
        title: `Distractor ${index}`,
        bodyText: `Corporate ${'project '.repeat(20)}update for 2026.`,
      })
    }

    const result = await searchRecordCandidates('rate project', {
      mode: 'lexical',
      recordTypes: ['document'],
      limit: 1,
    })

    expect(result.candidates[0]?.recordRef).toBe(`document:${completeMatch}`)
  })

  it('uses one-character identifiers to distinguish Project X from distractors', async () => {
    const projectX = await createDocument({
      title: 'Target brief',
      bodyText: 'Project X launch plan.',
    })
    await createDocument({
      title: 'Distractor brief',
      bodyText: 'Project Y launch plan.',
    })

    const result = await searchRecordCandidates('Project X', {
      mode: 'lexical',
      recordTypes: ['document'],
      limit: 2,
    })

    expect(result.candidates[0]?.recordRef).toBe(`document:${projectX}`)
    expect(result.candidates[0]?.evidence[0]?.snippet.toLocaleLowerCase()).toMatch(/project.*x/u)
  })

  it('centers quantitative evidence excerpts on late currency, decimal, and integer values', async () => {
    const filler = 'Background context without another numeric value. '.repeat(10)
    const cases = [
      {
        query: 'vendor cost',
        value: '£12,345.67',
        id: await createDocument({
          title: 'Vendor cost analysis',
          bodyText: `Vendor cost analysis. ${filler}\nCost: £12,345.67`,
        }),
      },
      {
        query: 'conversion rate',
        value: '4.75',
        id: await createDocument({
          title: 'Conversion rate analysis',
          bodyText: `Conversion rate analysis. ${filler}\nRate: 4.75`,
        }),
      },
      {
        query: 'shipment total',
        value: '2400',
        id: await createDocument({
          title: 'Shipment total analysis',
          bodyText: `Shipment total analysis. ${filler}\nTotal: 2400`,
        }),
      },
    ]

    for (const item of cases) {
      const result = await searchRecordCandidates(item.query, {
        mode: 'lexical',
        recordTypes: ['document'],
        limit: 5,
      })
      const candidate = result.candidates.find((entry) => entry.recordRef === `document:${item.id}`)
      expect(candidate?.evidence[0]?.snippet).toContain(item.value)
      expect(candidate?.evidence[0]?.snippet.length).toBeLessThanOrEqual(322)
    }
  })
})
