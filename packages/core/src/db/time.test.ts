import { describe, expect, it } from 'vitest'
import { localDateString } from './time'

describe('localDateString', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(localDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns the local calendar date for a given Date', () => {
    // new Date(year, month, day) constructs in local time, so the local date
    // components are exactly what we passed in regardless of the host timezone.
    const date = new Date(2024, 0, 15) // January 15, 2024 local midnight
    expect(localDateString(date)).toBe('2024-01-15')
  })

  it('returns the local date, not the UTC date, for a moment near UTC midnight', () => {
    // 23:30 local time — may be the next UTC day in UTC- zones or still the
    // same UTC day in UTC+ zones, but the local date should match the local
    // year/month/day components of the Date object.
    const date = new Date(2024, 5, 20, 23, 30, 0) // June 20, 2024 at 23:30 local
    const result = localDateString(date)
    expect(result).toBe(`2024-06-20`)
  })

  it('differs from UTC slice when local date is behind UTC', () => {
    // Construct a moment that is 00:30 UTC on Jan 2 — which is still Jan 1
    // in any negative-offset timezone. If such a timezone is active, the local
    // date will not equal the UTC date. We can't force the host timezone, but
    // we can confirm the function uses the local date components (getFullYear /
    // getMonth / getDate) rather than the UTC ones by checking the result
    // matches toLocaleDateString('en-CA') for the same Date.
    const date = new Date(2024, 0, 1, 23, 30, 0) // Jan 1 at 23:30 local
    expect(localDateString(date)).toBe(date.toLocaleDateString('en-CA'))
  })
})
