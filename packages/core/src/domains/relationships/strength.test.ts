import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, nextReconnectAt, relationshipStrength } from './strength'

describe('relationship strength math', () => {
  it('returns null when there is no signal at all', () => {
    expect(relationshipStrength({ recentInteractions: 0, daysSinceLast: null, openTasks: 0 })).toBeNull()
  })

  it('scores a frequent, recent, collaborating contact at the top', () => {
    expect(relationshipStrength({ recentInteractions: 5, daysSinceLast: 5, openTasks: 3 })).toBe(5)
  })

  it('scores a lapsed, low-frequency contact near the bottom', () => {
    // 1 interaction (+1), last seen 200d ago (+0), no open tasks -> score 1.
    expect(relationshipStrength({ recentInteractions: 1, daysSinceLast: 200, openTasks: 0 })).toBe(1)
  })

  it('rewards recency in tiers', () => {
    const base = { recentInteractions: 1, openTasks: 0 }
    expect(relationshipStrength({ ...base, daysSinceLast: 10 })).toBe(3) // 1 + 3 = 4 -> 3
    expect(relationshipStrength({ ...base, daysSinceLast: 60 })).toBe(2) // 1 + 2 = 3 -> 2
    expect(relationshipStrength({ ...base, daysSinceLast: 150 })).toBe(2) // 1 + 1 = 2 -> 2
    expect(relationshipStrength({ ...base, daysSinceLast: 300 })).toBe(1) // 1 + 0 = 1 -> 1
  })

  it('still scores collaboration when there are no interactions', () => {
    // openTasks alone is a signal, so strength is not null.
    expect(relationshipStrength({ recentInteractions: 0, daysSinceLast: null, openTasks: 2 })).toBe(2)
  })

  it('computes next reconnect from the last interaction and cadence', () => {
    expect(nextReconnectAt('2026-04-01T00:00:00.000Z', 30)).toBe('2026-05-01T00:00:00.000Z')
    expect(nextReconnectAt(null, 30)).toBeNull()
    expect(nextReconnectAt('2026-04-01T00:00:00.000Z', null)).toBeNull()
  })

  it('does whole-day date math in UTC', () => {
    expect(daysBetween('2026-04-01T00:00:00.000Z', '2026-04-11T00:00:00.000Z')).toBe(10)
    expect(daysBetween('2026-04-11T00:00:00.000Z', '2026-04-01T00:00:00.000Z')).toBe(-10)
    expect(addDays('2026-04-01T12:00:00.000Z', 7)).toBe('2026-04-08T12:00:00.000Z')
  })
})
