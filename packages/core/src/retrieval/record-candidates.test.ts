import { describe, expect, it } from 'vitest'
import { newInternalCandidate, type InternalCandidateEvidenceHit } from './record-candidate-types'
import { fuseRecordLists } from './record-candidates'

function evidence(chunkId: string, text: string, chunkIndex: number): InternalCandidateEvidenceHit {
  return {
    chunkId,
    text,
    snippet: text,
    recordType: 'interaction',
    recordId: 'mortgage-thread',
    recordTitle: 'Mortgage email',
    recordDate: null,
    chunkIndex,
  }
}

describe('record candidate fusion', () => {
  it('reselects visible evidence when a semantic answer follows two weaker lexical chunks', () => {
    const query = 'what is my mortgage rate and product'
    const lexicalHits = [
      evidence('lexical-1', 'Mortgage rate product servicing guide.', 0),
      evidence('lexical-2', 'Mortgage rate product question for the bank.', 1),
    ]
    const semanticAnswer = evidence(
      'semantic-answer',
      'Mortgage terms\nProduct: 7y/6m ARM\nRate: 5.125%',
      2,
    )
    const lexical = newInternalCandidate(
      'interaction',
      'mortgage-thread',
      'Mortgage email',
      null,
      ['chunk_lexical'],
    )
    lexical.evidencePool = lexicalHits
    lexical.evidence = lexicalHits.map((hit) => ({
      chunkId: hit.chunkId,
      chunkIndex: hit.chunkIndex,
      snippet: hit.text,
    }))
    lexical.matchedTerms = ['mortgage', 'rate', 'product']
    lexical.termMatches = 3

    const semantic = newInternalCandidate(
      'interaction',
      'mortgage-thread',
      'Mortgage email',
      null,
      ['chunk_semantic'],
    )
    semantic.evidencePool = [semanticAnswer]
    semantic.evidence = [{
      chunkId: semanticAnswer.chunkId,
      chunkIndex: semanticAnswer.chunkIndex,
      snippet: semanticAnswer.text,
    }]
    semantic.matchedTerms = ['mortgage', 'rate', 'product']
    semantic.termMatches = 3
    semantic.answerStrength = 6

    const [result] = fuseRecordLists([[lexical], [semantic]], 'relevance', query)

    expect(result?.evidence).toHaveLength(2)
    expect(result?.evidence.map((item) => item.chunkId)).toContain('semantic-answer')
    expect(result?.evidence.find((item) => item.chunkId === 'semantic-answer')?.snippet).toContain('5.125%')
  })
})
