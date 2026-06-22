import { describe, expect, it } from 'vitest'
import { parseSearchQuery } from './search-query'

describe('parseSearchQuery', () => {
  it('returns empty text and filters for blank input', () => {
    expect(parseSearchQuery('   ')).toEqual({ text: '', tagFilters: [] })
  })

  it('leaves plain text untouched', () => {
    expect(parseSearchQuery('budget revised plan')).toEqual({
      text: 'budget revised plan',
      tagFilters: [],
    })
  })

  it('parses exact tag filters', () => {
    expect(parseSearchQuery('#Travel #project-alpha')).toEqual({
      text: '',
      tagFilters: ['travel', 'project-alpha'],
    })
  })

  it('ANDs repeated tag filters only once', () => {
    expect(parseSearchQuery('#travel #travel receipts')).toEqual({
      text: 'receipts',
      tagFilters: ['travel'],
    })
  })

  it('keeps malformed hash tokens as search text', () => {
    expect(parseSearchQuery('# travel ##work #! #- #_ #/')).toEqual({
      text: '# travel ##work #! #- #_ #/',
      tagFilters: [],
    })
  })

  it('keeps space-containing tag names as plain text', () => {
    expect(parseSearchQuery('Project Alpha')).toEqual({
      text: 'Project Alpha',
      tagFilters: [],
    })
  })
})
