import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
  type UIEvent,
} from 'react'
import type { UIMessage } from 'ai'

const CHAT_SCROLL_PIN_THRESHOLD_PX = 96

interface ChatScrollState {
  count: number
  lastId: string | null
  lastRole: UIMessage['role'] | null
  signature: string
}

interface ChatScroll {
  scrollRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLOListElement | null>
  bottomRef: RefObject<HTMLDivElement | null>
  onScroll: (event: UIEvent<HTMLDivElement>) => void
}

function jsonLength(value: unknown): number {
  if (value === null || value === undefined) return 0
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}

function partScrollFingerprint(part: unknown): string {
  const record = part as Record<string, unknown>
  const type = String(record['type'] ?? '')
  const state = String(record['state'] ?? '')
  const textLength = String(record['text'] ?? '').length
  return `${type}:${state}:${textLength}:${jsonLength(record['input'])}:${jsonLength(record['output'])}`
}

function buildChatScrollState(messages: UIMessage[], showThinking: boolean): ChatScrollState {
  const lastMessage = messages[messages.length - 1]
  return {
    count: messages.length,
    lastId: lastMessage?.id ?? null,
    lastRole: lastMessage?.role ?? null,
    signature: [
      messages.length,
      showThinking ? 'thinking' : 'idle',
      lastMessage?.id ?? 'none',
      lastMessage?.role ?? 'none',
      ...(lastMessage?.parts.map(partScrollFingerprint) ?? []),
    ].join('|'),
  }
}

function isNearScrollBottom(container: HTMLElement): boolean {
  const remaining = container.scrollHeight - container.scrollTop - container.clientHeight
  return remaining <= CHAT_SCROLL_PIN_THRESHOLD_PX
}

function scrollChatToBottom(container: HTMLElement, anchor: HTMLElement | null): void {
  if (anchor && typeof anchor.scrollIntoView === 'function') {
    anchor.scrollIntoView({ block: 'end' })
    return
  }
  container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
}

/** Keeps Chat pinned to new content without stealing scroll from older messages. */
export function useChatScroll(messages: UIMessage[], showThinking: boolean): ChatScroll {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLOListElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef(true)
  const previousScrollStateRef = useRef<ChatScrollState | null>(null)
  const scrollState = useMemo(() => buildChatScrollState(messages, showThinking), [messages, showThinking])

  useLayoutEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const previous = previousScrollStateRef.current
    const hasNewLastMessage =
      !previous || previous.count !== scrollState.count || previous.lastId !== scrollState.lastId
    const userTurnAdded = hasNewLastMessage && scrollState.lastRole === 'user'
    const shouldStickToBottom = !previous || pinnedRef.current || userTurnAdded

    previousScrollStateRef.current = scrollState
    if (!shouldStickToBottom) return

    scrollChatToBottom(container, bottomRef.current)
    pinnedRef.current = true
  }, [scrollState])

  useEffect(() => {
    const container = scrollRef.current
    const content = contentRef.current
    if (!container || !content || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) scrollChatToBottom(container, bottomRef.current)
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    pinnedRef.current = isNearScrollBottom(event.currentTarget)
  }, [])

  return { scrollRef, contentRef, bottomRef, onScroll }
}
