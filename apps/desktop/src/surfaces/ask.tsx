import { useState, type FormEvent, type ReactNode } from 'react'
import { Plus, FileText, MessagesSquare, ExternalLink } from 'lucide-react'
import { Button } from '../components/button'
import { PageHead } from '../components/page-head'
import { cn } from '../lib/utils'
import { controlClass } from '../lib/ui'
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
    const result = await askMutation.mutateAsync({
      question: text,
      ...(conversationId ? { conversationId } : {}),
    })
    if (!conversationId) navigate({ kind: 'ask', conversationId: result.conversationId })
  }

  const status = modelStatus.data
  const messageList = messages.data ?? []

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4">
      <PageHead eyebrow="Ask" title="Ask" />
      {status && !status.canRun ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          {status.reason}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 gap-4">
        <aside className="flex w-56 shrink-0 flex-col gap-2">
          <Button variant="outline" onClick={() => navigate({ kind: 'ask' })} className="justify-start">
            <Plus className="size-3.5" />
            New conversation
          </Button>
          <ul className="flex flex-col gap-0.5 overflow-y-auto">
            {(conversations.data ?? []).map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => navigate({ kind: 'ask', conversationId: conversation.id })}
                  className={cn(
                    'w-full truncate rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                    conversation.id === conversationId
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/60',
                  )}
                >
                  {conversation.title ?? 'Untitled'}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            {!conversationId ? (
              <p className="px-1 py-6 text-sm text-muted-foreground">
                Ask a question about your brain. Answers stay grounded in your records, with citations
                that open the exact document or interaction.
              </p>
            ) : messageList.length === 0 ? (
              <p className="px-1 py-6 text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              <ul className="flex flex-col gap-3 py-1">
                {messageList.map((message) => (
                  <li
                    key={message.id}
                    className={cn(
                      'max-w-[80%] rounded-lg px-3 py-2 text-sm',
                      message.role === 'user'
                        ? 'self-end bg-accent text-foreground'
                        : 'w-full max-w-full self-start border border-border bg-card text-foreground',
                    )}
                  >
                    <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {message.role}
                      {message.model ? ` · ${message.model}` : ''}
                    </p>
                    <p className="whitespace-pre-wrap">{message.content}</p>
                    {message.role === 'assistant' ? <Citations messageId={message.id} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={onSubmit} className="mt-3 flex items-center gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask anything…"
              className={cn(controlClass, 'flex-1')}
            />
            <Button type="submit" variant="primary" disabled={pending || draft.trim().length === 0}>
              {pending ? 'Thinking…' : 'Send'}
            </Button>
          </form>
        </section>
      </div>
    </div>
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
