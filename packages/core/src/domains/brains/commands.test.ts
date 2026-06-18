import { describe, expect, it } from 'vitest'
import {
  activeBrain,
  createBrain,
  forgetBrain,
  listBrains,
  openBrain,
  renameBrain,
  setBrainColor,
} from './commands'
import { brainInfoSchema } from './schema'
import { captureBridge } from '../../test/bridge'

const SAMPLE = {
  path: '/data/local-brain/brain.sqlite',
  name: 'My brain',
  color: 'indigo',
  createdMs: 1,
  lastOpenedMs: 2,
  isActive: true,
  schemaVersion: 2,
}

describe('brain IPC bindings', () => {
  it('list and active validate the BrainInfo shape', async () => {
    captureBridge([SAMPLE])
    const brains = await listBrains()
    expect(brains).toHaveLength(1)
    expect(brains[0]?.name).toBe('My brain')

    captureBridge(SAMPLE)
    expect((await activeBrain()).isActive).toBe(true)
  })

  it('create passes a null name when none is given', async () => {
    const calls = captureBridge(SAMPLE)
    await createBrain('/tmp/work.sqlite')
    expect(calls[0]).toEqual({
      command: 'create_brain',
      args: { path: '/tmp/work.sqlite', name: null },
    })
  })

  it('open / rename / color / forget forward their args', async () => {
    let calls = captureBridge(SAMPLE)
    await openBrain('/tmp/work.sqlite')
    expect(calls[0]).toEqual({ command: 'open_brain', args: { path: '/tmp/work.sqlite' } })

    calls = captureBridge(SAMPLE)
    await renameBrain('/tmp/work.sqlite', 'Work')
    expect(calls[0]).toEqual({
      command: 'rename_brain',
      args: { path: '/tmp/work.sqlite', name: 'Work' },
    })

    calls = captureBridge(SAMPLE)
    await setBrainColor('/tmp/work.sqlite', 'teal')
    expect(calls[0]).toEqual({
      command: 'set_brain_color',
      args: { path: '/tmp/work.sqlite', color: 'teal' },
    })

    calls = captureBridge([])
    await forgetBrain('/tmp/work.sqlite')
    expect(calls[0]).toEqual({ command: 'forget_brain', args: { path: '/tmp/work.sqlite' } })
  })

  it('an unknown color degrades to the default rather than throwing', () => {
    const parsed = brainInfoSchema.parse({ ...SAMPLE, color: 'chartreuse' })
    expect(parsed.color).toBe('indigo')
  })
})
