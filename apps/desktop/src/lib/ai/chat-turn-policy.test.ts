import { describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { chatTurnPolicy } from './chat-turn-policy'

vi.mock('@local-brain/core', async (importActual) => {
  const actual = await importActual<typeof import('@local-brain/core')>()
  return { ...actual, isChatWriteToolName: (name: string) => name === 'update_task' }
})

function user(text: string): UIMessage {
  return {
    id: `user-${text}`,
    role: 'user',
    parts: [{ type: 'text', text, state: 'done' }],
  }
}

describe('chatTurnPolicy', () => {
  it.each([
    'Update me on Project Alpha',
    'Can you update us about Project Alpha?',
    'Remember when we met Maya?',
    'Could you remember what Maya promised?',
  ])('keeps factual phrasing bounded: %s', (text) => {
    expect(chatTurnPolicy([user(text)])).toEqual({
      toolStepLimit: 4,
      recordDetailBudget: { maxCalls: 1, maxRecords: 6, maxTotalChars: 24_000 },
    })
  })

  it.each([
    'Assign Maya to the follow-up task',
    'Reschedule the meeting for Friday',
    'Finish the budget task',
    'Can you schedule a call with Maya?',
  ])('retains the write workflow for an explicit mutation: %s', (text) => {
    expect(chatTurnPolicy([user(text)])).toEqual({
      toolStepLimit: 12,
      recordDetailBudget: { maxCalls: 1, maxRecords: 6, maxTotalChars: 24_000 },
    })
  })

  it('detects an explicit write after a factual leading phrase', () => {
    expect(chatTurnPolicy([
      user('Update me on Project Alpha, then create a follow-up task'),
    ])).toEqual({
      toolStepLimit: 12,
      recordDetailBudget: { maxCalls: 1, maxRecords: 6, maxTotalChars: 24_000 },
    })
  })

  it('detects an explicit write after a factual question', () => {
    expect(chatTurnPolicy([
      user('What did Maya promise? Create a follow-up task'),
    ])).toEqual({
      toolStepLimit: 12,
      recordDetailBudget: { maxCalls: 1, maxRecords: 6, maxTotalChars: 24_000 },
    })
  })

  it('continues a persisted write-tool workflow independently of user wording', () => {
    const assistant = {
      id: 'assistant-write',
      role: 'assistant',
      parts: [{ type: 'tool-update_task', toolCallId: 'call-1', state: 'input-available' }],
    } as unknown as UIMessage

    expect(chatTurnPolicy([user('That one'), assistant])).toEqual({ toolStepLimit: 12 })
  })
})
