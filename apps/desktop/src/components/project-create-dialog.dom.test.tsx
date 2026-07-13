// @vitest-environment jsdom
import { useState, type ReactNode } from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { blockingModalOpen } from '../lib/commands/modal-guard'
import { installFakeBridge, renderWithProviders } from '../test/utils'
import { ProjectCreateDialog } from './project-create-dialog'

function Harness({
  onCreated,
  onClose,
}: {
  onCreated: (id: string) => void
  onClose: () => void
}): ReactNode {
  const [open, setOpen] = useState(true)
  return (
    <ProjectCreateDialog
      open={open}
      onClose={() => {
        onClose()
        setOpen(false)
      }}
      onCreated={onCreated}
    />
  )
}

describe('ProjectCreateDialog', () => {
  it('blocks dismissal and global shortcuts while creation is pending', async () => {
    let resolveWrite: (value: number) => void = () => {}
    const write = new Promise<number>((resolve) => {
      resolveWrite = resolve
    })
    const onClose = vi.fn()
    const onCreated = vi.fn<(id: string) => void>()
    installFakeBridge({
      respond: (command) => command === 'db_execute' ? write : undefined,
    })
    renderWithProviders(<Harness onClose={onClose} onCreated={onCreated} />)

    const name = await screen.findByLabelText('Name')
    await waitFor(() => expect(blockingModalOpen()).toBe(true))
    fireEvent.change(name, { target: { value: 'Launch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create' }).disabled).toBe(true)
    })

    fireEvent.keyDown(name, { key: 'Escape', code: 'Escape' })
    const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')
    expect(overlay).not.toBeNull()
    fireEvent.pointerDown(overlay!)
    fireEvent.click(overlay!)

    expect(screen.getByRole('dialog')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(blockingModalOpen()).toBe(true)

    await act(async () => resolveWrite(1))
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => expect(blockingModalOpen()).toBe(false))
  })
})
