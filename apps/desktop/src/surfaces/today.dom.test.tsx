// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { TodaySurface } from './today'
import { installFakeBridge, renderWithProviders } from '../test/utils'

describe('TodaySurface reconnect section (Plan 05b)', () => {
  it('lists overdue reconnect suggestions from the derived columns', async () => {
    installFakeBridge({
      query: (sql) =>
        sql.includes('next_reconnect_at')
          ? [
              {
                id: 'p1',
                full_name: 'Jordan Lee',
                relationship_strength: 3,
                last_interaction_at: '2026-04-01T00:00:00.000Z',
                next_reconnect_at: '2026-04-22T00:00:00.000Z',
              },
            ]
          : [],
    })
    renderWithProviders(<TodaySurface />)

    expect(await screen.findByText('Reconnect')).toBeDefined()
    expect(await screen.findByText('Jordan Lee')).toBeDefined()
    expect(await screen.findByText(/last seen 2026-04-01/)).toBeDefined()
  })
})
