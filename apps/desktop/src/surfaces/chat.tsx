import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useChat } from '@ai-sdk/react'
import { MessageSquare, Plus, Send } from 'lucide-react'
import { z } from 'zod'
import { createChatId, type ChatMessage } from '@local-brain/core'
import { lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from 'ai'
import { useQueryClient } from '@tanstack/react-query'
import { Alert } from '../components/alert'
import { Button } from '../components/button'
import { EmptyState } from '../components/empty-state'
import { Loading } from '../components/loading'
import { ChatMarkdown } from '../components/chat/chat-markdown'
import {
  ChatToolChip,
  messageHasAwaitingToolApproval,
  type ToolApprovalResponse,
  type ToolPart,
} from '../components/chat/chat-tool-chip'
import { createChatTransport } from '../lib/ai/chat-transport'
import { invalidateChatTurnQueries, useConversations, useMessages, useModelSettings, useModelStatus } from '../lib/queries'
import { cn } from '../lib/utils'
import { useRouter } from '../routing/router'

const uiMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(['system', 'user', 'assistant']),
    parts: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough()

function fallbackMessage(message: ChatMessage): UIMessage {
  return {
    id: message.id,
    role: message.role,
    parts: [{ type: 'text', text: message.contentText, state: 'done' }],
  }
}

function toUiMessage(message: ChatMessage): UIMessage {
  const parsed = uiMessageSchema.safeParse(message.uiMessageJson)
  return parsed.success ? (parsed.data as unknown as UIMessage) : fallbackMessage(message)
}

function persistedMessages(messages: ChatMessage[] | undefined): UIMessage[] {
  return (messages ?? []).map(toUiMessage)
}

function streamingMessageHasContent(message: UIMessage | undefined): boolean {
  if (!message || message.role !== 'assistant') return false
  return message.parts.some((p) => {
    const part = p as Record<string, unknown>
    const type = String(part['type'] ?? '')
    const text = String(part['text'] ?? '')
    return (
      ((type === 'text' || type === 'reasoning') && text.length > 0) ||
      type.startsWith('tool-')
    )
  })
}

export function ChatSurface({ conversationId }: { conversationId: string | undefined }): ReactNode {
  const [draftConversationId, setDraftConversationId] = useState(() => createChatId())
  const [hydratedConversationId, setHydratedConversationId] = useState<string | null>(null)
  const chatId = conversationId ?? draftConversationId
  const storedMessages = useMessages(conversationId)
  const conversations = useConversations()
  const modelSettings = useModelSettings()
  const modelStatus = useModelStatus()
  const queryClient = useQueryClient()
  const { navigate } = useRouter()
  const transport = useMemo(() => createChatTransport(), [])
  const initialMessages = useMemo(() => persistedMessages(storedMessages.data), [storedMessages.data])
  const [draft, setDraft] = useState('')

  const chat = useChat({
    id: chatId,
    transport,
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: () => {
      invalidateChatTurnQueries(queryClient, chatId)
    },
  })
  const { addToolApprovalResponse, error, messages, sendMessage, setMessages, status } = chat

  useEffect(() => {
    if (!conversationId) setHydratedConversationId(null)
  }, [conversationId])

  useEffect(() => {
    if (!conversationId || hydratedConversationId === conversationId || status !== 'ready' || !storedMessages.data) return
    setMessages(initialMessages)
    setHydratedConversationId(conversationId)
  }, [conversationId, hydratedConversationId, initialMessages, setMessages, status, storedMessages.data])

  const providerClosed = modelStatus.data && !modelStatus.data.canRun ? modelStatus.data.reason : null
  const providerSetupState = modelSettings.isPending
    ? 'loading'
    : modelSettings.isError
      ? 'error'
      : modelSettings.data.providers.length === 0
        ? 'missing'
        : 'ready'
  const pending = status === 'submitted' || status === 'streaming'
  const conversationHydrated = !conversationId || hydratedConversationId === conversationId
  const historyUnavailable = Boolean(conversationId && storedMessages.isError)
  const waitingForHydration = Boolean(conversationId && !conversationHydrated && !historyUnavailable)
  const composerPending = pending || waitingForHydration || historyUnavailable ||
    messages.some(messageHasAwaitingToolApproval)

  // Show the generic Thinking indicator only before the first assistant content arrives.
  const lastMessage = messages[messages.length - 1]
  const showThinking =
    status === 'submitted' || (status === 'streaming' && !streamingMessageHasContent(lastMessage))

  // The streaming message id — last message while streaming, null otherwise.
  const streamingMessageId = status === 'streaming' ? (lastMessage?.id ?? null) : null

  async function submitDraft(): Promise<void> {
    const text = draft.trim()
    if (!text || composerPending) return
    setDraft('')
    try {
      if (!conversationId) {
        setHydratedConversationId(chatId)
        navigate({ kind: 'chat', conversationId: chatId })
      }
      await sendMessage({
        id: createChatId(),
        role: 'user',
        parts: [{ type: 'text', text }],
      })
      void queryClient.invalidateQueries({ queryKey: ['chat-conversations'] })
      void queryClient.invalidateQueries({ queryKey: ['chat-messages', chatId] })
    } catch {
      setDraft(text)
    }
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    await submitDraft()
  }

  function startNewChat(): void {
    const nextConversationId = createChatId()
    setDraft('')
    setMessages([])
    setDraftConversationId(nextConversationId)
    setHydratedConversationId(null)
    if (conversationId) {
      navigate({ kind: 'chat' })
    }
  }

  const displayedMessages = conversationHydrated ? messages : []
  const showInitialLoading = waitingForHydration
  let chatContent: ReactNode
  if (providerSetupState === 'loading') {
    chatContent = (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loading />
      </div>
    )
  } else if (providerSetupState === 'error') {
    chatContent = (
      <ProviderSettingsError onConfigure={() => navigate({ kind: 'settings', section: 'ai-providers' })} />
    )
  } else if (providerSetupState === 'missing') {
    chatContent = (
      <ConfigureProviderPrompt onConfigure={() => navigate({ kind: 'settings', section: 'ai-providers' })} />
    )
  } else {
    chatContent = (
      <>
        {providerClosed ? <Alert className="mb-3">{providerClosed}</Alert> : null}
        {historyUnavailable ? (
          <Alert variant="error" className="mb-3">
            Could not load this chat history.
          </Alert>
        ) : null}
        {showInitialLoading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <Loading />
          </div>
        ) : (
          <MessageList
            key={chatId}
            messages={displayedMessages}
            streamingMessageId={streamingMessageId}
            showThinking={showThinking}
            onToolApprovalResponse={addToolApprovalResponse}
          />
        )}
        {error ? <Alert variant="error" className="mx-auto mb-3 w-full max-w-2xl">{error.message}</Alert> : null}
        <Composer draft={draft} setDraft={setDraft} pending={composerPending} onSubmit={onSubmit} />
      </>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <ConversationRail
        activeId={conversationId}
        conversations={conversations.data ?? []}
        onNew={startNewChat}
        onOpen={(id) => navigate({ kind: 'chat', conversationId: id })}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {chatContent}
      </div>
    </div>
  )
}

function ProviderSettingsError({ onConfigure }: { onConfigure: () => void }): ReactNode {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <Alert variant="error">Could not load AI provider settings.</Alert>
        <Button className="mt-5" variant="outline" onClick={onConfigure}>
          Open AI providers
        </Button>
      </div>
    </div>
  )
}

