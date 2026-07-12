import type { QueryClient } from '@tanstack/react-query'
import type { UIMessage } from 'ai'
import {
  activeDatabaseIdentity,
  appendChatMessage,
  assertActiveDatabaseIdentity,
  executeChatWriteTool,
  isAppError,
  isChatWriteToolName,
  updateChatMessageSnapshot,
  type ChatStatus,
  type DatabaseIdentity,
} from '@local-brain/core'
import {
  messageHasAwaitingToolApproval,
  toolNameFromPart,
  type ToolApprovalResponse,
  type ToolPart,
} from '../../components/chat/chat-tool-chip'
import { invalidateChatTurnQueries } from '../queries'
import { errorMessage } from '../utils'

declare const chatApprovalLeaseBrand: unique symbol

/** Opaque ownership token for one streamed approval id registration. */
export interface ChatApprovalLease {
  readonly [chatApprovalLeaseBrand]: true
}

interface ApprovalLeaseRecord {
  approvalId: string
  identity: DatabaseIdentity
  lease: ChatApprovalLease
  state: 'live' | 'in-flight' | 'revoked' | 'superseded' | 'finished'
}

const inFlightRestoredApprovalIds = new Set<string>()
const liveApprovalLeases = new Map<string, ApprovalLeaseRecord>()
const revokedApprovalLeases = new Map<string, ApprovalLeaseRecord>()
const approvalLeaseRecords = new WeakMap<ChatApprovalLease, ApprovalLeaseRecord>()
const STALE_APPROVAL_MESSAGE = 'This approval is no longer valid. Retry the request.'
const APPROVAL_VERIFY_FAILED_MESSAGE = 'Could not verify this approval. Retry the request.'
const APPROVAL_SAVE_FAILED_MESSAGE = 'Could not save this approval. Retry the request.'

/** Remember the turn identity before the streamed approval reaches React state. */
export function rememberChatApprovalDatabaseIdentity(
  approvalId: string,
  identity: DatabaseIdentity,
): ChatApprovalLease {
  const previousLive = liveApprovalLeases.get(approvalId)
  if (previousLive && previousLive.state === 'live') previousLive.state = 'superseded'
  const previousRevoked = revokedApprovalLeases.get(approvalId)
  if (previousRevoked) previousRevoked.state = 'superseded'

  const lease = Object.freeze({}) as ChatApprovalLease
  const record: ApprovalLeaseRecord = { approvalId, identity, lease, state: 'live' }
  approvalLeaseRecords.set(lease, record)
  liveApprovalLeases.set(approvalId, record)
  revokedApprovalLeases.delete(approvalId)
  return lease
}

/**
 * Revoke one exact streamed approval lease. `false` means a user action or a
 * newer registration already won and the caller must not roll its turn back.
 */
export function revokeChatApprovalDatabaseIdentity(lease: ChatApprovalLease): boolean {
  return revokeChatApprovalDatabaseIdentities([lease])
}

