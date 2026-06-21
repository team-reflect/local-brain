// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { TodaySurface } from './today'
import { installFakeBridge, renderWithProviders } from '../test/utils'

describe('TodaySurface daily brief', () => {
  beforeEach(() => {
    installFakeBridge({
      query: (sql, params) => {
        const firstParam = params[0]
        if (firstParam === 'model.aiProviders') {
          return [
            {
              valueJson: JSON.stringify([
                { id: 'provider-1', provider: 'openai', model: 'gpt-5.5', keyHint: '12345' },
              ]),
            },
          ]
        }
        if (firstParam === 'model.defaultAiProviderId') {
          return [{ valueJson: JSON.stringify('provider-1') }]
        }
        if (sql.includes('from "ai_notes"')) {
          return [
            {
              id: 'note-1',
              kind: 'daily_brief',
              interactionId: null,
              documentId: null,
              subjectType: 'daily_brief',
              subjectId: '2026-06-21',
              title: 'Daily brief - 2026-06-21',
              content: '**Focus:** ship the launch checklist.',
              contentFormat: 'markdown',
              model: 'openai/gpt-5.5',
              promptFingerprint: 'today-daily-brief-v1',
              sourceId: null,
              metadataJson: null,
              generatedAt: '2026-06-21T16:00:00.000Z',
              createdAt: '2026-06-21T16:00:00.000Z',
              updatedAt: '2026-06-21T16:00:00.000Z',
            },
          ]
        }
        return []
      },
    })
  })

  it('renders a saved daily brief and offers regeneration', async () => {
    renderWithProviders(<TodaySurface />)

    expect(await screen.findByText('Focus:')).not.toBeNull()
    expect(screen.getByText('ship the launch checklist.')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Regenerate' })).not.toBeNull()
  })
})
