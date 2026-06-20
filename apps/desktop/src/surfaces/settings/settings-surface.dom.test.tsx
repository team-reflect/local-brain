// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { setModelProvider } from '@local-brain/core'
import { SettingsSurface } from '.'
import { installFakeBridge, renderWithProviders } from '../../test/utils'

describe('SettingsSurface (Plan 08)', () => {
  beforeEach(() => {
    setModelProvider(null)
    installFakeBridge({ queryRows: [] })
  })

  it('does not expose backup & export settings', () => {
    renderWithProviders(<SettingsSurface section="backup" />)
    expect(screen.queryByText('Backup & export')).toBeNull()
    expect(screen.queryByText('Create backup')).toBeNull()
    expect(screen.queryByText('Export JSON')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'About' })).toBeDefined()
  })

  it('does not expose local database, skills, or diagnostics sections', () => {
    renderWithProviders(<SettingsSurface section={undefined} />)

    expect(screen.queryByRole('button', { name: 'Local database' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Skills' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Diagnostics' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Local database' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Skills' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Diagnostics' })).toBeNull()
  })

  it('renders the about section with the app version', async () => {
    renderWithProviders(<SettingsSurface section="about" />)

    expect(screen.getByRole('heading', { name: 'About' })).toBeDefined()
    expect(
      screen.getByText('Local Brain is a private, local-first, personal knowledge graph.'),
    ).toBeDefined()
    await waitFor(() => expect(screen.getByText('v0.1.0')).toBeDefined())
  })

  it('renders AI providers as a Reflect-style row card with an add dialog', async () => {
    renderWithProviders(<SettingsSurface section="ai-providers" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add provider' })).toBeDefined())
    expect(screen.getByText(/No AI providers configured/)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }))

    expect(await screen.findByRole('dialog', { name: 'Add AI provider' })).toBeDefined()
    expect(screen.getByText('Provider')).toBeDefined()
    expect(screen.getByText('Default model')).toBeDefined()
    expect(screen.getByText('API key')).toBeDefined()
  })

  it('shows manual semantic backfill as the primary action and keeps rebuild available', async () => {
    installFakeBridge({
      respond: (command) => {
        if (command === 'embed_status') {
          return { status: 'ready', model: 'all-MiniLM-L6-v2' }
        }
        return undefined
      },
      query: (sql, params) => {
        if (sql.includes('settings')) {
          const key = params[0]
          if (key === 'embeddings.enabled') return [{ valueJson: 'true' }]
          return []
        }
        if (sql.includes('chunk_embeddings')) return [{ count: 0 }]
        if (/count/i.test(sql)) return [{ count: 3 }]
        return []
      },
    })

    renderWithProviders(<SettingsSurface section="search" />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Backfill now' })).toBeDefined())
    expect(screen.getByRole('button', { name: 'Rebuild index' })).toBeDefined()
  })

  it('shows byte-level semantic model download progress', async () => {
    installFakeBridge({
      respond: (command) => {
        if (command === 'embed_status') {
          return { status: 'loading', progress: { downloaded: 45_000_000, total: 90_000_000 } }
        }
        return undefined
      },
      query: (sql, params) => {
        if (sql.includes('settings')) {
          const key = params[0]
          if (key === 'embeddings.enabled') return [{ valueJson: 'true' }]
          return []
        }
        if (sql.includes('chunk_embeddings')) return [{ count: 0 }]
        if (/count/i.test(sql)) return [{ count: 3 }]
        return []
      },
    })

    renderWithProviders(<SettingsSurface section="search" />)

    const bar = await screen.findByRole('progressbar', {
      name: 'Semantic search model download',
    })
    expect(bar.getAttribute('aria-valuenow')).toBe('50')
    expect(screen.getByText('Downloading the model — 45 MB of 90 MB')).toBeDefined()
  })

  it('shows an indeterminate semantic model preparation state before byte counts arrive', async () => {
    installFakeBridge({
      respond: (command) => {
        if (command === 'embed_status') {
          return { status: 'loading' }
        }
        return undefined
      },
      query: (sql, params) => {
        if (sql.includes('settings')) {
          const key = params[0]
          if (key === 'embeddings.enabled') return [{ valueJson: 'true' }]
          return []
        }
        if (sql.includes('chunk_embeddings')) return [{ count: 0 }]
        if (/count/i.test(sql)) return [{ count: 3 }]
        return []
      },
    })

    renderWithProviders(<SettingsSurface section="search" />)

    const bar = await screen.findByRole('progressbar', {
      name: 'Semantic search model download',
    })
    expect(bar.getAttribute('aria-valuenow')).toBeNull()
    expect(screen.getByText('Preparing the model...')).toBeDefined()
  })
})
