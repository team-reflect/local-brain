import { beforeEach, describe, expect, it } from 'vitest'
import {
  appendChatMessage,
  archiveConversation,
  createConversation,
  getConversation,
  listConversations,
  listMessages,
  updateChatMessageSnapshot,
  updateConversationTitle,
} from '../index'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

describe('Chat persistence', () => {
  beforeEach(() => installSqliteBridge(freshDatabase()))

  it('stores conversations and projected AI SDK messages', async () => {
    const conversationId = await createConversation({ id: 'chat-1', title: 'Northwind' })
    await appendChatMessage({
      id: 'msg-user',
      conversationId,
      role: 'user',
      contentText: 'What happened with Northwind?',
      uiMessageJson: {
        id: 'msg-user',
        role: 'user',
        parts: [{ type: 'text', text: 'What happened with Northwind?' }],
      },
    })
    await appendChatMessage({
      id: 'msg-assistant',
      conversationId,
      role: 'assistant',
      contentText: 'I found one local interaction.',
      uiMessageJson: {
        id: 'msg-assistant',
        role: 'assistant',
        parts: [{ type: 'text', text: 'I found one local interaction.' }],
      },
      model: 'openai/gpt-5.5',
    })

    expect((await listConversations()).map((conversation) => conversation.id)).toEqual(['chat-1'])
    expect((await listMessages(conversationId)).map((message) => ({
      id: message.id,
      role: message.role,
      text: message.contentText,
      model: message.model,
    }))).toEqual([
      { id: 'msg-user', role: 'user', text: 'What happened with Northwind?', model: null },
      { id: 'msg-assistant', role: 'assistant', text: 'I found one local interaction.', model: 'openai/gpt-5.5' },
    ])
  })

  it('updates an existing message id instead of duplicating it', async () => {
    const conversationId = await createConversation({ id: 'chat-1', title: 'Northwind' })
    await appendChatMessage({
      id: 'msg-assistant',
      conversationId,
      role: 'assistant',
      contentText: 'Approval needed.',
      uiMessageJson: {
        id: 'msg-assistant',
        role: 'assistant',
        parts: [{ type: 'tool-create_task', state: 'approval-requested' }],
      },
      status: 'streaming',
    })
    await appendChatMessage({
      id: 'msg-assistant',
      conversationId,
      role: 'assistant',
      contentText: 'Task created.',
      uiMessageJson: {
        id: 'msg-assistant',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Task created.' }],
      },
      status: 'done',
      model: 'openai/gpt-5.5',
    })

    expect((await listMessages(conversationId)).map((message) => ({
      id: message.id,
      text: message.contentText,
      status: message.status,
      model: message.model,
    }))).toEqual([
      { id: 'msg-assistant', text: 'Task created.', status: 'done', model: 'openai/gpt-5.5' },
    ])
  })

  it('updates a persisted assistant message snapshot without clearing model metadata', async () => {
    const conversationId = await createConversation({ id: 'chat-1', title: 'Tasks' })
    await appendChatMessage({
      id: 'msg-assistant',
      conversationId,
      role: 'assistant',
      contentText: '',
      uiMessageJson: {
        id: 'msg-assistant',
        role: 'assistant',
        parts: [
          {
            type: 'tool-create_task',
            state: 'approval-requested',
            approval: { id: 'approval-1' },
            input: { title: 'Send budget' },
          },
        ],
      },
      model: 'openai/gpt-5.5',
      status: 'streaming',
    })

    await expect(
      updateChatMessageSnapshot({
        id: 'msg-assistant',
        conversationId,
        contentText: '',
        uiMessageJson: {
          id: 'msg-assistant',
          role: 'assistant',
          parts: [
            {
              type: 'tool-create_task',
              state: 'output-available',
              approval: { id: 'approval-1', approved: true },
              input: { title: 'Send budget' },
              output: { kind: 'task', action: 'created', id: 'task-1' },
            },
          ],
        },
        status: 'done',
        error: null,
      }),
    ).resolves.toBe(1)

    expect((await listMessages(conversationId)).map((message) => ({
      id: message.id,
      status: message.status,
      model: message.model,
      parts: message.uiMessageJson['parts'],
    }))).toEqual([
      {
        id: 'msg-assistant',
        status: 'done',
        model: 'openai/gpt-5.5',
        parts: [
          {
            type: 'tool-create_task',
            state: 'output-available',
            approval: { id: 'approval-1', approved: true },
            input: { title: 'Send budget' },
            output: { kind: 'task', action: 'created', id: 'task-1' },
          },
        ],
      },
    ])
  })

  it('does not let stale streaming snapshots overwrite a resolved assistant message', async () => {
    const conversationId = await createConversation({ id: 'chat-1', title: 'Tasks' })
    await appendChatMessage({
      id: 'msg-assistant',
      conversationId,
      role: 'assistant',
      contentText: '',
      uiMessageJson: {
        id: 'msg-assistant',
        role: 'assistant',
        parts: [
          {
            type: 'tool-create_task',
            state: 'output-available',
            approval: { id: 'approval-1', approved: true },
            input: { title: 'Send budget' },
            output: { kind: 'task', action: 'created', id: 'task-1' },
          },
        ],
      },
      status: 'done',
    })

    await appendChatMessage({
      id: 'msg-assistant',
      conversationId,
      role: 'assistant',
      contentText: '',
      uiMessageJson: {
        id: 'msg-assistant',
        role: 'assistant',
        parts: [
          {
            type: 'tool-create_task',
            state: 'approval-requested',
            approval: { id: 'approval-1' },
            input: { title: 'Send budget' },
          },
        ],
      },
      status: 'streaming',
    })

    expect((await listMessages(conversationId)).map((message) => ({
      status: message.status,
      parts: message.uiMessageJson['parts'],
    }))).toEqual([
      {
        status: 'done',
        parts: [
          {
            type: 'tool-create_task',
            state: 'output-available',
            approval: { id: 'approval-1', approved: true },
            input: { title: 'Send budget' },
            output: { kind: 'task', action: 'created', id: 'task-1' },
          },
        ],
      },
    ])
  })

  it('hides archived conversations unless requested', async () => {
    await createConversation({ id: 'chat-open', title: 'Open' })
    await createConversation({ id: 'chat-archived', title: 'Archived' })
    await archiveConversation('chat-archived', '2026-06-19T00:00:00.000Z')

    expect((await listConversations()).map((conversation) => conversation.id)).toEqual(['chat-open'])
    expect((await listConversations({ includeArchived: true })).map((conversation) => conversation.id).sort()).toEqual([
      'chat-archived',
      'chat-open',
    ])
  })

  it('updates a conversation title without changing sidebar ordering timestamp', async () => {
    await createConversation({ id: 'chat-1', title: 'What did Maya promise?' })
    const before = await getConversation('chat-1')

    const count = await updateConversationTitle('chat-1', '  Maya   Budget \n Promise.  ')
    const after = await getConversation('chat-1')

    expect(count).toBe(1)
    expect(after?.title).toBe('Maya Budget Promise.')
    expect(after?.updatedAt).toBe(before?.updatedAt)
  })

  it('does not update archived conversation titles', async () => {
    await createConversation({ id: 'chat-1', title: 'Original' })
    await archiveConversation('chat-1', '2026-06-19T00:00:00.000Z')

    const count = await updateConversationTitle('chat-1', 'Generated')
    const conversation = await getConversation('chat-1')

    expect(count).toBe(0)
    expect(conversation?.title).toBe('Original')
  })

  it('ignores blank conversation titles', async () => {
    await createConversation({ id: 'chat-1', title: 'Original' })

    const count = await updateConversationTitle('chat-1', '   \n ')
    const conversation = await getConversation('chat-1')

    expect(count).toBe(0)
    expect(conversation?.title).toBe('Original')
  })
})
