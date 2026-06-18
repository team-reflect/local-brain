// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

// Mock the native dialog wrapper so the test never reaches the Tauri plugin
// (which would call into native code). "Browse…" should populate the folder.
// `vi.hoisted` keeps the spies usable inside the hoisted `vi.mock` factory.
const { pickBrainToCreate, pickBrainToOpen } = vi.hoisted(() => ({
  pickBrainToCreate: vi.fn<() => Promise<string | null>>(),
  pickBrainToOpen: vi.fn<() => Promise<string | null>>(),
}))
vi.mock('../lib/native-dialog', () => ({ pickBrainToCreate, pickBrainToOpen }))

import { BrainDialog } from './brain-dialog'
import { installFakeBridge, renderWithProviders } from '../test/utils'

const NEW_BRAIN = {
  rootPath: '/data/New',
  databasePath: '/data/New/brain.sqlite',
  assetsPath: '/data/New/assets',
  name: 'New',
  color: 'indigo',
  createdMs: 1,
  lastOpenedMs: 1,
  isActive: true,
  schemaVersion: 2,
}

describe('BrainDialog native picker', () => {
  beforeEach(() => {
    pickBrainToCreate.mockReset()
    pickBrainToOpen.mockReset()
  })

  it('fills the path from the native folder dialog and creates the brain', async () => {
    const captured: { command: string; args: Record<string, unknown> }[] = []
    installFakeBridge({
      respond: (command, args) => {
        captured.push({ command, args })
        return command === 'create_brain' ? NEW_BRAIN : undefined
      },
    })
    pickBrainToCreate.mockResolvedValue('/Users/me/Work')

    renderWithProviders(<BrainDialog open mode="create" onClose={() => {}} />)

    // Browsing runs the native folder dialog and writes its result into the field.
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await waitFor(() =>
      expect((screen.getByDisplayValue('/Users/me/Work') as HTMLInputElement).value).toBe(
        '/Users/me/Work',
      ),
    )

    // Creating then sends the chosen root path to Rust.
    fireEvent.click(screen.getByRole('button', { name: 'Create brain' }))
    await waitFor(() =>
      expect(
        captured.some(
          (call) =>
            call.command === 'create_brain' && call.args['rootPath'] === '/Users/me/Work',
        ),
      ).toBe(true),
    )
  })

  it('uses the open folder dialog in open mode', async () => {
    installFakeBridge({})
    pickBrainToOpen.mockResolvedValue('/Users/me/Existing')

    renderWithProviders(<BrainDialog open mode="open" onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await waitFor(() => expect(pickBrainToOpen).toHaveBeenCalled())
    expect(pickBrainToCreate).not.toHaveBeenCalled()
  })
})
