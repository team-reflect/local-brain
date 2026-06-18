import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowUp, Check, ExternalLink, FileText, History, MessageSquare, MessagesSquare, Plus } from 'lucide-react'
import { Button } from '../components/button'
import { cn } from '../lib/utils'
import {
  useAsk,
  useCitationsForSubject,
  useConversations,
  useMessages,
  useModelStatus,
} from '../lib/queries'
import { useRouter } from '../routing/router'
import type { Route } from '../routing/route'

/**
 * The Ask surface (Plan 06). Sending a question runs the cited-answer pipeline:
 * retrieve grounding chunks, call the model through the checked boundary, and
 * persist the answer plus one citation per cited source. When the model boundary
 * is closed the assistant turn is an honest "not configured" message instead.
 */
export function AskSurface({ conversationId }: { conversationId: string | undefined }): ReactNode {
  const { navigate } = useRouter()
  const conversations = useConversations()
  const messages = useMessages(conversationId)
  const modelStatus = useModelStatus()
  const askMutation = useAsk()
  const [draft, setDraft] = useState('')

  const pending = askMutation.isPending

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const text = draft.trim()
    if (!text || pending) return
    setDraft('')
    try {
      const result = await askMutation.mutateAsync({
        question: text,
        ...(conversationId ? { conversationId } : {}),
      })
      if (!conversationId) navigate({ kind: 'ask', conversationId: result.conversationId })
    } catch {
      // The send failed (e.g. the bridge or DB errored): restore the question so
      // it is not silently lost and the user can retry without retyping.
      setDraft(text)
    }
  }

  const status = modelStatus.data
  const messageList = messages.data ?? []
  const closed = status && !status.canRun

  return (
    <div className="flex h-full min-h-0 flex-col">
      {closed ? (
        <ClosedBoundary reason={status.reason} />
      ) : (
        <MessageList conversationId={conversationId} messages={messageList} pending={pending} />
      )}

      <AskComposer
        draft={draft}
        setDraft={setDraft}
        pending={pending}
        disabled={Boolean(closed)}
        hasConversation={Boolean(conversationId || messageList.length > 0)}
        conversationId={conversationId}
        conversations={conversations.data ?? []}
        onSubmit={onSubmit}
        onNewConversation={() => navigate({ kind: 'ask' })}
        onOpenConversation={(id) => navigate({ kind: 'ask', conversationId: id })}
      />
    </div>
  )
}

function ClosedBoundary({ reason }: { reason: string }): ReactNode {
  const { navigate } = useRouter()
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <MessageSquare aria-hidden strokeWidth={1.5} className="size-8 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold text-foreground">Ask your local brain</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {reason} Local Brain calls the provider directly with your own key and cites the records
          it used.
        </p>
        <Button className="mt-5" onClick={() => navigate({ kind: 'settings', section: 'model-keys' })}>
          Add a model key
        </Button>
      </div>
    </div>
  )
}

