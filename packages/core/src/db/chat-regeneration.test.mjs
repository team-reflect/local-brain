import { beforeEach, describe, expect, it } from 'vitest'
import {
  appendChatMessage,
  createConversation,
  listMessages,
  replaceChatAssistantMessage,
  updateChatMessageSnapshot,
} from '../index'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

describe('Chat regeneration persistence', () => {
  beforeEach(() => installSqliteBridge(freshDatabase()))

  it('rolls back an approval only while that exact regenerated snapshot is current', async () => {
    const conversationId = await createConversation({ id: 'chat-1', title: 'Tasks' })
    const originalMessage = {
      id: 'msg-assistant',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The original answer.', state: 'done' }],
    }
    const approvalMessage = {
      id: 'msg-assistant',
      role: 'assistant',
      parts: [
        {
          type: 'tool-create_task',
          toolCallId: 'tool-1',
          state: 'approval-requested',
          approval: { id: 'approval-1' },
          input: { title: 'Send budget' },
        },
      ],
    }
    const original = {
      contentText: 'The original answer.',
      uiMessageJson: originalMessage,
      model: 'openai/gpt-5.5',
      status: 'done',
      error: null,
    }
    const approval = {
      contentText: '',
      uiMessageJson: approvalMessage,
      model: 'openai/gpt-5.5',
      status: 'streaming',
      error: null,
    }
    await appendChatMessage({
      id: 'msg-assistant',
      conversationId,
      role: 'assistant',
      ...original,
    })

    const replace = (snapshot, expected) => replaceChatAssistantMessage({
      id: 'msg-assistant',
      conversationId,
      ...snapshot,
      expected,
    })

    await expect(replace(approval, original)).resolves.toBe(1)
    await expect(replace(original, approval)).resolves.toBe(1)
    expect((await listMessages(conversationId))[0]).toMatchObject(original)

    await expect(replace(approval, original)).resolves.toBe(1)
    const continuedMessage = {
      id: 'msg-assistant',
      role: 'assistant',
      parts: [
        {
          type: 'tool-create_task',
          toolCallId: 'tool-1',
          state: 'output-available',
          approval: { id: 'approval-1', approved: true },
          input: { title: 'Send budget' },
          output: { kind: 'task', action: 'created', id: 'task-1' },
        },
      ],
    }
    await updateChatMessageSnapshot({
      id: 'msg-assistant',
      conversationId,
      contentText: 'Task created.',
      uiMessageJson: continuedMessage,
      status: 'done',
      error: null,
    })

    await expect(replace(original, approval)).resolves.toBe(0)
    expect((await listMessages(conversationId))[0]).toMatchObject({
      contentText: 'Task created.',
      uiMessageJson: continuedMessage,
      model: 'openai/gpt-5.5',
      status: 'done',
      error: null,
    })
  })
})
