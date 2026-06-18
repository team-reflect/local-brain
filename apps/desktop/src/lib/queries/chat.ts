import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addMessage,
  ask,
  createConversation,
  getDailyBrief,
  getModelStatus,
  listConversations,
  listMessages,
  type AskOptions,
  type NewChatMessage,
} from '@local-brain/core'

/**
 * Ask: conversations, messages, and the cited-answer pipeline (Plan 06), plus the
 * model-boundary status and the daily brief that Ask and Today share.
 */

export function useConversations() {
  return useQuery({ queryKey: ['conversations'], queryFn: listConversations })
}

export function useMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: ['messages', conversationId ?? null],
    queryFn: () => (conversationId ? listMessages(conversationId) : Promise.resolve([])),
    enabled: conversationId !== undefined,
  })
}

export function useCreateConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (title: string | null) => createConversation(title),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  })
}

export function useAddMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (message: NewChatMessage) => addMessage(message),
    onSuccess: (_id, message) => {
      void queryClient.invalidateQueries({ queryKey: ['messages', message.conversationId] })
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}

/**
 * Ask: the cited-answer pipeline (Plan 06). Persists user + assistant turns and
 * evidence; invalidates the thread, the conversation list, and the assistant
 * message's citations.
 */
export function useAsk() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { question: string } & AskOptions) => {
      const { question, ...options } = vars
      return ask(question, options)
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['messages', result.conversationId] })
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      void queryClient.invalidateQueries({ queryKey: ['citations', 'chat_message', result.messageId] })
    },
  })
}

/** The model-boundary status (configured? enabled? can it run?). */
export function useModelStatus() {
  return useQuery({ queryKey: ['model-status'], queryFn: getModelStatus })
}

/** The daily brief: bucketed tasks, recent interactions, reconnects. */
export function useDailyBrief() {
  return useQuery({ queryKey: ['daily-brief'], queryFn: () => getDailyBrief() })
}
