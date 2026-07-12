import { memo, useCallback, useMemo, type ReactNode } from 'react'
import type { UIMessage } from 'ai'
import { useRouter } from '../../routing/router'
import { EmptyState } from '../empty-state'
import { Bubble, BubbleContent } from '../ui/bubble'
import { Marker, MarkerContent } from '../ui/marker'
import { Message, MessageContent } from '../ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '../ui/message-scroller'
import { ChatMarkdown } from './chat-markdown'
import {
  chatSourcesFromMessageParts,
  routeForChatSource,
  type ChatSource,
} from './chat-sources'
import { ChatToolChip, type ToolApprovalResponse, type ToolPart } from './chat-tool-chip'

export function ChatMessageList({
  messages,
  streamingMessageId,
  showThinking,
  onToolApprovalResponse,
}: {
  messages: UIMessage[]
  streamingMessageId: string | null
  showThinking: boolean
  onToolApprovalResponse: (response: ToolApprovalResponse) => void | PromiseLike<void>
}): ReactNode {
  const { navigate } = useRouter()
  const onOpenSource = useCallback((source: ChatSource): void => {
    const route = routeForChatSource(source)
    if (route) navigate(route)
  }, [navigate])

  if (messages.length === 0 && !showThinking) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <EmptyState
          title="Chat with your local brain"
          hint="Questions are answered from local records, and approved changes are saved in this brain."
        />
      </div>
    )
  }

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end" scrollMargin={16}>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport aria-label="Chat messages" className="px-6">
          <MessageScrollerContent className="mx-auto w-full max-w-2xl gap-5 py-2">
            {messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === 'user'}
              >
                <ChatMessageRow
                  message={message}
                  streamingMessageId={streamingMessageId}
                  onToolApprovalResponse={onToolApprovalResponse}
                  onOpenSource={onOpenSource}
                />
              </MessageScrollerItem>
            ))}
            {showThinking ? (
              <MessageScrollerItem messageId="thinking">
                <Marker aria-label="Thinking">
                  <MarkerContent className="animate-pulse">Thinking…</MarkerContent>
                </Marker>
              </MessageScrollerItem>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

const ChatMessageRow = memo(function ChatMessageRow({
  message,
  streamingMessageId,
  onToolApprovalResponse,
  onOpenSource,
}: {
  message: UIMessage
  streamingMessageId: string | null
  onToolApprovalResponse: (response: ToolApprovalResponse) => void | PromiseLike<void>
  onOpenSource: (source: ChatSource) => void
}): ReactNode {
  const isStreaming = message.id === streamingMessageId
  const sources = useMemo(() => chatSourcesFromMessageParts(message.parts), [message.parts])

  if (message.role === 'user') {
    return (
      <Message align="end">
        <MessageContent>
          <Bubble variant="muted">
            <BubbleContent className="rounded-lg px-3 py-2 leading-6">
              {message.parts.map((part, index) => {
                if (part.type === 'text') {
                  return (
                    <span key={`${message.id}-${index}`} className="whitespace-pre-wrap">
                      {part.text}
                    </span>
                  )
                }
                return null
              })}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  }

  return (
    <Message>
      <MessageContent>
        <Bubble variant="ghost" className="max-w-full">
          <BubbleContent className="w-full max-w-full">
            {message.parts.map((part, index) => {
              const partRecord = part as Record<string, unknown>
              const partType = String(partRecord['type'] ?? '')

              if (partType === 'text') {
                const text = String(partRecord['text'] ?? '')
                if (isStreaming) {
                  return (
                    <div
                      key={`${message.id}-${index}`}
                      className="whitespace-pre-wrap text-sm leading-6 text-foreground"
                    >
                      {text}
                    </div>
                  )
                }
                return text ? (
                  <ChatMarkdown
                    key={`${message.id}-${index}`}
                    text={text}
                    sources={sources}
                    onOpenSource={onOpenSource}
                  />
                ) : null
              }

              if (partType === 'reasoning') {
                return (
                  <Marker key={`${message.id}-${index}`} className="text-xs">
                    <MarkerContent>{String(partRecord['text'] ?? '')}</MarkerContent>
                  </Marker>
                )
              }

              if (partType.startsWith('tool-')) {
                return (
                  <Marker key={`${message.id}-${index}`}>
                    <MarkerContent className="w-full">
                      <ChatToolChip
                        part={partRecord as unknown as ToolPart}
                        onApprovalResponse={onToolApprovalResponse}
                        onOpenSource={onOpenSource}
                      />
                    </MarkerContent>
                  </Marker>
                )
              }

              return null
            })}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
})