function ConfigureProviderPrompt({ onConfigure }: { onConfigure: () => void }): ReactNode {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <MessageSquare aria-hidden strokeWidth={1.5} className="size-8 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold text-foreground">Chat with your local brain</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Add an AI provider to start chatting. Local Brain calls the provider directly with
          your own key, stored in the OS keychain.
        </p>
        <Button className="mt-5" variant="primary" onClick={onConfigure}>
          Add an AI provider
        </Button>
      </div>
    </div>
  )
}

function ConversationRail({
  activeId,
  conversations,
  onNew,
  onOpen,
}: {
  activeId: string | undefined
  conversations: NonNullable<ReturnType<typeof useConversations>['data']>
  onNew: () => void
  onOpen: (id: string) => void
}): ReactNode {
  return (
    <aside className="mr-6 hidden w-56 shrink-0 border-r border-border pr-4 lg:block">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Chat</h2>
        <button
          type="button"
          onClick={onNew}
          aria-label="New chat"
          title="New chat"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
      </div>
      <nav className="flex flex-col gap-1">
        {conversations.length === 0 ? (
          <p className="-ml-2 -mr-1 px-2 py-2 text-xs text-muted-foreground">No chats yet</p>
        ) : (
          conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => onOpen(conversation.id)}
              className={cn(
                '-ml-2 -mr-1 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                conversation.id === activeId
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
              )}
            >
              <span className="block truncate">{conversation.title ?? 'Untitled'}</span>
            </button>
          ))
        )}
      </nav>
    </aside>
  )
}

