import type { ReactNode } from 'react'
import { Database, KeyRound, Terminal, Sparkles } from 'lucide-react'
import {
  useCompleteFirstRun,
  useDatabasePath,
  useFirstRun,
  useModelStatus,
} from '../lib/queries'
import { useBlockingModal } from '../lib/commands/use-blocking-modal'
import { useRouter } from '../routing/router'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

/**
 * First-run onboarding (Plan 09). Shown once on a fresh install: it confirms
 * where the local brain lives, the model-boundary status for extraction, and how to
 * start — set an AI provider or drive it from the `brain` CLI.
 * Dismissing it sets a settings flag so it never reappears.
 *
 * Built on the shared {@link Dialog} primitive, so focus trap, focus restore, and
 * scroll lock come from Radix. It is a blocking gate: only the explicit actions
 * below close it (each flips the first-run flag, which unmounts this), so Escape
 * and outside clicks are refused.
 */
export function FirstRun(): ReactNode {
  const firstRun = useFirstRun()
  const complete = useCompleteFirstRun()
  const dbPath = useDatabasePath()
  const model = useModelStatus()
  const { navigate } = useRouter()

  // Only show once we know it hasn't been completed (avoid a flash while loading).
  const shown = firstRun.data === false

  // While shown, suppress global shortcuts (⌘K, navigation, …) so the gate also
  // blocks keyboard users; Radix already blocks pointer/focus to the background.
  useBlockingModal(shown)

  if (!shown) return null

  // Refuse Escape / outside-click dismissal so the gate cannot be skipped.
  const blockDismiss = (event: Event): void => event.preventDefault()

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        placement="center"
        className="w-[36rem] p-6"
        onEscapeKeyDown={blockDismiss}
        onPointerDownOutside={blockDismiss}
        onInteractOutside={blockDismiss}
      >
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <DialogTitle className="font-serif text-xl font-normal text-foreground">
            Welcome to Local Brain
          </DialogTitle>
        </div>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          A private, local-first personal CRM and knowledge base. Everything stays in the brain
          folder you selected on this machine — nothing is uploaded.
        </DialogDescription>

        <ul className="mb-5 flex flex-col gap-3 text-sm">
          <li className="flex items-start gap-2.5">
            <Database className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              <span className="font-medium text-foreground">SQLite database</span>
              <span className="mt-0.5 block break-all font-mono text-[11px] text-muted-foreground">
                {dbPath.data ?? 'resolving…'}
              </span>
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              <span className="font-medium text-foreground">Bring your own model (optional)</span>
              <span className="mt-0.5 block text-muted-foreground">
                Extraction stays off until you add an AI provider.{' '}
                {model.data?.configured ? 'A model is configured.' : 'No model is configured yet.'}
              </span>
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <Terminal className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              <span className="font-medium text-foreground">Drive it from your agent</span>
              <span className="mt-0.5 block text-muted-foreground">
                The bundled <code className="font-mono">brain</code> CLI + the{' '}
                <code className="font-mono">brain</code> skill let local agents read and write your
                brain.
              </span>
            </span>
          </li>
        </ul>

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              complete.mutate()
              navigate({ kind: 'settings', section: 'ai-providers' })
            }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Set up an AI provider
          </button>
          <button
            type="button"
            disabled={complete.isPending}
            onClick={() => complete.mutate()}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-40"
          >
            Get started
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
