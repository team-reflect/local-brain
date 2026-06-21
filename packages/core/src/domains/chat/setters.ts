import { db } from '../../db/client'
import { batch, execute } from '../../db/commands'
import { newId } from '../../db/id'
import { nowIso } from '../../db/time'
import type { ChatRole, ChatStatus } from './getters'

export interface NewChatConversation {
  id?: string
  title?: string | null
}

export interface NewChatMessage {
  id?: string
  conversationId: string
  role: ChatRole
  contentText: string
  uiMessageJson: Record<string, unknown>
  model?: string | null
  status?: ChatStatus
  error?: string | null
}

export function createChatId(): string {
  return newId()
}

export async function createConversation(input: NewChatConversation = {}): Promise<string> {
  const id = input.id ?? newId()
  await execute(
    db.insertInto('chatConversations').values({
      id,
      title: input.title ?? null,
    }),
  )
  return id
}

export async function appendChatMessage(input: NewChatMessage): Promise<string> {
  const id = input.id ?? newId()
  const now = nowIso()
  await batch([
    db
      .insertInto('chatMessages')
      .values({
        id,
        conversationId: input.conversationId,
        role: input.role,
        contentText: input.contentText,
        uiMessageJson: JSON.stringify(input.uiMessageJson),
        model: input.model ?? null,
        status: input.status ?? 'done',
        error: input.error ?? null,
        createdAt: now,
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          conversationId: input.conversationId,
          role: input.role,
          contentText: input.contentText,
          uiMessageJson: JSON.stringify(input.uiMessageJson),
          model: input.model ?? null,
          status: input.status ?? 'done',
          error: input.error ?? null,
        }),
      ),
    db.updateTable('chatConversations').set({ updatedAt: now }).where('id', '=', input.conversationId),
  ])
  return id
}

export function archiveConversation(id: string, archivedAt = nowIso()): Promise<number> {
  return execute(
    db
      .updateTable('chatConversations')
      .set({ archivedAt, updatedAt: archivedAt })
      .where('id', '=', id),
  )
}
