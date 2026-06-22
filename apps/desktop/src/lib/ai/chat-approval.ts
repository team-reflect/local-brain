import type { QueryClient } from '@tanstack/react-query'
import type { UIMessage } from 'ai'
import {
  appendChatMessage,
  executeChatWriteTool,
  isChatWriteToolName,
  updateChatMessageSnapshot,
  type ChatStatus,
} from '@local-brain/core'
import {
  messageHasAwaitingToolApproval,
  toolNameFromPart,
  type ToolApprovalResponse,
  type ToolPart,
} from '../../components/chat/chat-tool-chip'
import { invalidateChatTurnQueries } from '../queries'

const inFlightApprovalIds = new Set<string>()

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

function approvalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
): Promise<void> {
  const snapshot = {
    id: message.id,
    conversationId: chatId,
    contentText: uiMessageText(message),
    uiMessageJson: uiMessageJson(message),
    status: messageStatus(message),
    error: null,
  }
  const affected = await updateChatMessageSnapshot(snapshot)
  if (affected === 0) {
    await appendChatMessage({
      ...snapshot,
      role: 'assistant',
    })
  }
  invalidateChatTurnQueries(queryClient, chatId)
}

export interface ChatToolApprovalHandlerOptions {
  chatId: string
  getMessages: () => readonly UIMessage[]
  queryClient: QueryClient
  setMessages: (messages: UIMessage[]) => void
  addToolApprovalResponse: (response: ToolApprovalResponse) => void | PromiseLike<void>
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

export async function handleChatToolApprovalResponse(
  response: ToolApprovalResponse,
  options: ChatToolApprovalHandlerOptions,
): Promise<void> {
  if (inFlightApprovalIds.has(response.id)) return

  const target = findApprovalTarget(options.getMessages(), response.id, true)
  const toolName = target ? toolNameFromPart(target.part) : null
  if (!target || !toolName || !isChatWriteToolName(toolName)) {
    await options.addToolApprovalResponse(response)
    return
  }

  inFlightApprovalIds.add(response.id)
  try {
    if (!response.approved) {
      const denied = applyApprovalToolPartUpdate(options, response.id, (part) => ({
        ...part,
        state: 'output-denied',
        approval: { ...part.approval, approved: false },
      }))
      if (denied) await persistUpdatedAssistantMessage(options.chatId, options.queryClient, denied.message)
      return
    }

    const acknowledged = applyApprovalToolPartUpdate(options, response.id, (part) => ({
      ...part,
      state: 'approval-responded',
      approval: { ...part.approval, approved: true },
    }))
    if (!acknowledged) return
    try {
      await persistUpdatedAssistantMessage(options.chatId, options.queryClient, acknowledged.message)
    } catch (persistError) {
      applyApprovalToolPartUpdate(options, response.id, () => target.part)
      throw persistError
    }

    let output: Awaited<ReturnType<typeof executeChatWriteTool>>
    try {
      output = await executeChatWriteTool(toolName, toolInput(target.part))
    } catch (executionError) {
      const failed = applyApprovalToolPartUpdate(options, response.id, (part) => ({
        ...part,
        state: 'output-error',
        approval: { ...part.approval, approved: true },
        errorText: approvalErrorMessage(executionError),
      }))
      if (failed) await persistUpdatedAssistantMessage(options.chatId, options.queryClient, failed.message)
      return
    }

    const succeeded = applyApprovalToolPartUpdate(options, response.id, (part) => ({
      ...part,
      state: 'output-available',
      approval: { ...part.approval, approved: true },
      output: { ...output },
    }))
    if (succeeded) await persistUpdatedAssistantMessage(options.chatId, options.queryClient, succeeded.message)
  } finally {
    inFlightApprovalIds.delete(response.id)
  }
}
