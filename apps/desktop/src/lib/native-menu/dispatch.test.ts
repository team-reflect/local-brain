import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerCommands, resetCommands } from '../commands/registry'
import { dispatchMenuCommand, setMenuCommandDispatch } from './dispatch'

describe('native menu dispatch', () => {
  beforeEach(() => {
    resetCommands()
    setMenuCommandDispatch(null)
  })

  it('falls back to the command registry before AppShell mounts', () => {
    const run = vi.fn()
    registerCommands([{ id: 'dev.toggleDevtools', title: 'Developer tools', run }])

    dispatchMenuCommand('dev.toggleDevtools')

    expect(run).toHaveBeenCalledOnce()
  })

  it('uses the mounted dispatcher when AppShell provides one', () => {
    const run = vi.fn()
    const mountedDispatch = vi.fn(() => false)
    registerCommands([{ id: 'dev.toggleDevtools', title: 'Developer tools', run }])
    setMenuCommandDispatch(mountedDispatch)

    dispatchMenuCommand('dev.toggleDevtools')

    expect(mountedDispatch).toHaveBeenCalledWith('dev.toggleDevtools')
    expect(run).not.toHaveBeenCalled()
  })
})
