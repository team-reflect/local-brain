import type { ReactNode } from 'react'
import type { ByteProgress } from '@local-brain/core'
import { Progress } from '../../components/ui/progress'

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
      <Progress
        aria-label="Semantic search model download"
        value={fraction !== null ? Math.round(fraction * 100) : undefined}
      />
      <p className="mt-1.5 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
