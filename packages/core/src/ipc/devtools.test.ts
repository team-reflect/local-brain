import { describe, expect, it } from 'vitest'
import { captureBridge } from '../test/bridge'
import { toggleDevtools } from './devtools'

describe('devtools IPC bindings', () => {
  it('toggles the native Web Inspector', async () => {
    const calls = captureBridge(null)
    await toggleDevtools()
    expect(calls).toEqual([{ command: 'toggle_devtools', args: {} }])
  })
})
