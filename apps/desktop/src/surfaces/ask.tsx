import { useState, type FormEvent, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '../components/button'
import { PageHead } from '../components/page-head'
import { cn } from '../lib/utils'
import { controlClass } from '../lib/ui'
import {
  useAddMessage,
  useConversations,
  useCreateConversation,
  useMessages,
} from '../lib/queries'
import { useRouter } from '../routing/router'

/**
 * The placeholder the assistant returns until Plan 06 wires retrieval. It is
 * persisted so a conversation reads as a real thread; the cited-answer panel
 * fills in once retrieval supplies grounded responses.
 */
const PLACEHOLDER_ANSWER =
  'I can’t answer yet — retrieval and cited answers are wired up in Plan 06. Your messages are saved here so the conversation is ready when it lands.'

/** The Ask shell: a conversation list, a chat panel, and a citations footer. */
export function AskSurface({
  conversationId,
}: {
  conversationId: string | undefined
}): ReactNode {
  const { navigate } = useRouter()
  const conversations = useConversations()
  const messages = useMessages(conversationId)
  const createConversation = useCreateConversation()
  const addMessage = useAddMessage()
  const [draft, setDraft] = useState('')

  const pending = createConversation.isPending || addMessage.isPending

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const text = draft.trim()
    if (!text || pending) return
    setDraft('')

    let id = conversationId
    if (!id) {
      id = await createConversation.mutateAsync(text.length > 60 ? `${text.slice(0, 59)}…` : text)
      navigate({ kind: 'ask', conversationId: id })
    }
    await addMessage.mutateAsync({ conversationId: id, role: 'user', content: text })
    await addMessage.mutateAsync({ conversationId: id, role: 'assistant', content: PLACEHOLDER_ANSWER })
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4">
      <PageHead eyebrow="Ask" title="Ask" />
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
                Ask a question about your brain. Answers stay grounded in your records — citations
                arrive with retrieval in Plan 06.
              </p>
            ) : (messages.data ?? []).length === 0 ? (
              <p className="px-1 py-6 text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              <ul className="flex flex-col gap-3 py-1">
                {(messages.data ?? []).map((message) => (
                  <li
                    key={message.id}
                    className={cn(
                      'max-w-[80%] rounded-lg px-3 py-2 text-sm',
                      message.role === 'user'
                        ? 'self-end bg-accent text-foreground'
                        : 'self-start border border-border bg-card text-foreground',
                    )}
                  >
                    <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {message.role}
                    </p>
                    <p className="whitespace-pre-wrap">{message.content}</p>
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
              Send
            </Button>
          </form>
        </section>
      </div>
    </div>
  )
}