function MessageList({
  conversationId,
  messages,
  pending,
}: {
  conversationId: string | undefined
  messages: NonNullable<ReturnType<typeof useMessages>['data']>
  pending: boolean
}): ReactNode {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef(true)

  useEffect(() => {
    const container = scrollRef.current
    if (container && pinnedRef.current) container.scrollTop = container.scrollHeight
  }, [messages, pending])

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const target = event.currentTarget
        pinnedRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 48
      }}
      className="min-h-0 flex-1 overflow-y-auto px-6"
    >
      {messages.length > 0 ? (
        <div className="mx-auto w-full max-w-2xl py-8">
          <ul className="flex flex-col gap-6">
            {messages.map((message) => (
              <li key={message.id} className="flex flex-col gap-2">
                {message.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl bg-secondary px-4 py-2 text-sm whitespace-pre-wrap text-foreground">
                      {message.content}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 text-sm text-foreground">
                    {message.model ? (
                      <p className="font-mono text-[11px] text-muted-foreground">{message.model}</p>
                    ) : null}
                    <p className="whitespace-pre-wrap leading-6">{message.content}</p>
                    <Citations messageId={message.id} />
                  </div>
                )}
              </li>
            ))}
            {pending ? <li className="animate-pulse text-sm text-muted-foreground">Thinking…</li> : null}
          </ul>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center">
          <div className="max-w-md text-center">
            <h2 className="text-lg font-semibold text-foreground">Ask your local brain</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {conversationId
                ? 'No messages yet.'
                : 'Ask a question about your brain: people, projects, tasks, documents, and interactions. Answers stay grounded in citations.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

interface AskComposerProps {
  draft: string
  setDraft: (draft: string) => void
  pending: boolean
  disabled: boolean
  hasConversation: boolean
  conversationId: string | undefined
  conversations: NonNullable<ReturnType<typeof useConversations>['data']>
  onSubmit: (event: FormEvent) => Promise<void>
  onNewConversation: () => void
  onOpenConversation: (id: string) => void
}

function AskComposer({
  draft,
  setDraft,
  pending,
  disabled,
  hasConversation,
  conversationId,
  conversations,
  onSubmit,
  onNewConversation,
  onOpenConversation,
}: AskComposerProps): ReactNode {
  const [historyOpen, setHistoryOpen] = useState(false)
  const empty = draft.trim().length === 0

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void onSubmit(event as unknown as FormEvent)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex-none px-6 pb-6">
      <div
        className={cn(
          'mx-auto w-full max-w-2xl rounded-xl border border-border bg-card focus-within:border-ring',
          disabled && 'opacity-70',
        )}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about your brain…"
          aria-label="Chat message"
          rows={2}
          autoFocus
          disabled={disabled}
          className="max-h-48 w-full resize-none bg-transparent px-3.5 pt-3 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-2 px-2.5 pb-2.5">
          <span className="px-1 text-xs text-muted-foreground">Cited answers</span>
          <div className="flex-1" />
          <div className="relative">
            <button
              type="button"
              aria-label="Chat history"
              onClick={() => setHistoryOpen((open) => !open)}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <History aria-hidden className="size-4" />
            </button>
            {historyOpen ? (
              <div className="absolute bottom-full right-0 z-20 mb-2 w-72 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
                {conversations.length === 0 ? (
                  <p className="px-2 py-1.5 text-[13px] text-muted-foreground">No past chats</p>
                ) : (
                  conversations.map((conversation) => {
                    const current = conversation.id === conversationId
                    return (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => {
                          setHistoryOpen(false)
                          onOpenConversation(conversation.id)
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        <span className="min-w-0 flex-1 truncate">{conversation.title ?? 'Untitled'}</span>
                        {current ? <Check aria-hidden className="size-3.5 shrink-0 text-primary" /> : null}
                      </button>
                    )
                  })
                )}
              </div>
            ) : null}
          </div>
          {hasConversation && !pending ? (
            <Button variant="ghost" size="sm" onClick={onNewConversation}>
              <Plus aria-hidden className="size-3.5" />
              New chat
            </Button>
          ) : null}
          <button
            type="submit"
            aria-label="Send"
            disabled={disabled || pending || empty}
            className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            <ArrowUp aria-hidden className="size-4" />
          </button>
        </div>
      </div>
    </form>
  )
}

/** The citation list under an assistant answer; each opens its source record. */
function Citations({ messageId }: { messageId: string }): ReactNode {
  const { navigate } = useRouter()
  const citations = useCitationsForSubject('chat_message', messageId)
  const rows = citations.data ?? []
  if (rows.length === 0) return null

  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Sources</p>
      <ol className="flex flex-col gap-1">
        {rows.map((citation, index) => {
          const route: Route =
            citation.sourceType === 'interaction'
              ? { kind: 'interaction', id: citation.sourceId }
              : { kind: 'document', id: citation.sourceId }
          return (
            <li key={citation.id}>
              <button
                type="button"
                onClick={() => navigate(route)}
                className="group flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left text-xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              >
                <span className="font-mono text-[10px] text-muted-foreground">[{index + 1}]</span>
                {citation.sourceType === 'interaction' ? (
                  <MessagesSquare className="mt-0.5 size-3 shrink-0" />
                ) : (
                  <FileText className="mt-0.5 size-3 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-foreground">{citation.sourceTitle ?? 'Source'}</span>
                  <span className="line-clamp-2 text-muted-foreground">{citation.quote}</span>
                </span>
                <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-0 group-hover:opacity-100" />
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
