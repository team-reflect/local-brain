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

  it('shows update controls when the native bridge is available', () => {
    renderWithProviders(<SettingsSurface section="about" />)

    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDefined()
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

  it('shows CLI install status and installs the command', async () => {
    const commands: string[] = []
    installFakeBridge({
      respond: (command) => {
        commands.push(command)
        return undefined
      },
    })

    renderWithProviders(<SettingsSurface section="cli-agents" />)

    expect(await screen.findByRole('heading', { name: 'CLI & agents' })).toBeDefined()
    expect(await screen.findByText('brain command is not installed')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Install command' }))

    await waitFor(() => expect(screen.getByText('brain command is installed')).toBeDefined())
    expect(commands).toContain('cli_install')
  })

  it('shows CLI repair for a stale Local Brain symlink', async () => {
    installFakeBridge({
      respond: (command) => {
        if (command === 'cli_status') {
          return {
            supported: true,
            bundledPath: '/Applications/Local Brain.app/Contents/MacOS/brain',
            bundledVersion: 'brain 0.1.0',
            installTargetPath: '/Users/alex/.local/bin/brain',
            installTargetDir: '/Users/alex/.local/bin',
            targetDirOnPath: true,
            installedPath: '/Users/alex/Downloads/Local Brain.app/Contents/MacOS/brain',
            installedVersion: 'brain 0.0.9',
            installState: 'stale',
          }
        }
        return undefined
      },
    })

    renderWithProviders(<SettingsSurface section="cli-agents" />)

    expect(await screen.findByText('brain command needs repair')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Repair command' })).toBeDefined()
  })

  it('shows CLI conflicts without offering destructive install', async () => {
    installFakeBridge({
      respond: (command) => {
        if (command === 'cli_status') {
          return {
            supported: true,
            bundledPath: '/Applications/Local Brain.app/Contents/MacOS/brain',
            bundledVersion: 'brain 0.1.0',
            installTargetPath: '/Users/alex/.local/bin/brain',
            installTargetDir: '/Users/alex/.local/bin',
            targetDirOnPath: true,
            installedPath: null,
            installedVersion: null,
            installState: 'conflict',
          }
        }
        return undefined
      },
    })

    renderWithProviders(<SettingsSurface section="cli-agents" />)

    expect(await screen.findByText('brain command has a conflict')).toBeDefined()
    expect(screen.getByText(/Another file already exists/)).toBeDefined()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Install command' }).disabled).toBe(
      true,
    )
  })

  it('shows the PATH export when the CLI install dir is absent from PATH', async () => {
    installFakeBridge({
      respond: (command) => {
        if (command === 'cli_status') {
          return {
            supported: true,
            bundledPath: '/Applications/Local Brain.app/Contents/MacOS/brain',
            bundledVersion: 'brain 0.1.0',
            installTargetPath: '/Users/alex/.local/bin/brain',
            installTargetDir: '/Users/alex/.local/bin',
            targetDirOnPath: false,
            installedPath: null,
            installedVersion: null,
            installState: 'missing',
          }
        }
        return undefined
      },
    })

    renderWithProviders(<SettingsSurface section="cli-agents" />)

    expect(await screen.findByText('/Users/alex/.local/bin is not on PATH')).toBeDefined()
    expect(screen.getByText('export PATH="$HOME/.local/bin:$PATH"')).toBeDefined()
  })

  it('shows agent skill install status and installs the skill', async () => {
    const commands: string[] = []
    installFakeBridge({
      respond: (command) => {
        commands.push(command)
        return undefined
      },
    })

    renderWithProviders(<SettingsSurface section="cli-agents" />)

    expect(await screen.findByText('Agent skills are not installed')).toBeDefined()
    expect(screen.getByText('/Users/alex/.agents/skills/brain')).toBeDefined()
    expect(screen.getByText('/Users/alex/.agents/skills/brain-backfill')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Install skills' }))

    await waitFor(() => expect(screen.getByText('Agent skills are installed')).toBeDefined())
    expect(commands).toContain('skill_install')
  })

  it('shows agent skill repair for a stale managed install', async () => {
    installFakeBridge({
      respond: (command) => {
        if (command === 'skill_status') {
          return {
            supported: true,
            installTargetDir: '/Users/alex/.agents/skills',
            installState: 'stale',
            skills: [
              {
                id: 'brain',
                installTargetDir: '/Users/alex/.agents/skills/brain',
                bundledHash: 'abc123abc123abc123',
                installedHash: 'old123old123',
                installState: 'stale',
              },
              {
                id: 'brain-backfill',
                installTargetDir: '/Users/alex/.agents/skills/brain-backfill',
                bundledHash: 'def456def456def456',
                installedHash: 'def456def456def456',
                installState: 'current',
              },
            ],
          }
        }
        return undefined
      },
    })

    renderWithProviders(<SettingsSurface section="cli-agents" />)

    expect(await screen.findByText('Agent skills need repair')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Repair skills' })).toBeDefined()
  })

  it('offers install and remove actions for a partial managed skill install', async () => {
    installFakeBridge({
      respond: (command) => {
        if (command === 'skill_status') {
          return {
            supported: true,
            installTargetDir: '/Users/alex/.agents/skills',
            installState: 'missing',
            skills: [
              {
                id: 'brain',
                installTargetDir: '/Users/alex/.agents/skills/brain',
                bundledHash: 'abc123abc123abc123',
                installedHash: 'abc123abc123abc123',
                installState: 'current',
              },
              {
                id: 'brain-backfill',
                installTargetDir: '/Users/alex/.agents/skills/brain-backfill',
                bundledHash: 'def456def456def456',
                installedHash: null,
                installState: 'missing',
              },
            ],
          }
        }
        return undefined
      },
    })

    renderWithProviders(<SettingsSurface section="cli-agents" />)

    expect(await screen.findByText('Agent skills are not installed')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Install skills' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Remove skills' })).toBeDefined()
  })

  it('shows agent skill conflicts without offering destructive install', async () => {
    installFakeBridge({
      respond: (command) => {
        if (command === 'skill_status') {
          return {
            supported: true,
            installTargetDir: '/Users/alex/.agents/skills',
            installState: 'conflict',
            skills: [
              {
                id: 'brain',
                installTargetDir: '/Users/alex/.agents/skills/brain',
                bundledHash: 'abc123abc123abc123',
                installedHash: null,
                installState: 'conflict',
              },
              {
                id: 'brain-backfill',
                installTargetDir: '/Users/alex/.agents/skills/brain-backfill',
                bundledHash: 'def456def456def456',
                installedHash: null,
                installState: 'missing',
              },
            ],
          }
        }
        return undefined
      },
    })

    renderWithProviders(<SettingsSurface section="cli-agents" />)

    expect(await screen.findByText('Agent skills have a conflict')).toBeDefined()
    expect(screen.getByText(/Another skill already exists/)).toBeDefined()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Install skills' }).disabled).toBe(
      true,
    )
  })

  it('offers removal when a managed skill exists beside a conflicting sibling', async () => {
    installFakeBridge({
      respond: (command) => {
        if (command === 'skill_status') {
          return {
            supported: true,
            installTargetDir: '/Users/alex/.agents/skills',
            installState: 'conflict',
            skills: [
              {
                id: 'brain',
                installTargetDir: '/Users/alex/.agents/skills/brain',
                bundledHash: 'abc123abc123abc123',
                installedHash: 'abc123abc123abc123',
                installState: 'current',
              },
              {
                id: 'brain-backfill',
                installTargetDir: '/Users/alex/.agents/skills/brain-backfill',
                bundledHash: 'def456def456def456',
                installedHash: null,
                installState: 'conflict',
              },
            ],
          }
        }
        return undefined
      },
    })

    renderWithProviders(<SettingsSurface section="cli-agents" />)

    expect(await screen.findByText('Agent skills have a conflict')).toBeDefined()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Install skills' }).disabled).toBe(
      true,
    )
    expect(screen.getByRole('button', { name: 'Remove skills' })).toBeDefined()
  })

  it('removes a current managed agent skill', async () => {
    const commands: string[] = []
    installFakeBridge({
      respond: (command) => {
        commands.push(command)
        if (command === 'skill_status') {
          return {
            supported: true,
            installTargetDir: '/Users/alex/.agents/skills',
            installState: 'current',
            skills: [
              {
                id: 'brain',
                installTargetDir: '/Users/alex/.agents/skills/brain',
                bundledHash: 'abc123abc123abc123',
                installedHash: 'abc123abc123abc123',
                installState: 'current',
              },
              {
                id: 'brain-backfill',
                installTargetDir: '/Users/alex/.agents/skills/brain-backfill',
                bundledHash: 'def456def456def456',
                installedHash: 'def456def456def456',
                installState: 'current',
              },
            ],
          }
        }
        return undefined
      },
    })

    renderWithProviders(<SettingsSurface section="cli-agents" />)

    expect(await screen.findByText('Agent skills are installed')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Remove skills' }))

    await waitFor(() => expect(screen.getByText('Agent skills are not installed')).toBeDefined())
    expect(commands).toContain('skill_uninstall')
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
