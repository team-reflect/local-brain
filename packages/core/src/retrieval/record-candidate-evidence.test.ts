import { describe, expect, it } from 'vitest'
import {
  candidateQueryTerms,
  selectCandidateEvidence,
  type CandidateEvidenceHit,
} from './record-candidate-evidence'

function hit(
  chunkId: string,
  text: string,
  overrides: Partial<CandidateEvidenceHit> = {},
): CandidateEvidenceHit {
  return {
    chunkId,
    text,
    snippet: null,
    recordType: 'interaction',
    recordId: 'mortgage-thread',
    recordTitle: 'Mortgage email',
    recordDate: null,
    chunkIndex: Number(chunkId.replace(/\D/gu, '')) || 0,
    ...overrides,
  }
}

describe('record candidate evidence selection', () => {
  it('removes question glue before measuring term coverage', () => {
    expect(candidateQueryTerms('what is my mortgage rate and product')).toEqual([
      'mortgage',
      'rate',
      'product',
    ])
  })

  it('preserves one-character identifiers after common record labels', () => {
    expect(candidateQueryTerms('Project X')).toEqual(['project', 'x'])
    expect(candidateQueryTerms('Series A')).toEqual(['series', 'a'])
    expect(candidateQueryTerms('Room 7')).toEqual(['room', '7'])
    expect(candidateQueryTerms('Model S')).toEqual(['model', 's'])
    expect(candidateQueryTerms('Project D')).toEqual(['project', 'd'])
    expect(candidateQueryTerms('X budget')).toEqual(['budget'])
    expect(candidateQueryTerms('S')).toEqual([])
    expect(candidateQueryTerms('what is a project')).toEqual(['project'])
  })

  it('drops possessive and contraction fragments before selecting useful terms', () => {
    expect(candidateQueryTerms("what's my rate")).toEqual(['rate'])
    expect(candidateQueryTerms("don't show me the rate")).toEqual(['show', 'rate'])
    expect(candidateQueryTerms("Alex's project rate")).toEqual(['alex', 'project', 'rate'])
  })

  it('selects an answer after a semantic-sized pool of duplicate quoted chunks', () => {
    const repeated = 'Quoted history: mortgage rate product servicing reference.'
    const pool = Array.from({ length: 16 }, (_, index) =>
      hit(`chunk-${index}`, repeated, { contentHash: 'same-quote-hash' }),
    )
    pool.push(
      hit('chunk-16', 'QUOTED  HISTORY: mortgage rate product servicing reference.'),
      hit('chunk-17', 'J.P. Morgan confirms the mortgage interest rate is 5.125%.'),
    )

    const selected = selectCandidateEvidence(pool, 'what is my mortgage rate and product', 2)

    expect(selected.map((item) => item.hit.chunkId)).toContain('chunk-17')
    expect(selected.filter((item) => /servicing reference/iu.test(item.hit.text))).toHaveLength(1)
  })

  it('prefers generic query-linked fields over an uncertain conversational percentage', () => {
    const selected = selectCandidateEvidence([
      hit('conversation', 'Product: possibly an ARM\nRate: under 5% (uncertain conversational estimate)'),
      hit('fact', 'mortgage_interest_rate: 5.125%'),
      hit('terms', 'Product: 7y/6m ARM\nRate (locked with auto-debit): 5.125%'),
    ], 'what is my mortgage rate and product', 3)

    expect(selected.map((item) => [item.hit.chunkId, item.answerStrength])).toEqual([
      ['terms', 6],
      ['fact', 5],
      ['conversation', 3],
    ])
  })

  it('does not boost mortgage-shaped fields for an unrelated quantitative query', () => {
    const selected = selectCandidateEvidence([
      hit('mortgage', 'Product: 7y/6m ARM\nRate: 5.125%'),
      hit('portfolio', 'Portfolio: long-term account\nReturn: 12.4%'),
    ], 'what is my portfolio return', 2)

    expect(selected.map((item) => [item.hit.chunkId, item.answerStrength])).toEqual([
      ['portfolio', 6],
      ['mortgage', 3],
    ])
  })

  it('does not treat a prose-like numeric threshold as a query field', () => {
    const [selected] = selectCandidateEvidence([
      hit('threshold', '≤10% abnormal rate: $6.00 per review\n10–20% abnormal rate: $8.50 per review'),
    ], 'rate product', 1)

    expect(selected?.answerStrength).toBe(3)
  })

  it('reselects a stronger semantic answer instead of leaving it hidden behind lexical evidence', () => {
    const lexical = [
      hit('lexical-1', 'Mortgage product servicing guide and general rate history.'),
      hit('lexical-2', 'Mortgage rate product question submitted to the bank.'),
    ]
    const semantic = [
      hit('semantic-answer', 'Mortgage product: 7y/6m ARM\nRate: 5.125%'),
    ]

    const selected = selectCandidateEvidence(
      [...lexical, ...semantic],
      'what is my mortgage rate and product',
      2,
    )

    expect(selected.map((item) => item.hit.chunkId)).toContain('semantic-answer')
    expect(Math.max(...selected.map((item) => item.answerStrength))).toBe(6)
  })
})
