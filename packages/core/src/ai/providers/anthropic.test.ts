import { describe, expect, it, vi } from 'vitest'
import { buildAnthropicBody, createAnthropicProvider, readAnthropicText } from './anthropic'

describe('anthropic provider', () => {
  it('shapes a Messages request body', () => {
    const body = buildAnthropicBody(
      { system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 256, temperature: 0 },
      'claude-x',
    )
    expect(body).toMatchObject({ model: 'claude-x', system: 'sys', max_tokens: 256, temperature: 0 })
    expect(body['messages']).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('reads concatenated text blocks', () => {
    expect(readAnthropicText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('ab')
    expect(readAnthropicText({ content: [{ type: 'tool_use' }] })).toBe('')
  })

  it('reports availability from the key and calls fetch with auth headers', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'answer' }], model: 'claude-x' }), {
        status: 200,
      }),
    )
    const provider = createAnthropicProvider({ apiKey: 'sk-test', model: 'claude-x', fetchImpl })
    expect(provider.isAvailable()).toBe(true)
    const completion = await provider.generate({ system: 's', messages: [{ role: 'user', content: 'q' }] })
    expect(completion.text).toBe('answer')
    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-test')
  })

  it('is unavailable with a blank key and surfaces HTTP errors', async () => {
    expect(createAnthropicProvider({ apiKey: '  ' }).isAvailable()).toBe(false)
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 }))
    const provider = createAnthropicProvider({ apiKey: 'k', fetchImpl })
    await expect(provider.generate({ system: 's', messages: [] })).rejects.toThrow(/401/)
  })
})
