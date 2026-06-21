import { beforeEach, describe, expect, it } from 'vitest'
import {
  appendChatMessage,
  archiveConversation,
  createConversation,
  listConversations,
  listMessages,
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
})
