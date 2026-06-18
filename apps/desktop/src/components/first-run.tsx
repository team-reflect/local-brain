import type { ReactNode } from 'react'
import { Database, KeyRound, Terminal, Sparkles } from 'lucide-react'
import {
  useCompleteFirstRun,
  useDatabasePath,
  useFirstRun,
  useModelStatus,
} from '../lib/queries'
import { useRouter } from '../routing/router'

/**
 * First-run onboarding (Plan 09). Shown once on a fresh install: it confirms
 * where the local brain lives, the (honest) model-boundary status, and how to
 * start — add a record, set a provider key, or drive it from the `brain` CLI.
 * Dismissing it sets a settings flag so it never reappears.
 */
export function FirstRun(): ReactNode {
  const firstRun = useFirstRun()
  const complete = useCompleteFirstRun()
  const dbPath = useDatabasePath()
  const model = useModelStatus()
  const { navigate } = useRouter()

  // Only show once we know it hasn't been completed (avoid a flash while loading).
  if (firstRun.data !== false) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-[36rem] max-w-[92vw] rounded-xl border border-border bg-card p-6 shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <h2 className="font-serif text-xl text-foreground">Welcome to Local Brain</h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          A private, local-first personal CRM and knowledge base. Everything stays in one SQLite
          database on this machine — nothing is uploaded.
        </p>

        <ul className="mb-5 flex flex-col gap-3 text-sm">
          <li className="flex items-start gap-2.5">
            <Database className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              <span className="font-medium text-foreground">Your data lives here</span>
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
                Ask and extraction stay off until you add a provider key.{' '}
                {model.data?.canRun ? 'A model is configured.' : 'No model is configured yet.'}
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
              navigate({ kind: 'settings', section: 'model-keys' })
            }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Set up a model key
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
