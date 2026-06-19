// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Checkbox } from './checkbox'

describe('Checkbox', () => {
  it('exposes an accessible checkbox role and reports toggles', () => {
    const onCheckedChange = vi.fn()
    render(<Checkbox checked={false} aria-label="Use as the default provider" onCheckedChange={onCheckedChange} />)

    const box = screen.getByRole('checkbox', { name: 'Use as the default provider' })
    expect(box.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(box)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('reflects the controlled checked state for assistive tech', () => {
    render(<Checkbox checked aria-label="Complete task" onCheckedChange={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Complete task' }).getAttribute('aria-checked')).toBe('true')
  })

  it('lets a consumer stop click propagation so a clickable row is not also activated', () => {
    // This is the exact pattern the Tasks table relies on: toggling a row's
    // checkbox must complete the task without triggering the row's navigate.
    const onRowClick = vi.fn()
    render(
      <div onClick={onRowClick}>
        <Checkbox
          checked={false}
          aria-label="Complete task"
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={() => {}}
        />
      </div>,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete task' }))
    expect(onRowClick).not.toHaveBeenCalled()
  })
})
