import { z } from 'zod'
import { db } from '../../db/client'

/**
 * Durable Ask conversations. The UI stores the full AI SDK UIMessage JSON so
 * future SDK parts remain round-trippable, while these projection fields keep
 * thread lists and message rendering cheap.
 */

const chatRoleSchema = z.enum(['system', 'user', 'assistant'])
const chatStatusSchema = z.enum(['submitted', 'streaming', 'done', 'error'])
const uiMessageJsonSchema = z.record(z.string(), z.unknown())

export type ChatRole = z.infer<typeof chatRoleSchema>
export type ChatStatus = z.infer<typeof chatStatusSchema>

export interface ChatConversation {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface ChatMessage {
  id: string
  conversationId: string
  role: ChatRole
  contentText: string
  uiMessageJson: Record<string, unknown>
  model: string | null
  status: ChatStatus
  error: string | null
  createdAt: string
}

function parseUiMessageJson(value: string): Record<string, unknown> {
  try {
    return uiMessageJsonSchema.parse(JSON.parse(value))
  } catch {
    return {}
  }
}

function normalizeMessage(row: {
  id: string
  conversationId: string
  role: string
  contentText: string
  uiMessageJson: string
  model: string | null
  status: string
  error: string | null
  createdAt: string
}): ChatMessage {
  return {
    ...row,
    role: chatRoleSchema.catch('assistant').parse(row.role),
    status: chatStatusSchema.catch('done').parse(row.status),
    uiMessageJson: parseUiMessageJson(row.uiMessageJson),
  }
}

export function listConversations(options: { includeArchived?: boolean } = {}): Promise<ChatConversation[]> {
  let query = db.selectFrom('chatConversations').selectAll().orderBy('updatedAt', 'desc')
  if (!options.includeArchived) query = query.where('archivedAt', 'is', null)
  return query.execute()
}

export function getConversation(id: string): Promise<ChatConversation | undefined> {
  return db.selectFrom('chatConversations').selectAll().where('id', '=', id).executeTakeFirst()
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const rows = await db
    .selectFrom('chatMessages')
    .selectAll()
    .where('conversationId', '=', conversationId)
    .orderBy('createdAt', 'asc')
    .execute()
  return rows.map(normalizeMessage)
}
