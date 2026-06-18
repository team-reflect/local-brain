// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { AddRecordDialog } from './add-record-dialog'
import { installFakeBridge, renderWithProviders } from '../test/utils'

describe('AddRecordDialog', () => {
  beforeEach(() => {
    // db_query (dedupe lookup + link lists) returns nothing; db_batch succeeds.
    installFakeBridge({ queryRows: [] })
  })

  it('renders compose fields and switches the saved record type', () => {
    renderWithProviders(<AddRecordDialog open initialType="document" onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Save document' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Interaction' }))
    expect(screen.getByRole('button', { name: 'Save interaction' })).toBeDefined()
  })

  it('requires text before saving', () => {
    const onClose = vi.fn()
    renderWithProviders(<AddRecordDialog open initialType="document" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save document' }))
    expect(screen.getByText('Add some text first.')).toBeDefined()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ingests pasted text and closes', async () => {
    const onClose = vi.fn()
    renderWithProviders(<AddRecordDialog open initialType="document" onClose={onClose} />)

    fireEvent.change(screen.getByPlaceholderText(/Paste a note/), {
      target: { value: 'A pasted note worth keeping.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save document' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows the folder import field in folder mode', () => {
    renderWithProviders(<AddRecordDialog open initialType="document" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Import folder' }))
    expect(screen.getByPlaceholderText('/Users/you/notes')).toBeDefined()
    expect(screen.getByRole('button', { name: /Scan/ })).toBeDefined()
  })
})
