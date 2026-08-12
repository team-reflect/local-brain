import type { InternalCandidateEvidenceHit } from './record-candidate-types'

const QUESTION_WORDS = new Set([
  'a', 'an', 'and', 'are', 'can', 'did', 'do', 'does', 'for', 'from', 'how', 'i', 'in',
  'is', 'it', 'me', 'my', 'of', 'on', 'the', 'to', 'was', 'what', 'when', 'where',
  'which', 'who', 'with', 'would',
])
const IDENTIFIER_LABELS = new Set([
  'class', 'model', 'phase', 'project', 'room', 'series', 'type',
])
const CONTRACTION_SUFFIX = /['’](?:d|ll|m|re|s|t|ve)$/u
const QUANTITATIVE_TERMS = new Set([
  'amount', 'apr', 'apy', 'balance', 'cost', 'interest', 'number', 'percent',
  'percentage', 'price', 'rate', 'rates', 'return', 'returns', 'total', 'yield', 'yields',
])
const NUMBER_PATTERN = /\b\d[\d,]*(?:\.\d+)?\b/u
const DECIMAL_PATTERN = /\b\d[\d,]*\.\d+\b/u
const STRONG_VALUE_PATTERN = /(?:[$£€]\s*\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s*%|\b\d[\d,]*(?:\.\d+)?\s*(?:usd|gbp|eur)\b)/iu
const KEY_VALUE_LINE_PATTERN = /(?:^|[\r\n])\s*(?:[-*•]\s*)?["']?([^:=\r\n]{1,120}?)["']?\s*[:=]\s*([^\r\n]*)/gmu
const DIRECT_NUMERIC_VALUE_PATTERN = /^(?:[*_`~"']*\s*)?(?:[$£€]\s*)?\d[\d,]*(?:\.\d+)?(?:\s*(?:%|usd|gbp|eur))?/iu

export type CandidateEvidenceHit = InternalCandidateEvidenceHit

export interface RankedCandidateEvidenceHit {
  hit: CandidateEvidenceHit
  normalizedText: string
  tokens: ReadonlySet<string>
  matchedTerms: string[]
  termMatches: number
  answerStrength: number
  answerValueStart: number | null
  answerValueEnd: number | null
  rank: number
}

/** Drop conversational glue while retaining every useful unique query term. */
export function candidateQueryTerms(query: string): string[] {
  const contracted = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []
  const all = contracted.map((term) => {
    const suffix = CONTRACTION_SUFFIX.exec(term)
    if (!suffix) return term
    let stem = term.slice(0, suffix.index)
    if (suffix[0].endsWith('t') && stem.endsWith('n')) {
      stem = stem.slice(0, -1)
      if (stem === 'ca') return 'can'
      if (stem === 'wo') return 'will'
    }
    return stem
  }).filter(Boolean)
  const useful = all.filter((term, index) => {
    if (term.length > 1) return !QUESTION_WORDS.has(term)
    return index > 0 && IDENTIFIER_LABELS.has(all[index - 1] ?? '')
  })
  const fallback = all.filter((term) => term.length > 1)
  return [...new Set(useful.length > 0 ? useful : fallback)]
}

/** Whether a numeric value is likely to be an answer rather than incidental text. */
export function hasQuantitativeIntent(query: string, terms = candidateQueryTerms(query)): boolean {
  return terms.some((term) => QUANTITATIVE_TERMS.has(term)) || NUMBER_PATTERN.test(query)
}

/** Normalize evidence for content-level duplicate checks across distinct chunk ids. */
export function normalizedEvidenceText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase().trim().replace(/\s+/gu, ' ')
}

function evidenceTokens(text: string): ReadonlySet<string> {
  return new Set(normalizedEvidenceText(text).match(/[\p{L}\p{N}]+/gu) ?? [])
}

function matchingEvidenceTerms(tokens: ReadonlySet<string>, terms: readonly string[]): string[] {
  return terms.filter((term) => tokens.has(term))
}

interface AnswerShape {
  strength: number
  valueStart: number | null
  valueEnd: number | null
}

function quantitativeValue(text: string): AnswerShape {
  const strong = STRONG_VALUE_PATTERN.exec(text)
  if (strong) {
    return { strength: 3, valueStart: strong.index, valueEnd: strong.index + strong[0].length }
  }
  const decimal = DECIMAL_PATTERN.exec(text)
  if (decimal) {
    return { strength: 2, valueStart: decimal.index, valueEnd: decimal.index + decimal[0].length }
  }
  const number = NUMBER_PATTERN.exec(text)
  return number
    ? { strength: 1, valueStart: number.index, valueEnd: number.index + number[0].length }
    : { strength: 0, valueStart: null, valueEnd: null }
}

function structuredAnswerShape(text: string, terms: readonly string[]): AnswerShape {
  let linkedFields = 0
  let bestValue: AnswerShape = { strength: 0, valueStart: null, valueEnd: null }
  for (const match of text.matchAll(KEY_VALUE_LINE_PATTERN)) {
    const coreLabel = match[1]?.replace(/\([^\r\n)]*\)/gu, ' ') ?? ''
    const labelTokens = new Set(
      (coreLabel.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
        .filter((token) => !/^\d+$/u.test(token)),
    )
    const matchingTerms = terms.filter((term) => labelTokens.has(term))
    if (matchingTerms.length < 2 && matchingTerms.length * 2 <= labelTokens.size) continue
    linkedFields += 1
    const rawValue = match[2] ?? ''
    const directValue = DIRECT_NUMERIC_VALUE_PATTERN.exec(rawValue.trimStart())
    if (!directValue) continue
    const valueShape = quantitativeValue(directValue[0])
    if (valueShape.strength <= bestValue.strength) continue
    const rawOffset = match[0].lastIndexOf(rawValue) + rawValue.length - rawValue.trimStart().length
    const valueStart = (match.index ?? 0) + rawOffset + (valueShape.valueStart ?? 0)
    bestValue = {
      strength: valueShape.strength,
      valueStart,
      valueEnd: valueStart + (valueShape.valueEnd ?? 0) - (valueShape.valueStart ?? 0),
    }
  }
  if (bestValue.strength === 0) return bestValue
  return { ...bestValue, strength: linkedFields >= 2 ? 6 : 5 }
}

function answerShape(
  text: string,
  quantitativeIntent: boolean,
  terms: readonly string[],
): AnswerShape {
  if (!quantitativeIntent) return { strength: 0, valueStart: null, valueEnd: null }
  const structured = structuredAnswerShape(text, terms)
  return structured.strength > 0 ? structured : quantitativeValue(text)
}

function tokenSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const token of left) {
    if (right.has(token)) intersection += 1
  }
  return intersection / (left.size + right.size - intersection)
}

function compareEvidenceHits(
  left: RankedCandidateEvidenceHit,
  right: RankedCandidateEvidenceHit,
): number {
  return (
    right.termMatches - left.termMatches ||
    right.answerStrength - left.answerStrength ||
    (left.hit.bm25 ?? 0) - (right.hit.bm25 ?? 0) ||
    left.rank - right.rank
  )
}

/**
 * Pick a bounded set of query-relevant, content-unique, textually diverse
 * passages. Content hashes remove byte-identical quoted history; normalized
 * text catches equivalent legacy or independently projected chunks.
 */
export function selectCandidateEvidence(
  hits: readonly CandidateEvidenceHit[],
  query: string,
  limit: number,
): RankedCandidateEvidenceHit[] {
  const terms = candidateQueryTerms(query)
  const quantitativeIntent = hasQuantitativeIntent(query, terms)
  const ranked = hits
    .map((hit, rank): RankedCandidateEvidenceHit => {
      const normalizedText = normalizedEvidenceText(hit.text)
      const tokens = evidenceTokens(normalizedText)
      const matchedTerms = matchingEvidenceTerms(tokens, terms)
      const answer = answerShape(hit.text, quantitativeIntent, terms)
      return {
        hit,
        normalizedText,
        tokens,
        matchedTerms,
        termMatches: matchedTerms.length,
        answerStrength: answer.strength,
        answerValueStart: answer.valueStart,
        answerValueEnd: answer.valueEnd,
        rank,
      }
    })
    .sort(compareEvidenceHits)

  const unique: RankedCandidateEvidenceHit[] = []
  const seenHashes = new Set<string>()
  const seenTexts = new Set<string>()
  for (const item of ranked) {
    const hash = item.hit.contentHash?.trim()
    if ((hash && seenHashes.has(hash)) || seenTexts.has(item.normalizedText)) continue
    if (hash) seenHashes.add(hash)
    seenTexts.add(item.normalizedText)
    unique.push(item)
  }

  const selected: RankedCandidateEvidenceHit[] = []
  for (const item of unique) {
    if (selected.length >= limit) break
    if (selected.some((existing) => tokenSimilarity(existing.tokens, item.tokens) >= 0.82)) continue
    selected.push(item)
  }
  return selected
}
