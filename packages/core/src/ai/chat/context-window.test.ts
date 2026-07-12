import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import {
  ELIDED_CHAT_TOOL_RESULT,
  estimateChatMessageTokens,
  fitChatMessagesToContextWindow,
} from './context-window'

function windowForBudget(budget: number): number {
  return 72_000 + Math.ceil(budget / 0.8)
}

function estimatedTokens(messages: readonly ModelMessage[]): number {
  return messages.reduce(
    (total, message) => total + estimateChatMessageTokens(message),
    0,
  )
}

function turn(userChars: number, assistantChars: number): ModelMessage[] {
  return [
    { role: 'user', content: 'u'.repeat(userChars) },
    { role: 'assistant', content: 'a'.repeat(assistantChars) },
  ]
}

function toolExchange(callId: string, outputChars: number): ModelMessage[] {
  return [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: callId,
          toolName: 'get_records',
          input: { records: [{ recordType: 'document', recordId: 'document-1' }] },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: callId,
          toolName: 'get_records',
          output: { type: 'json', value: { records: [{ text: 'x'.repeat(outputChars) }] } },
        },
      ],
    },
  ]
}

describe('estimateChatMessageTokens', () => {
  it('uses a conservative text estimate plus message framing', () => {
    expect(estimateChatMessageTokens({ role: 'user', content: 'x'.repeat(400) })).toBe(104)
  })
})

describe('fitChatMessagesToContextWindow', () => {
  it('returns the same array while history is under budget', () => {
    const messages = [...turn(400, 400), ...turn(400, 400)]
    expect(
      fitChatMessagesToContextWindow(messages, {
        contextWindow: 1_000_000,
        systemPrompt: '',
      }),
    ).toBe(messages)
  })

  it('elides prior-turn tool bodies even when the new request is under budget', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'old question' },
      ...toolExchange('old-call', 200),
      { role: 'assistant', content: 'Old answer.' },
      { role: 'user', content: 'new question' },
    ]
    const fitted = fitChatMessagesToContextWindow(messages, {
      contextWindow: 1_000_000,
      systemPrompt: '',
    })

    expect(fitted).not.toBe(messages)
    expect(fitted[2]).toMatchObject({
      role: 'tool',
      content: [expect.objectContaining({
        output: { type: 'text', value: ELIDED_CHAT_TOOL_RESULT },
      })],
    })
    expect(fitted.at(-1)).toEqual({ role: 'user', content: 'new question' })
  })

  it('drops complete oldest turns rather than splitting message pairs', () => {
    const oldest: ModelMessage[] = [
      { role: 'user', content: 'old question'.padEnd(2_000, 'u') },
      ...toolExchange('old-call', 500),
      { role: 'assistant', content: 'old answer'.padEnd(2_000, 'a') },
    ]
    const middle = turn(2_000, 2_000)
    const newest = turn(2_000, 2_000)
    const fitted = fitChatMessagesToContextWindow([...oldest, ...middle, ...newest], {
      contextWindow: windowForBudget(2_200),
      systemPrompt: '',
    })

    expect(fitted).toEqual([...middle, ...newest])
    expect(JSON.stringify(fitted)).not.toContain('old-call')
  })

  it('elides old tool outputs while preserving call/result pairing', () => {
    const oldest: ModelMessage[] = [
      { role: 'user', content: 'find the old source' },
      ...toolExchange('tool-old', 8_000),
      { role: 'assistant', content: 'Found it.' },
    ]
    const middle = turn(200, 200)
    const newest: ModelMessage[] = [
      { role: 'user', content: 'read the new source' },
      ...toolExchange('tool-new', 200),
      { role: 'assistant', content: 'Here it is.' },
    ]
    const fitted = fitChatMessagesToContextWindow([...oldest, ...middle, ...newest], {
      contextWindow: windowForBudget(800),
      systemPrompt: '',
    })

    expect(fitted.filter((message) => message.role === 'user')).toHaveLength(3)
    const callIds: string[] = []
    const results: Array<{ toolCallId: string; output: unknown }> = []
    for (const message of fitted) {
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'tool-call') callIds.push(part.toolCallId)
        }
      }
      if (message.role === 'tool') {
        for (const part of message.content) {
          if (part.type === 'tool-result') results.push(part)
        }
      }
    }
    expect(callIds).toEqual(['tool-old', 'tool-new'])
    expect(results.map((part) => part.toolCallId)).toEqual(['tool-old', 'tool-new'])
    expect(results[0]).toMatchObject({
      output: { type: 'text', value: ELIDED_CHAT_TOOL_RESULT },
    })
    expect(results[1]).toMatchObject({ output: { type: 'json' } })
  })

  it('truncates oversized current-turn text so the newest turn respects the budget', () => {
    const messages = turn(40_000, 40_000)
    const fitted = fitChatMessagesToContextWindow(messages, {
      contextWindow: windowForBudget(800),
      systemPrompt: '',
    })

    expect(estimatedTokens(fitted)).toBeLessThanOrEqual(800)
    expect(fitted[0]?.role).toBe('user')
    expect(typeof fitted[0]?.content === 'string' ? fitted[0].content.length : 0).toBeLessThan(40_000)
  })

  it('elides an oversized current tool output without breaking its call/result pair', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Read the source' },
      ...toolExchange('oversized-call', 100_000),
    ]
    const fitted = fitChatMessagesToContextWindow(messages, {
      contextWindow: windowForBudget(300),
      systemPrompt: '',
    })
    const callIds: string[] = []
    const resultIds: string[] = []
    for (const message of fitted) {
      if (typeof message.content === 'string') continue
      for (const part of message.content) {
        if (part.type === 'tool-call') callIds.push(part.toolCallId)
        if (part.type === 'tool-result') {
          resultIds.push(part.toolCallId)
          expect(part.output).toEqual({ type: 'text', value: ELIDED_CHAT_TOOL_RESULT })
        }
      }
    }

    expect(estimatedTokens(fitted)).toBeLessThanOrEqual(300)
    expect(callIds).toEqual(['oversized-call'])
    expect(resultIds).toEqual(callIds)
  })

  it('elides older results when the current turn alone exceeds the moving budget', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'gather several sources' },
      ...toolExchange('call-1', 2_000),
      ...toolExchange('call-2', 2_000),
      ...toolExchange('call-3', 2_000),
      ...toolExchange('call-4', 2_000),
    ]
    const fitted = fitChatMessagesToContextWindow(messages, {
      contextWindow: windowForBudget(1_500),
      systemPrompt: '',
    })
    const results = fitted
      .filter((message) => message.role === 'tool')
      .flatMap((message) => (message.role === 'tool' ? message.content : []))
      .filter((part) => part.type === 'tool-result')

    expect(results).toHaveLength(4)
    expect(results.slice(0, 2)).toEqual([
      expect.objectContaining({ output: { type: 'text', value: ELIDED_CHAT_TOOL_RESULT } }),
      expect.objectContaining({ output: { type: 'text', value: ELIDED_CHAT_TOOL_RESULT } }),
    ])
    expect(results.slice(2).every((part) => part.output.type === 'json')).toBe(true)
  })
})
