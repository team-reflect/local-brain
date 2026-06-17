import { db } from '../../db/client'
import { batch, execute } from '../../db/commands'
import { newId } from '../../db/id'
import { nowIso } from '../../db/time'

/** Start a new conversation and return its id. */
export async function createConversation(title: string | null = null): Promise<string> {
  const id = newId()
  await execute(db.insertInto('chatConversations').values({ id, title }))
  return id
}

export interface NewChatMessage {
  conversationId: string
  role: string
  content: string
  model?: string
}

/**
 * Append a message and bump the conversation's `updated_at` in the same Rust
 * transaction, so the conversation list re-sorts and the two writes can't drift.
 */
export async function addMessage(message: NewChatMessage): Promise<string> {
  const id = newId()
  await batch([
    db.insertInto('chatMessages').values({
      id,
      conversationId: message.conversationId,
      role: message.role,
      content: message.content,
      ...(message.model !== undefined ? { model: message.model } : {}),
    }),
    db
      .updateTable('chatConversations')
      .set({ updatedAt: nowIso() })
      .where('id', '=', message.conversationId),
  ])
  return id
}

export function archiveConversation(id: string): Promise<number> {
  return execute(
    db.updateTable('chatConversations').set({ archivedAt: nowIso() }).where('id', '=', id),
  )
}
