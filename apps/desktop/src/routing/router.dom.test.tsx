// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, type RenderResult } from '@testing-library/react'
import { routeToPath } from './route'
import { RouterProvider, useRouter } from './router'

function RouterHarness() {
  const router = useRouter()
  return (
    <>
      <output data-testid="route">{routeToPath(router.route)}</output>
      <button type="button" onClick={() => router.navigate({ kind: 'tasks' })}>
        Tasks
      </button>
      <button type="button" onClick={() => router.navigate({ kind: 'projects' })}>
        Projects
      </button>
      <button type="button" disabled={!router.canBack} onClick={router.back}>
        Back
      </button>
      <button type="button" disabled={!router.canForward} onClick={router.forward}>
        Forward
      </button>
    </>
  )
}

function renderRouter(): RenderResult {
  return render(
    <RouterProvider>
      <RouterHarness />
    </RouterProvider>,
  )
}

beforeEach(() => {
  window.history.replaceState({ preserved: true }, '', '/today')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RouterProvider browser history', () => {
  it('handles the first popstate after navigation and restores forward state', async () => {
    renderRouter()

    await waitFor(() => expect(window.history.state.preserved).toBe(true))
    const todayState = window.history.state

    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
    expect(screen.getByTestId('route').textContent).toBe('/tasks')
    expect(window.location.pathname).toBe('/tasks')
    const tasksState = window.history.state

    window.history.replaceState(todayState, '', '/today')
    fireEvent.popState(window, { state: todayState })

    expect(screen.getByTestId('route').textContent).toBe('/today')
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Forward' }) as HTMLButtonElement).disabled).toBe(false)

    window.history.replaceState(tasksState, '', '/tasks')
    fireEvent.popState(window, { state: tasksState })

    expect(screen.getByTestId('route').textContent).toBe('/tasks')
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Forward' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('delegates in-app Back and Forward controls to the browser stack', () => {
    const browserBack = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const browserForward = vi.spyOn(window.history, 'forward').mockImplementation(() => {})
    renderRouter()

    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
    const tasksState = window.history.state
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }))
    const projectsState = window.history.state

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(browserBack).toHaveBeenCalledOnce()
    expect(screen.getByTestId('route').textContent).toBe('/projects')

    window.history.replaceState(tasksState, '', '/tasks')
    fireEvent.popState(window, { state: tasksState })
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
    expect(browserForward).toHaveBeenCalledOnce()

    window.history.replaceState(projectsState, '', '/projects')
    fireEvent.popState(window, { state: projectsState })
    expect(screen.getByTestId('route').textContent).toBe('/projects')
  })

  it('adopts an unmarked popstate without pushing a duplicate entry', () => {
    const pushState = vi.spyOn(window.history, 'pushState')
    renderRouter()

    const externalState = { external: true }
    window.history.replaceState(externalState, '', '/projects')
    fireEvent.popState(window, { state: externalState })

    expect(screen.getByTestId('route').textContent).toBe('/projects')
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true)
    expect(pushState).not.toHaveBeenCalled()
  })

  it('does not let a stale provider session collide with a fresh history index', () => {
    const first = renderRouter()
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
    const staleTasksState = window.history.state
    first.unmount()

    window.history.replaceState({ freshWorkspace: true }, '', '/today')
    renderRouter()
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(false)

    window.history.replaceState(staleTasksState, '', '/tasks')
    fireEvent.popState(window, { state: staleTasksState })

    expect(screen.getByTestId('route').textContent).toBe('/tasks')
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Forward' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
