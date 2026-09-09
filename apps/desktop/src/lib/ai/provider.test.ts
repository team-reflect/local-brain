import { generateText, Output, streamText, tool } from 'ai'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { z } from 'zod'
import { fitChatMessagesToContextWindow, type AiProviderConfig } from '@local-brain/core'
import { languageModelFor } from './provider'

const astra: AiProviderConfig = {
  id: 'openai-test',
  provider: 'openai',
  model: 'gpt-6-astra',
  keyHint: 'test',
}

function textResponse(text: string, model = astra.model): Response {
  return Response.json({
    id: 'resp_test',
    created_at: 0,
    model,
    status: 'completed',
    output: [{
      type: 'message',
      role: 'assistant',
      id: 'msg_test',
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }],
    }],
    usage: { input_tokens: 20, output_tokens: 30 },
  })
}

function responsesRequest(fetchImpl: Mock<typeof fetch>): unknown {
  expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
    'https://api.openai.com/v1/responses',
    expect.objectContaining({ method: 'POST' }),
  )
  return JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))
}

describe('languageModelFor', () => {
  it('generates structured Astra titles with reasoning-compatible settings', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(textResponse('{"title":"Project plans"}'))
    const result = await generateText({
      model: languageModelFor(astra, 'sk-test', fetchImpl),
      system: 'Write a short title.',
      prompt: 'A synthetic conversation about project plans.',
      output: Output.object({ schema: z.object({ title: z.string() }) }),
      maxOutputTokens: 64,
      temperature: 0,
      topP: 0.9,
      providerOptions: { openai: { store: false, reasoningEffort: 'low', forceReasoning: false } },
      maxRetries: 0,
    })

    expect(result.output).toEqual({ title: 'Project plans' })
    const body = responsesRequest(fetchImpl)
    expect(body).toMatchObject({
      model: 'gpt-6-astra',
      max_output_tokens: 25_000,
      input: expect.arrayContaining([{ role: 'developer', content: 'Write a short title.' }]),
      text: { format: { type: 'json_schema', schema: { required: ['title'] } } },
      store: false,
      reasoning: { effort: 'low' },
    })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
  })

  it.each([[950, 25_000], [32_000, 32_000]])(
    'reserves reasoning tokens without reducing larger Astra budgets (%i)',
    async (maxOutputTokens, expected) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(textResponse('A synthetic daily brief.'))
      const result = await generateText({
        model: languageModelFor(astra, 'sk-test', fetchImpl),
        prompt: 'Write a daily brief.',
        maxOutputTokens,
        temperature: 0.2,
        maxRetries: 0,
      })

      expect(result.text).toBe('A synthetic daily brief.')
      const body = responsesRequest(fetchImpl)
      expect(body).toMatchObject({ model: 'gpt-6-astra', max_output_tokens: expected })
      expect(body).not.toHaveProperty('temperature')
    },
  )

  it('streams Astra tool calls through Responses without executing the tool', async () => {
    const functionCall = {
      type: 'function_call',
      id: 'fc_test',
      call_id: 'call_test',
      name: 'findRecords',
      arguments: '{"query":"project plans"}',
    }
    const events = [
      { type: 'response.created', response: { id: 'resp_test', created_at: 0, model: astra.model } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { ...functionCall, arguments: '', status: 'in_progress' },
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'fc_test',
        output_index: 0,
        delta: functionCall.arguments,
      },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { ...functionCall, status: 'completed' },
      },
      {
        type: 'response.completed',
        response: { status: 'completed', usage: { input_tokens: 20, output_tokens: 30 } },
      },
    ]
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
      { headers: { 'content-type': 'text/event-stream' } },
    ))
    const result = streamText({
      model: languageModelFor(astra, 'sk-test', fetchImpl),
      system: 'Find records.',
      prompt: 'Find project plans.',
      tools: { findRecords: tool({ inputSchema: z.object({ query: z.string() }) }) },
      maxOutputTokens: 4096,
      temperature: 0,
      maxRetries: 0,
    })

    expect(await result.toolCalls).toEqual([expect.objectContaining({
      toolCallId: 'call_test',
      toolName: 'findRecords',
      input: { query: 'project plans' },
    })])
    expect(await result.toolResults).toEqual([])
    const body = responsesRequest(fetchImpl)
    expect(body).toMatchObject({
      model: 'gpt-6-astra',
      stream: true,
      max_output_tokens: 25_000,
      input: expect.arrayContaining([{ role: 'developer', content: 'Find records.' }]),
      tools: [expect.objectContaining({ type: 'function', name: 'findRecords' })],
    })
    expect(body).not.toHaveProperty('temperature')
  })

  it('preserves the requested budget and sampling for other OpenAI models', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(textResponse('A title.', 'gpt-4.1'))
    await generateText({
      model: languageModelFor({ ...astra, model: 'gpt-4.1' }, 'sk-test', fetchImpl),
      prompt: 'Write a title.',
      maxOutputTokens: 64,
      temperature: 0.2,
      maxRetries: 0,
    })

    expect(responsesRequest(fetchImpl)).toMatchObject({
      model: 'gpt-4.1',
      max_output_tokens: 64,
      temperature: 0.2,
    })
  })

  it('replays Astra reasoning with its tool call and matching result', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(textResponse('Found the project.'))
    const result = await generateText({
      model: languageModelFor(astra, 'sk-test', fetchImpl),
      system: 'Find records.',
      messages: fitChatMessagesToContextWindow([
        { role: 'user', content: 'Find project plans.' },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: '', providerOptions: { openai: { itemId: 'rs_test' } } },
            {
              type: 'tool-call',
              toolCallId: 'call_test',
              toolName: 'findRecords',
              input: { query: 'project plans' },
              providerOptions: { openai: { itemId: 'fc_test' } },
            },
          ],
        },
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call_test',
            toolName: 'findRecords',
            output: { type: 'text', value: 'One matching project.' },
          }],
        },
      ], { contextWindow: 1_050_000, systemPrompt: 'Find records.' }),
      tools: { findRecords: tool({ inputSchema: z.object({ query: z.string() }) }) },
      maxRetries: 0,
    })

    expect(result.text).toBe('Found the project.')
    expect(responsesRequest(fetchImpl)).toHaveProperty('input', [
      { role: 'developer', content: 'Find records.' },
      { role: 'user', content: [{ type: 'input_text', text: 'Find project plans.' }] },
      { type: 'item_reference', id: 'rs_test' },
      {
        type: 'function_call',
        call_id: 'call_test',
        name: 'findRecords',
        arguments: '{"query":"project plans"}',
      },
      { type: 'function_call_output', call_id: 'call_test', output: 'One matching project.' },
    ])
  })
})