function MessageList({
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
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef(true)

  // Auto-scroll to bottom when messages change, but only while pinned.
  useEffect(() => {
    const container = scrollRef.current
    if (container && pinnedRef.current) {
      container.scrollTop = container.scrollHeight
    }
  }, [messages, showThinking])

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
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const t = event.currentTarget
        pinnedRef.current = t.scrollHeight - t.scrollTop - t.clientHeight < 48
      }}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <ol className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-2">
        {messages.map((message) => (
          <li key={message.id}>
            <MessageRow
              message={message}
              streamingMessageId={streamingMessageId}
              onToolApprovalResponse={onToolApprovalResponse}
            />
          </li>
        ))}
        {showThinking ? (
          <li className="animate-pulse text-sm text-muted-foreground" aria-label="Thinking">
            Thinking…
          </li>
        ) : null}
      </ol>
    </div>
  )
}

function MessageRow({
  message,
  streamingMessageId,
  onToolApprovalResponse,
}: {
  message: UIMessage
  streamingMessageId: string | null
  onToolApprovalResponse: (response: ToolApprovalResponse) => void | PromiseLike<void>
}): ReactNode {
  const isStreaming = message.id === streamingMessageId

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-secondary px-3 py-2 text-sm leading-6 text-foreground">
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
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {message.parts.map((part, index) => {
        const partRecord = part as Record<string, unknown>
        const partType = String(partRecord['type'] ?? '')

        if (partType === 'text') {
          const text = String(partRecord['text'] ?? '')
          const renderAsPlain = isStreaming
          if (renderAsPlain) {
            return (
              <div
                key={`${message.id}-${index}`}
                className="whitespace-pre-wrap text-sm leading-6 text-foreground"
              >
                {text}
              </div>
            )
          }
          return text ? <ChatMarkdown key={`${message.id}-${index}`} text={text} /> : null
        }

        if (partType === 'reasoning') {
          return (
            <span key={`${message.id}-${index}`} className="block text-xs text-muted-foreground">
              {String(partRecord['text'] ?? '')}
            </span>
          )
        }

        if (partType.startsWith('tool-')) {
          return (
            <ChatToolChip
              key={`${message.id}-${index}`}
              part={partRecord as unknown as ToolPart}
              onApprovalResponse={onToolApprovalResponse}
            />
          )
        }

        return null
      })}
    </div>
  )
}

function Composer({
  draft,
  setDraft,
  pending,
  onSubmit,
}: {
  draft: string
  setDraft: (draft: string) => void
  pending: boolean
  onSubmit: (event: FormEvent) => Promise<void>
}): ReactNode {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [draft])

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  const empty = draft.trim().length === 0
  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-2xl pt-4">
      <div className="relative rounded-lg border border-border bg-card focus-within:border-ring">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Chat about your people, projects, documents, interactions, or tasks..."
          aria-label="Chat message"
          disabled={pending}
          className="field-sizing-content max-h-60 min-h-24 w-full resize-none overflow-y-auto bg-transparent px-3 py-2 pb-12 pr-28 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={empty || pending}
          className="absolute bottom-2 right-2"
        >
          <Send className="size-3.5" />
          Send
        </Button>
      </div>
    </form>
  )
}
