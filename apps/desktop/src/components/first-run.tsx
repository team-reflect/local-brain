import { useEffect, useRef, type ReactNode } from 'react'
import { Database, KeyRound, Terminal, Sparkles } from 'lucide-react'
import {
  useCompleteFirstRun,
  useDatabasePath,
  useFirstRun,
  useModelStatus,
} from '../lib/queries'
import { pushBlockingModal } from '../lib/commands/modal-guard'
import { useRouter } from '../routing/router'

/**
 * First-run onboarding (Plan 09). Shown once on a fresh install: it confirms
 * where the local brain lives, the (honest) model-boundary status, and how to
 * start — set an AI provider or drive it from the `brain` CLI.
 * Dismissing it sets a settings flag so it never reappears.
 */
export function FirstRun(): ReactNode {
  const firstRun = useFirstRun()
  const complete = useCompleteFirstRun()
  const dbPath = useDatabasePath()
  const model = useModelStatus()
  const { navigate } = useRouter()
  const dialogRef = useRef<HTMLDivElement>(null)

  // Only show once we know it hasn't been completed (avoid a flash while loading).
  const shown = firstRun.data === false

  // While shown, this overlay blocks the app: suppress global shortcuts and keep
  // keyboard focus inside the dialog so background controls cannot be reached.
  useEffect(() => {
    if (!shown) return
    return pushBlockingModal()
  }, [shown])

  useEffect(() => {
    if (!shown) return
    const node = dialogRef.current
    if (!node) return
    const focusable = (): HTMLElement[] =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled'))
    focusable()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      if (!node.contains(active)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    node.addEventListener('keydown', onKeyDown)
    return () => node.removeEventListener('keydown', onKeyDown)
  }, [shown])

  if (!shown) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-title"
        className="w-[36rem] max-w-[92vw] rounded-xl border border-border bg-card p-6 shadow-xl"
      >
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <h2 id="first-run-title" className="font-serif text-xl text-foreground">
            Welcome to Local Brain
          </h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          A private, local-first personal CRM and knowledge base. Everything stays in the brain
          folder you selected on this machine — nothing is uploaded.
        </p>

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
                Ask and extraction stay off until you add an AI provider.{' '}
                {model.data?.configured
                  ? model.data.canRun
                    ? 'A model is configured.'
                    : 'A model is configured (external calls are turned off in Settings).'
                  : 'No model is configured yet.'}
              </span>
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <Terminal className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              <span className="font-medium text-foreground">Drive it from your agent</span>
              <span className="mt-0.5 block text-muted-foreground">
                The bundled <code className="font-mono">brain</code> CLI + the{' '}
                <code className="font-mono">brain</code> skill let Codex read and write your brain.
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
      </div>
    </div>
  )
}
