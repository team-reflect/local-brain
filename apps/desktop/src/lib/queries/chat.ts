import { useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { listConversations, listMessages } from '@local-brain/core'

export function invalidateChatTurnQueries(queryClient: QueryClient, chatId: string): void {
  for (const queryKey of [
    ['chat-conversations'],
    ['chat-messages', chatId],
    ['people'],
    ['person'],
    ['organizations'],
    ['organization'],
    ['projects'],
    ['project'],
    ['tasks'],
    ['task'],
    ['task-assignees'],
    ['interactions'],
    ['interaction'],
    ['memories'],
    ['quick-search'],
    ['global-search'],
    ['graph'],
    ['daily-brief-note'],
  ]) {
    void queryClient.invalidateQueries({ queryKey })
  }
}

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
