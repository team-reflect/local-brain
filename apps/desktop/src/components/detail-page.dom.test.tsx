// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DetailPage } from './detail-page'

describe('DetailPage', () => {
  it('announces the initial loading state', () => {
    render(
      <DetailPage query={{ isLoading: true, data: undefined }} notFoundTitle="Record not found">
        {() => <p>Record</p>}
      </DetailPage>,
    )

    expect(screen.getByRole('status').textContent).toBe('Loading…')
  })

  it('distinguishes a query failure from a missing record and retries', () => {
    const refetch = vi.fn()
    render(
      <DetailPage
        query={{
          isLoading: false,
          isError: true,
          error: new Error('Connection lost'),
          refetch,
          data: undefined,
        }}
        notFoundTitle="Person not found"
        errorTitle="Could not load person"
      >
        {() => <p>Person</p>}
      </DetailPage>,
    )

    expect(screen.getByRole('alert').textContent).toContain('Could not load person')
    expect(screen.getByRole('alert').textContent).toContain('Connection lost')
    expect(screen.queryByText('Person not found')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('uses the not-found state only after a successful empty result', () => {
    render(
      <DetailPage query={{ isLoading: false, isError: false, data: null }} notFoundTitle="Person not found">
        {() => <p>Person</p>}
      </DetailPage>,
    )

    expect(screen.getByText('Person not found')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps stale detail data visible while reporting a refresh error', () => {
    render(
      <DetailPage
        query={{
          isLoading: false,
          isError: true,
          error: new Error('Refresh failed'),
          data: { name: 'Cached person' },
        }}
        notFoundTitle="Person not found"
      >
        {(person) => <p>{person.name}</p>}
      </DetailPage>,
    )

    expect(screen.getByRole('alert').textContent).toContain('Refresh failed')
    expect(screen.getByText('Cached person')).toBeDefined()
  })
})
