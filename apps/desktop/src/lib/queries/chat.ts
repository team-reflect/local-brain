import { useQuery } from '@tanstack/react-query'
import { listConversations, listMessages } from '@local-brain/core'

export function useConversations() {
  return useQuery({ queryKey: ['chat-conversations'], queryFn: () => listConversations() })
}

export function useMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: ['chat-messages', conversationId ?? null],
    queryFn: () => (conversationId ? listMessages(conversationId) : Promise.resolve([])),
    enabled: conversationId !== undefined,
  })
}