/** Atomically revoke every still-live lease, or leave the entire batch unchanged. */
export function revokeChatApprovalDatabaseIdentities(
  leases: readonly ChatApprovalLease[],
): boolean {
  const records: ApprovalLeaseRecord[] = []
  for (const lease of leases) {
    const record = approvalLeaseRecords.get(lease)
    if (!record) return false
    if (
      record.state !== 'revoked' &&
      (record.state !== 'live' || liveApprovalLeases.get(record.approvalId) !== record)
    ) return false
    records.push(record)
  }
  for (const record of records) {
    if (record.state === 'revoked') continue
    record.state = 'revoked'
    liveApprovalLeases.delete(record.approvalId)
    revokedApprovalLeases.set(record.approvalId, record)
  }
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function uiMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

function uiMessageJson(message: UIMessage): Record<string, unknown> {
  const cloned: unknown = JSON.parse(JSON.stringify(message))
  return isRecord(cloned) ? cloned : {}
}

function messageStatus(message: UIMessage): ChatStatus {
  return messageHasAwaitingToolApproval(message) ? 'streaming' : 'done'
}

function toolInput(part: ToolPart): Record<string, unknown> {
  return part.input ?? {}
}

interface ApprovalTarget {
  messageIndex: number
  partIndex: number
  part: ToolPart
}

function findApprovalTarget(
  messages: readonly UIMessage[],
  approvalId: string,
  awaitingOnly: boolean,
): ApprovalTarget | null {
  for (const [messageIndex, message] of messages.entries()) {
    if (message.role !== 'assistant') continue
    for (const [partIndex, part] of message.parts.entries()) {
      const record = part as Record<string, unknown>
      if (!String(record['type'] ?? '').startsWith('tool-')) continue
      const toolPart = record as unknown as ToolPart
      const awaiting = messageHasAwaitingToolApproval({ role: message.role, parts: [part] })
      if (toolPart.approval?.id === approvalId && (!awaitingOnly || awaiting)) {
        return { messageIndex, partIndex, part: toolPart }
      }
    }
  }
  return null
}

function replaceToolPart(
  messages: readonly UIMessage[],
  target: ApprovalTarget,
  nextPart: ToolPart,
): { messages: UIMessage[]; message: UIMessage } {
  let updatedMessage: UIMessage | null = null
  const updatedMessages = messages.map((message, messageIndex) => {
    if (messageIndex !== target.messageIndex) return message
    const parts = message.parts.map((part, partIndex) =>
      partIndex === target.partIndex ? (nextPart as unknown as UIMessage['parts'][number]) : part,
    )
    updatedMessage = { ...message, parts }
    return updatedMessage
  })
  if (!updatedMessage) throw new Error('Could not update the approved tool message.')
  return { messages: updatedMessages, message: updatedMessage }
}

function replaceApprovalToolPart(
  messages: readonly UIMessage[],
  approvalId: string,
  updatePart: (part: ToolPart) => ToolPart,
): { messages: UIMessage[]; message: UIMessage; part: ToolPart } | null {
  const target = findApprovalTarget(messages, approvalId, false)
  if (!target) return null
  const nextPart = updatePart(target.part)
  const updated = replaceToolPart(messages, target, nextPart)
  return { ...updated, part: nextPart }
}

async function persistUpdatedAssistantMessage(
  chatId: string,
  queryClient: QueryClient,
  message: UIMessage,
  identity: DatabaseIdentity,
): Promise<void> {
  const snapshot = {
    id: message.id,
    conversationId: chatId,
    contentText: uiMessageText(message),
    uiMessageJson: uiMessageJson(message),
    status: messageStatus(message),
    error: null,
  }
  const affected = await updateChatMessageSnapshot(snapshot, identity)
  if (affected === 0) {
    await appendChatMessage({
      ...snapshot,
      role: 'assistant',
    }, identity)
  }
  invalidateChatTurnQueries(queryClient, chatId)
}

async function persistStaleApprovalFailureWhenSafe(
  options: ChatToolApprovalHandlerOptions,
  message: UIMessage,
): Promise<void> {
  if (!options.expectedDatabasePath) return
  try {
    const identity = await activeDatabaseIdentity()
    if (identity.databasePath !== options.expectedDatabasePath) return
    await assertActiveDatabaseIdentity(identity)
    await persistUpdatedAssistantMessage(options.chatId, options.queryClient, message, identity)
  } catch {
    // The visible local failure is sufficient. Never risk persisting it in a
    // different brain or surfacing a second rejected promise from the click.
  }
}

/** UI and persistence dependencies for resolving one Chat tool approval. */
export interface ChatToolApprovalHandlerOptions {
  chatId: string
  getMessages: () => readonly UIMessage[]
  queryClient: QueryClient
  setMessages: (messages: UIMessage[]) => void
  addToolApprovalResponse: (response: ToolApprovalResponse) => void | PromiseLike<void>
  /** Brain owning the loaded conversation; restored approvals must never execute. */
  expectedDatabasePath?: string
}

async function approvalDatabaseIdentity(
  claimedIdentity: DatabaseIdentity | undefined,
  expectedDatabasePath: string | undefined,
  allowCurrentIdentity: boolean,
): Promise<DatabaseIdentity> {
  let identity = claimedIdentity
  if (!identity && allowCurrentIdentity && expectedDatabasePath) {
    identity = await activeDatabaseIdentity()
  }
  if (!identity) {
    throw {
      kind: 'stale',
      message: 'This approval belongs to a Chat turn that is no longer active. Retry the request.',
    }
  }
  if (expectedDatabasePath && identity.databasePath !== expectedDatabasePath) {
    throw {
      kind: 'stale',
      message: 'The active brain changed before this approval could be applied.',
    }
  }
  await assertActiveDatabaseIdentity(identity)
  return identity
}

function applyApprovalToolPartUpdate(
  options: ChatToolApprovalHandlerOptions,
  responseId: string,
  updatePart: (part: ToolPart) => ToolPart,
): { message: UIMessage; part: ToolPart } | null {
  const next = replaceApprovalToolPart(options.getMessages(), responseId, updatePart)
  if (!next) return null
  options.setMessages(next.messages)
  return { message: next.message, part: next.part }
}

function settleRevokedApproval(
  response: ToolApprovalResponse,
  options: ChatToolApprovalHandlerOptions,
): boolean {
  const revoked = revokedApprovalLeases.get(response.id)
  if (!revoked || revoked.state !== 'revoked') return false
  const settled = applyApprovalToolPartUpdate(options, response.id, (part) => response.approved
    ? {
        ...part,
        state: 'output-error',
        approval: { ...part.approval, approved: true },
        errorText: STALE_APPROVAL_MESSAGE,
      }
    : {
        ...part,
        state: 'output-denied',
        approval: { ...part.approval, approved: false },
      })
  if (settled) revokedApprovalLeases.delete(response.id)
  return true
}

/**
 * Persist and execute a write-tool approval against its process-local turn
 * identity. Approval fails closed after reload; denial may settle a restored
 * request in the conversation's currently active brain.
 */
export async function handleChatToolApprovalResponse(
  response: ToolApprovalResponse,
  options: ChatToolApprovalHandlerOptions,
): Promise<void> {
  if (settleRevokedApproval(response, options)) return

  const liveLease = liveApprovalLeases.get(response.id)
  if (liveLease?.state === 'in-flight' || inFlightRestoredApprovalIds.has(response.id)) return
  if (liveLease?.state === 'live') {
    liveLease.state = 'in-flight'
  } else {
    inFlightRestoredApprovalIds.add(response.id)
  }

  const target = findApprovalTarget(options.getMessages(), response.id, true)
  const toolName = target ? toolNameFromPart(target.part) : null
  if (!target || !toolName || !isChatWriteToolName(toolName)) {
    try {
      const settledTarget = findApprovalTarget(options.getMessages(), response.id, false)
      if (!settledTarget) await options.addToolApprovalResponse(response)
      return
    } finally {
      if (liveLease?.state === 'in-flight') liveLease.state = 'finished'
      if (liveApprovalLeases.get(response.id) === liveLease) {
        liveApprovalLeases.delete(response.id)
      }
      inFlightRestoredApprovalIds.delete(response.id)
    }
  }

  try {
    let identity: DatabaseIdentity
    try {
      identity = await approvalDatabaseIdentity(
        liveLease?.identity,
        options.expectedDatabasePath,
        !response.approved,
      )
    } catch (identityError) {
      if (!response.approved) {
        applyApprovalToolPartUpdate(options, response.id, (part) => ({
          ...part,
          state: 'output-denied',
          approval: { ...part.approval, approved: false },
        }))
        return
      }
      const isStale = isAppError(identityError) && identityError.kind === 'stale'
      const failed = applyApprovalToolPartUpdate(options, response.id, (part) => ({
        ...part,
        state: 'output-error',
        approval: { ...part.approval, approved: true },
        errorText: isStale ? STALE_APPROVAL_MESSAGE : APPROVAL_VERIFY_FAILED_MESSAGE,
      }))
      if (failed && isStale) {
        await persistStaleApprovalFailureWhenSafe(options, failed.message)
      }
      return
    }
    if (!response.approved) {
      const denied = applyApprovalToolPartUpdate(options, response.id, (part) => ({
        ...part,
        state: 'output-denied',
        approval: { ...part.approval, approved: false },
      }))
      if (denied) {
        await persistUpdatedAssistantMessage(
          options.chatId,
          options.queryClient,
          denied.message,
          identity,
        )
      }
      return
    }

    const acknowledged = applyApprovalToolPartUpdate(options, response.id, (part) => ({
      ...part,
      state: 'approval-responded',
      approval: { ...part.approval, approved: true },
    }))
    if (!acknowledged) return
    try {
      await persistUpdatedAssistantMessage(
        options.chatId,
        options.queryClient,
        acknowledged.message,
        identity,
      )
    } catch {
      applyApprovalToolPartUpdate(options, response.id, (part) => ({
        ...part,
        state: 'output-error',
        approval: { ...part.approval, approved: true },
        errorText: APPROVAL_SAVE_FAILED_MESSAGE,
      }))
      return
    }

    let output: Awaited<ReturnType<typeof executeChatWriteTool>>
    try {
      output = await executeChatWriteTool(toolName, toolInput(target.part), identity)
    } catch (executionError) {
      const failed = applyApprovalToolPartUpdate(options, response.id, (part) => ({
        ...part,
        state: 'output-error',
        approval: { ...part.approval, approved: true },
        errorText: errorMessage(executionError),
      }))
      if (failed) {
        await persistUpdatedAssistantMessage(
          options.chatId,
          options.queryClient,
          failed.message,
          identity,
        )
      }
      return
    }

    const succeeded = applyApprovalToolPartUpdate(options, response.id, (part) => ({
      ...part,
      state: 'output-available',
      approval: { ...part.approval, approved: true },
      output: { ...output },
    }))
    if (succeeded) {
      await persistUpdatedAssistantMessage(
        options.chatId,
        options.queryClient,
        succeeded.message,
        identity,
      )
    }
  } finally {
    if (liveLease?.state === 'in-flight') liveLease.state = 'finished'
    if (liveApprovalLeases.get(response.id) === liveLease) {
      liveApprovalLeases.delete(response.id)
    }
    inFlightRestoredApprovalIds.delete(response.id)
  }
}
