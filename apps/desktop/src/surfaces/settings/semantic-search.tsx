import type { ReactNode } from 'react'
import { Button } from '../../components/button'
import { SettingsField } from '../../components/settings/field'
import { SettingsSection } from '../../components/settings/section'
import { cn } from '../../lib/utils'
import {
  useBackfillEmbeddingsNow,
  useEmbeddingsStatus,
  useRebuildEmbeddings,
  useSetEmbeddingsEnabled,
} from '../../lib/queries'
import { describeLastBackfill } from './format'
import { ModelDownloadProgress } from './model-download-progress'

export function SemanticSearchSettings(): ReactNode {
  const query = useEmbeddingsStatus()
  const setEnabled = useSetEmbeddingsEnabled()
  const backfill = useBackfillEmbeddingsNow()
  const rebuild = useRebuildEmbeddings()
  const status = query.data
  const runtime = status?.runtime
  const busy = setEnabled.isPending || backfill.isPending || rebuild.isPending

  const indexedPct =
    status && status.totalChunks > 0 ? Math.round((status.indexed / status.totalChunks) * 100) : 0

  return (
    <SettingsSection id="search">
      <SettingsField
        legend="Semantic search"
        description="Find records by meaning in command-palette search and Chat. Vectors are computed on this machine with a local model."
      >
        <div className="mt-3 flex flex-col gap-3 text-sm">
          {status && !status.enabled ? (
            <div>
              <Button variant="primary" disabled={busy} onClick={() => setEnabled.mutate(true)}>
                Enable semantic search
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Turning this on downloads the model (~90 MB) once, then indexes your existing
                records.
              </p>
            </div>
          ) : null}

          {status?.enabled && runtime?.status === 'loading' ? (
            <ModelDownloadProgress progress={runtime.progress} />
          ) : null}

          {status?.enabled && runtime?.status === 'failed' ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
              <p>Couldn’t load the embedding model: {runtime.message}</p>
              <div className="mt-3 flex items-center gap-2">
                <Button variant="outline" disabled={busy} onClick={() => setEnabled.mutate(true)}>
                  Try again
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setEnabled.mutate(false)}>
                  Disable
                </Button>
              </div>
            </div>
          ) : null}

          {status?.enabled && runtime?.status !== 'failed' && status.backfillError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
              Indexing stopped after an error: {status.backfillError}. Use “Rebuild index” to try
              again.
            </div>
          ) : null}

          {status?.enabled && (runtime?.status === 'ready' || runtime?.status === 'uninitialized') ? (
            <div className="rounded-md border border-border bg-background px-4 py-3">
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">Status</dt>
                <dd
                  className={cn(
                    'font-mono',
                    status.backfillError
                      ? 'text-destructive'
                      : status.ready
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-blue-600 dark:text-blue-400',
                  )}
                >
                  {status.backfillError
                    ? 'error'
                    : status.ready
                      ? 'ready'
                      : status.pending > 0
                        ? 'indexing'
                        : 'preparing'}
                </dd>
                <dt className="text-muted-foreground">Model</dt>
                <dd className="font-mono text-foreground">{status.modelId}</dd>
                <dt className="text-muted-foreground">Indexed</dt>
                <dd className="font-mono text-foreground">
                  {status.indexed} / {status.totalChunks} chunks ({indexedPct}%)
                </dd>
                {status.pending > 0 ? (
                  <>
                    <dt className="text-muted-foreground">Pending</dt>
                    <dd className="font-mono text-foreground">{status.pending} to embed</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Last backfill</dt>
                <dd className="font-mono text-foreground">
                  {describeLastBackfill(status.lastBackfillAttemptDay)}
                </dd>
              </dl>
            </div>
          ) : null}

          {status?.enabled && runtime?.status !== 'failed' ? (
            <div className="flex items-center gap-2">
              <Button variant="primary" disabled={busy} onClick={() => backfill.mutate()}>
                {backfill.isPending ? 'Updating…' : 'Update index'}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => rebuild.mutate()}>
                {rebuild.isPending ? 'Rebuilding…' : 'Rebuild index'}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setEnabled.mutate(false)}>
                Disable
              </Button>
              <span className="text-xs text-muted-foreground">
                Disabling stops semantic results without deleting the local index.
              </span>
            </div>
          ) : null}
        </div>
      </SettingsField>
    </SettingsSection>
  )
}
