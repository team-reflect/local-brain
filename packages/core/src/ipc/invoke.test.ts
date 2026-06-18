import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { setBridge } from './bridge'
import { call } from './invoke'
import { bridgeReturning } from '../test/bridge'

describe('call', () => {
  it('returns the validated payload', async () => {
    setBridge(bridgeReturning({ ok: true }))
    const schema = z.object({ ok: z.boolean() })
    await expect(call('whatever', {}, schema)).resolves.toEqual({ ok: true })
  })

  it('throws a parse AppError when the response shape is wrong', async () => {
    setBridge(bridgeReturning({ ok: 'nope' }))
    const schema = z.object({ ok: z.boolean() })
    await expect(call('whatever', {}, schema)).rejects.toMatchObject({ kind: 'parse' })
  })

  it('coerces a rejected command into its AppError contract', async () => {
    setBridge({ invoke: () => Promise.reject({ kind: 'io', message: 'disk gone' }) })
    const schema = z.object({ ok: z.boolean() })
    await expect(call('whatever', {}, schema)).rejects.toMatchObject({
      kind: 'io',
      message: 'disk gone',
    })
  })
})
