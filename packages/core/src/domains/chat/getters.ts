import type { Selectable } from 'kysely'
import type { ChatConversations, ChatMessages } from '@local-brain/db'
import { db } from '../../db/client'

export type ChatConversation = Selectable<ChatConversations>
export type ChatMessage = Selectable<ChatMessages>

/** Conversations, most recently updated first; archived excluded. */
export function listConversations(): Promise<ChatConversation[]> {
  return db
    .selectFrom('chatConversations')
    .selectAll()
    .where('archivedAt', 'is', null)
    .orderBy('updatedAt', 'desc')
    .execute()
}

export function getConversation(id: string): Promise<ChatConversation | undefined> {
  return db.selectFrom('chatConversations').selectAll().where('id', '=', id).executeTakeFirst()
}

/** Messages in a conversation, oldest first (chat order). */
export function listMessages(conversationId: string): Promise<ChatMessage[]> {
  return db
    .selectFrom('chatMessages')
    .selectAll()
    .where('conversationId', '=', conversationId)
    .orderBy('createdAt', 'asc')
    .execute()
}
