// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Alert } from './alert'
import { Loading } from './loading'

describe('feedback semantics', () => {
  it('announces loading politely', () => {
    render(<Loading />)

    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-atomic')).toBe('true')
    expect(status.textContent).toBe('Loading…')
  })

  it('announces errors and warnings assertively', () => {
    const { rerender } = render(<Alert variant="error">Save failed</Alert>)
    expect(screen.getByRole('alert').textContent).toBe('Save failed')

    rerender(<Alert variant="warning">Check this value</Alert>)
    expect(screen.getByRole('alert').textContent).toBe('Check this value')
  })

  it('announces informational and successful feedback politely', () => {
    const { rerender } = render(<Alert>Indexing started</Alert>)
    expect(screen.getByRole('status').textContent).toBe('Indexing started')

    rerender(<Alert variant="success">Saved</Alert>)
    expect(screen.getByRole('status').textContent).toBe('Saved')
  })
})
