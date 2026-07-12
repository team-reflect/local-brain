import { db } from '../../db/client'
import { batch, execute } from '../../db/commands'
import type { DatabaseIdentity } from '../../db/identity'
import { newId } from '../../db/id'
import { nowIso } from '../../db/time'
import { squish } from '../../text/normalize'
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

export interface ChatMessageSnapshot {
  id: string
  conversationId: string
  contentText: string
  uiMessageJson: Record<string, unknown>
  status?: ChatStatus
  error?: string | null
}

export function createChatId(): string {
  return newId()
}

/** Create a conversation, optionally rejecting the write after a brain switch. */
export async function createConversation(
  input: NewChatConversation = {},
  expectedIdentity?: DatabaseIdentity,
): Promise<string> {
  const id = input.id ?? newId()
  await execute(
    db.insertInto('chatConversations').values({
      id,
      title: input.title ?? null,
    }),
    expectedIdentity,
  )
  return id
}

/** Update an active conversation title, optionally pinned to a captured brain. */
export function updateConversationTitle(
  id: string,
  title: string,
  expectedIdentity?: DatabaseIdentity,
): Promise<number> {
  const normalized = squish(title)
  if (!normalized) return Promise.resolve(0)
  return execute(
    db
      .updateTable('chatConversations')
      .set({ title: normalized })
      .where('id', '=', id)
      .where('archivedAt', 'is', null),
    expectedIdentity,
  )
}

/**
 * Upsert a durable Chat message and touch its conversation. A supplied identity
 * pins the write batch to the captured brain. Nonterminal snapshots use an
 * atomic conflict-update guard so they cannot regress a terminal row.
 */
export async function appendChatMessage(
  input: NewChatMessage,
  expectedIdentity?: DatabaseIdentity,
): Promise<string> {
  const id = input.id ?? newId()
  const status = input.status ?? 'done'
  const isTerminal = status === 'done' || status === 'error'
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
        status,
        error: input.error ?? null,
        createdAt: now,
      })
      .onConflict((oc) => {
        const update = oc.column('id').doUpdateSet({
          conversationId: input.conversationId,
          role: input.role,
          contentText: input.contentText,
          uiMessageJson: JSON.stringify(input.uiMessageJson),
          model: input.model ?? null,
          status,
          error: input.error ?? null,
        })
        // The check belongs to the same SQLite statement as the update. A
        // separate pre-read leaves a window where an approval can persist a
        // terminal snapshot and a late streaming callback can overwrite it.
        return isTerminal
          ? update
          : update.where('chatMessages.status', 'not in', ['done', 'error'])
      }),
    db.updateTable('chatConversations').set({ updatedAt: now }).where('id', '=', input.conversationId),
  ], expectedIdentity)
  return id
}

/** Replace one persisted assistant snapshot in an identity-pinned write batch. */
export async function updateChatMessageSnapshot(
  input: ChatMessageSnapshot,
  expectedIdentity?: DatabaseIdentity,
): Promise<number> {
  const now = nowIso()
  const [affected] = await batch([
    db
      .updateTable('chatMessages')
      .set({
        contentText: input.contentText,
        uiMessageJson: JSON.stringify(input.uiMessageJson),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.error !== undefined ? { error: input.error } : {}),
      })
      .where('id', '=', input.id)
      .where('conversationId', '=', input.conversationId),
    db.updateTable('chatConversations').set({ updatedAt: now }).where('id', '=', input.conversationId),
  ], expectedIdentity)
  return affected ?? 0
}

export function archiveConversation(id: string, archivedAt = nowIso()): Promise<number> {
  return execute(
    db
      .updateTable('chatConversations')
      .set({ archivedAt, updatedAt: archivedAt })
      .where('id', '=', id),
  )
}
