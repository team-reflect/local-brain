// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

// Mock the native dialog wrapper so the test never reaches the Tauri plugin
// (which would call into native code). "Browse…" should populate the path.
// `vi.hoisted` keeps the spies usable inside the hoisted `vi.mock` factory.
const { pickBrainToCreate, pickBrainToOpen } = vi.hoisted(() => ({
  pickBrainToCreate: vi.fn<() => Promise<string | null>>(),
  pickBrainToOpen: vi.fn<() => Promise<string | null>>(),
}))
vi.mock('../lib/native-dialog', () => ({ pickBrainToCreate, pickBrainToOpen }))

import { BrainDialog } from './brain-dialog'
import { installFakeBridge, renderWithProviders } from '../test/utils'

const NEW_BRAIN = {
  path: '/data/new.sqlite',
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

  it('fills the path from the native save dialog and creates the brain', async () => {
    const captured: { command: string; args: Record<string, unknown> }[] = []
    installFakeBridge({
      respond: (command, args) => {
        captured.push({ command, args })
        return command === 'create_brain' ? NEW_BRAIN : undefined
      },
    })
    pickBrainToCreate.mockResolvedValue('/Users/me/work.sqlite')

    renderWithProviders(<BrainDialog open mode="create" onClose={() => {}} />)

    // Browsing runs the native save dialog and writes its result into the field.
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await waitFor(() =>
      expect((screen.getByDisplayValue('/Users/me/work.sqlite') as HTMLInputElement).value).toBe(
        '/Users/me/work.sqlite',
      ),
    )

    // Creating then sends the chosen path to Rust.
    fireEvent.click(screen.getByRole('button', { name: 'Create brain' }))
    await waitFor(() =>
      expect(
        captured.some(
          (call) =>
            call.command === 'create_brain' && call.args['path'] === '/Users/me/work.sqlite',
        ),
      ).toBe(true),
    )
  })

  it('uses the open dialog (not the save dialog) in open mode', async () => {
    installFakeBridge({})
    pickBrainToOpen.mockResolvedValue('/Users/me/existing.sqlite')

    renderWithProviders(<BrainDialog open mode="open" onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await waitFor(() => expect(pickBrainToOpen).toHaveBeenCalled())
    expect(pickBrainToCreate).not.toHaveBeenCalled()
  })
})
