import { useState, type ReactNode } from 'react'
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import type { ChatConversation } from '@local-brain/core'
import { Alert } from '../alert'
import { Button } from '../button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { cn, errorMessage } from '../../lib/utils'

export function ConversationRail({
  activeId,
  conversations,
  deleting,
  onNew,
  onOpen,
  onDelete,
}: {
  activeId: string | undefined
  conversations: ChatConversation[]
  deleting: boolean
  onNew: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => Promise<void>
}): ReactNode {
  const [deleteTarget, setDeleteTarget] = useState<ChatConversation | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return
    setDeleteError(null)
    try {
      await onDelete(deleteTarget.id)
      setDeleteTarget(null)
    } catch (error) {
      setDeleteError(errorMessage(error))
    }
  }

  return (
    <>
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
            conversations.map((conversation) => {
              const active = conversation.id === activeId
              const title = conversation.title ?? 'Untitled'
              return (
                <div
                  key={conversation.id}
                  className={cn(
                    'group -ml-2 -mr-1 flex items-center rounded-md transition-colors',
                    active
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(conversation.id)}
                    className="min-w-0 flex-1 px-2 py-1.5 text-left text-xs"
                  >
                    <span className="block truncate">{title}</span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        disabled={deleting}
                        aria-label={`Conversation actions for ${title}`}
                        className={cn(
                          'mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors hover:bg-background/80 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:opacity-100 group-hover:opacity-100',
                          active && 'opacity-100',
                        )}
                      >
                        <MoreHorizontal className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-max min-w-44">
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={deleting}
                        className="whitespace-nowrap"
                        onSelect={() => {
                          setDeleteError(null)
                          setDeleteTarget(conversation)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                        Delete conversation
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )
            })
          )}
        </nav>
      </aside>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (deleting) return
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent className="w-[26rem]" aria-label="Delete conversation">
          <DialogTitle className="border-b border-border px-4 py-2.5">
            Delete conversation?
          </DialogTitle>
          <div className="flex flex-col gap-3 px-4 py-3">
            {deleteError ? <Alert variant="error">{deleteError}</Alert> : null}
            <DialogDescription>
              This removes the conversation from your chat history.
            </DialogDescription>
            <p className="truncate rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-card-foreground">
              {deleteTarget?.title ?? 'Untitled'}
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
