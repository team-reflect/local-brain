import type { ReactNode } from 'react'
import type { ByteProgress } from '@local-brain/core'

interface ModelDownloadProgressProps {
  /** Byte counts from an active download, once the runtime has reported them. */
  progress?: ByteProgress | undefined
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`
}

/**
 * The embedding-model download as a progress bar: determinate while the
 * runtime reports byte counts, indeterminate while it is preparing or loading
 * the model around the measured download.
 */
export function ModelDownloadProgress({ progress }: ModelDownloadProgressProps): ReactNode {
  const fraction =
    progress !== undefined && progress.total > 0
      ? Math.min(progress.downloaded / progress.total, 1)
      : null
  const label =
    progress !== undefined && fraction !== null && fraction < 1
      ? `Downloading the model — ${formatMegabytes(progress.downloaded)} of ${formatMegabytes(progress.total)}`
      : 'Preparing the model...'

  return (
    <div>
      <div
        role="progressbar"
        aria-label="Semantic search model download"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fraction !== null ? Math.round(fraction * 100) : undefined}
        className="h-1.5 overflow-hidden rounded-full bg-accent"
      >
        {fraction !== null ? (
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${fraction * 100}%` }}
          />
        ) : (
          <div className="h-full w-full animate-pulse rounded-full bg-primary/40" />
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
