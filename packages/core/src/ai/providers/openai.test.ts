import { describe, expect, it, vi } from 'vitest'
import { buildOpenAiBody, createOpenAiProvider } from './openai'

describe('openai provider', () => {
  it('preserves sampling and token limits for other models', () => {
    expect(
      buildOpenAiBody(
        {
          system: 'Extract facts.',
          messages: [{ role: 'user', content: 'A synthetic source.' }],
          maxTokens: 256,
          temperature: 0.2,
        },
        'gpt-4.1',
      ),
    ).toEqual({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: 'Extract facts.' },
        { role: 'user', content: 'A synthetic source.' },
      ],
      max_tokens: 256,
      temperature: 0.2,
    })
    expect(buildOpenAiBody({ system: '', messages: [] }, 'gpt-4.1')).toMatchObject({
      max_tokens: 1024,
      temperature: 0,
    })
  })

  it.each([
    [undefined, 25_000],
    [2048, 25_000],
    [32_000, 32_000],
  ])('allows reasoning and output within the Astra token budget (%s)', (maxTokens, expected) => {
    const body = buildOpenAiBody(
      {
        system: '',
        messages: [],
        ...(maxTokens === undefined ? {} : { maxTokens }),
        temperature: 0.2,
      },
      'gpt-6-astra',
    )
    expect(body['max_completion_tokens']).toBe(expected)
    expect(body).not.toHaveProperty('max_tokens')
    expect(body).not.toHaveProperty('temperature')
  })

  it('sends an Astra extraction request and reads the completion and usage', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"facts":[]}' } }],
          model: 'gpt-6-astra',
          usage: { prompt_tokens: 120, completion_tokens: 300 },
        }),
        { status: 200 },
      ),
    )
    const provider = createOpenAiProvider({ apiKey: 'sk-test', model: 'gpt-6-astra', fetchImpl })

    const completion = await provider.generate({
      system: 'Extract facts.',
      messages: [{ role: 'user', content: 'A synthetic source.' }],
      temperature: 0,
      maxTokens: 2048,
    })

    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer sk-test', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-6-astra',
        messages: [
          { role: 'system', content: 'Extract facts.' },
          { role: 'user', content: 'A synthetic source.' },
        ],
        max_completion_tokens: 25_000,
      }),
    })
    expect(completion).toEqual({
      text: '{"facts":[]}',
      model: 'gpt-6-astra',
      usage: { inputTokens: 120, outputTokens: 300 },
    })
  })
})
