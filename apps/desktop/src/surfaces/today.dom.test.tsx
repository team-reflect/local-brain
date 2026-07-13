// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { TodaySurface } from './today'
import { installFakeBridge, renderWithProviders } from '../test/utils'

const aiMocks = vi.hoisted(() => ({
  generateTodayDailyBrief: vi.fn(),
}))

vi.mock('../lib/ai/daily-brief', () => ({
  generateTodayDailyBrief: aiMocks.generateTodayDailyBrief,
}))

function savedDailyBriefRows(): unknown[] {
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
      promptFingerprint: 'today-daily-brief-v2',
      sourceId: null,
      metadataJson: null,
      generatedAt: '2026-06-21T16:00:00.000Z',
      createdAt: '2026-06-21T16:00:00.000Z',
      updatedAt: '2026-06-21T16:00:00.000Z',
    },
  ]
}

function installTodayBridge({ hasBrief }: { hasBrief: boolean }): void {
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
        return hasBrief ? savedDailyBriefRows() : []
      }
      return []
    },
  })
}

describe('TodaySurface daily brief', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiMocks.generateTodayDailyBrief.mockResolvedValue(savedDailyBriefRows()[0])
  })

  it('renders a saved daily brief and offers regeneration', async () => {
    installTodayBridge({ hasBrief: true })
    renderWithProviders(<TodaySurface />)

    expect(await screen.findByText('Focus:')).not.toBeNull()
    expect(screen.getByText('ship the launch checklist.')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Regenerate' })).not.toBeNull()
    expect(screen.getByText(/^Generated /)).not.toBeNull()
    expect(aiMocks.generateTodayDailyBrief).not.toHaveBeenCalled()
  })

  it('auto-generates when today has no saved brief', async () => {
    installTodayBridge({ hasBrief: false })
    renderWithProviders(<TodaySurface />)

    await waitFor(() => expect(aiMocks.generateTodayDailyBrief).toHaveBeenCalledTimes(1))
  })

  it('shows a rotating spinner while auto-generating', async () => {
    let resolveBrief: (value: unknown) => void = () => {}
    aiMocks.generateTodayDailyBrief.mockImplementation(
      () => new Promise((resolve) => {
        resolveBrief = resolve
      }),
    )
    installTodayBridge({ hasBrief: false })
    const { container } = renderWithProviders(<TodaySurface />)

    expect(await screen.findByRole('status', { name: 'Generating daily brief' })).not.toBeNull()
    expect(container.querySelector('.animate-spin')).not.toBeNull()

    resolveBrief(savedDailyBriefRows()[0])
  })

  it('shows only a retryable error when the brief cannot be loaded', async () => {
    let briefAttempts = 0
    installFakeBridge({
      query: (sql, params) => {
        const firstParam = params[0]
        if (firstParam === 'model.aiProviders') {
          return [{ valueJson: JSON.stringify([]) }]
        }
        if (firstParam === 'model.defaultAiProviderId') return []
        if (sql.includes('from "ai_notes"')) {
          briefAttempts += 1
          return briefAttempts === 1
            ? Promise.reject(new Error('daily brief unavailable'))
            : savedDailyBriefRows()
        }
        return []
      },
    })
    renderWithProviders(<TodaySurface />)

    expect(await screen.findByText('Could not load the daily brief.')).not.toBeNull()
    expect(screen.queryByText(/Generate a grounded brief/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Generate' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Focus:')).not.toBeNull()
    expect(briefAttempts).toBe(2)
  })

  it('keeps a stale brief visible when refreshing it fails', async () => {
    let briefAttempts = 0
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
          briefAttempts += 1
          return briefAttempts === 1
            ? savedDailyBriefRows()
            : Promise.reject(new Error('daily brief refresh failed'))
        }
        return []
      },
    })
    renderWithProviders(<TodaySurface />)

    expect(await screen.findByText('ship the launch checklist.')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))

    expect(await screen.findByText('Could not load the daily brief.')).not.toBeNull()
    expect(screen.getByText('ship the launch checklist.')).not.toBeNull()
    expect(screen.queryByText(/Generate a grounded brief/)).toBeNull()
    expect(briefAttempts).toBe(2)
  })
})
