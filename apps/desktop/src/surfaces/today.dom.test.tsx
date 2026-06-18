// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { TodaySurface } from './today'
import { installFakeBridge, renderWithProviders } from '../test/utils'

describe('TodaySurface reconnect section (Plan 05b)', () => {
  it('lists overdue reconnect suggestions from the derived columns', async () => {
    installFakeBridge({
      query: (sql) => {
        if (sql.includes('"people"."reconnect_interval_days" is not null')) {
          return [
            {
              id: 'p1',
              full_name: 'Jordan Lee',
              reconnect_interval_days: 21,
            },
          ]
        }
        if (sql.includes('max("interactions"."occurred_at")')) {
          return [{ last_at: '2026-04-01T00:00:00.000Z' }]
        }
        if (sql.includes('count(*)') && sql.includes('from "interactions"')) {
          return [{ n: 1 }]
        }
        if (sql.includes('count(*)') && sql.includes('from "tasks"')) {
          return [{ n: 0 }]
        }
        return []
      },
    })
    renderWithProviders(<TodaySurface />)

    expect(await screen.findByText('Reconnect')).toBeDefined()
    expect(await screen.findByText('Jordan Lee')).toBeDefined()
    expect(await screen.findByText(/last seen 2026-04-01/)).toBeDefined()
  })
})
