import { beforeEach, describe, expect, it } from 'vitest'
import {
  appendChatMessage,
  archiveConversation,
  createConversation,
  getConversation,
  listConversations,
  listMessages,
  replaceChatAssistantMessage,
  setBridge,
  updateChatMessageSnapshot,
  updateConversationTitle,
} from '../index'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

function toSqlParam(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

/** Resolve the message after append's old pre-read but before its upsert runs. */
function installTerminalInterleavingBridge(database, terminalStatus) {
  let injected = false
  setBridge({
    invoke(command, args) {
      if (command === 'db_query') {
        return Promise.resolve(database.prepare(args.sql).all(...args.params.map(toSqlParam)))
      }
      if (command === 'db_batch') {
        if (!injected && args.statements[0]?.sql.includes('chat_messages')) {
          injected = true
          database
            .prepare(
              'UPDATE chat_messages SET content_text = ?, ui_message_json = ?, status = ?, error = ? WHERE id = ?',
            )
            .run(
              'Terminal snapshot',
              JSON.stringify({
                id: 'msg-assistant',
                role: 'assistant',
                parts: [{ type: 'text', text: 'Terminal snapshot' }],
              }),
              terminalStatus,
              terminalStatus === 'error' ? 'provider failed' : null,
              'msg-assistant',
            )
        }
        database.exec('BEGIN')
        try {
          const affected = args.statements.map((statement) =>
            Number(database.prepare(statement.sql).run(...statement.params.map(toSqlParam)).changes),
          )
          database.exec('COMMIT')
          return Promise.resolve(affected)
        } catch (error) {
          database.exec('ROLLBACK')
          return Promise.reject(error)
        }
      }
      return Promise.reject(new Error(`unexpected command: ${command}`))
    },
  })
}

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

  it('atomically replaces a terminal assistant with a reloadable regenerated approval', async () => {
    const conversationId = await createConversation({ id: 'chat-1', title: 'Tasks' })
    await appendChatMessage({
      id: 'msg-assistant',
      conversationId,
      role: 'assistant',
      contentText: 'The original answer.',
      uiMessageJson: {
        id: 'msg-assistant',
        role: 'assistant',
        parts: [{ type: 'text', text: 'The original answer.', state: 'done' }],
      },
      model: 'openai/gpt-5.5',
      status: 'done',
    })

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
    expect((await listMessages(conversationId))[0]).toMatchObject({
      contentText: 'The original answer.',
      status: 'done',
    })

    await expect(replaceChatAssistantMessage({
      id: 'msg-assistant',
      conversationId,
      contentText: '',
      uiMessageJson: approvalMessage,
      model: 'openai/gpt-5.5',
      status: 'streaming',
      error: null,
      expected: {
        contentText: 'The original answer.',
        uiMessageJson: {
          id: 'msg-assistant',
          role: 'assistant',
          parts: [{ type: 'text', text: 'The original answer.', state: 'done' }],
        },
        model: 'openai/gpt-5.5',
        status: 'done',
        error: null,
      },
    })).resolves.toBe(1)

    await expect(replaceChatAssistantMessage({
      id: 'msg-assistant',
      conversationId,
      contentText: 'A stale callback.',
      uiMessageJson: {
        id: 'msg-assistant',
        role: 'assistant',
        parts: [{ type: 'text', text: 'A stale callback.', state: 'done' }],
      },
      model: 'openai/gpt-5.5',
      status: 'done',
      error: null,
      expected: {
        contentText: 'The original answer.',
        uiMessageJson: {
          id: 'msg-assistant',
          role: 'assistant',
          parts: [{ type: 'text', text: 'The original answer.', state: 'done' }],
        },
        model: 'openai/gpt-5.5',
        status: 'done',
        error: null,
      },
    })).resolves.toBe(0)

    expect(await listMessages(conversationId)).toEqual([
      expect.objectContaining({
        id: 'msg-assistant',
        conversationId,
        role: 'assistant',
        contentText: '',
        uiMessageJson: approvalMessage,
        model: 'openai/gpt-5.5',
        status: 'streaming',
        error: null,
      }),
    ])
  })

  it('does not reset a user row through the assistant snapshot API', async () => {
    const conversationId = await createConversation({ id: 'chat-1', title: 'Tasks' })
    await appendChatMessage({
      id: 'msg-user',
      conversationId,
      role: 'user',
      contentText: 'Keep this question.',
      uiMessageJson: {
        id: 'msg-user',
        role: 'user',
        parts: [{ type: 'text', text: 'Keep this question.', state: 'done' }],
      },
      status: 'done',
    })

    await expect(updateChatMessageSnapshot({
      id: 'msg-user',
      conversationId,
      contentText: '',
      uiMessageJson: { id: 'msg-user', role: 'assistant', parts: [] },
      status: 'submitted',
      error: null,
    })).resolves.toBe(0)

    expect(await listMessages(conversationId)).toEqual([
      expect.objectContaining({
        id: 'msg-user',
        role: 'user',
        contentText: 'Keep this question.',
        status: 'done',
      }),
    ])
  })

  it.each(['done', 'error'])(
    'atomically preserves an interleaved %s snapshot inside the streaming upsert',
    async (terminalStatus) => {
      const database = freshDatabase()
      installSqliteBridge(database)
      const conversationId = await createConversation({ id: 'chat-1', title: 'Tasks' })
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

      installTerminalInterleavingBridge(database, terminalStatus)
      await appendChatMessage({
        id: 'msg-assistant',
        conversationId,
        role: 'assistant',
        contentText: 'Late streaming snapshot',
        uiMessageJson: {
          id: 'msg-assistant',
          role: 'assistant',
          parts: [{ type: 'tool-create_task', state: 'approval-requested' }],
        },
        status: 'streaming',
      })

      expect(await listMessages(conversationId)).toEqual([
        expect.objectContaining({
          id: 'msg-assistant',
          contentText: 'Terminal snapshot',
          status: terminalStatus,
          error: terminalStatus === 'error' ? 'provider failed' : null,
          uiMessageJson: {
            id: 'msg-assistant',
            role: 'assistant',
            parts: [{ type: 'text', text: 'Terminal snapshot' }],
          },
        }),
      ])
    },
  )

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
