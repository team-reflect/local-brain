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

function progressState(progress: ByteProgress | undefined): {
  value: number | undefined
  title: string
  detail: string
  percent: string | null
  valueText: string
} {
  if (progress === undefined || progress.total <= 0) {
    return {
      value: undefined,
      title: 'Preparing download...',
      detail: 'Waiting for model download details',
      percent: null,
      valueText: 'Preparing download',
    }
  }

  const value = Math.min(Math.round((progress.downloaded / progress.total) * 100), 100)
  if (value >= 100) {
    return {
      value,
      title: 'Loading model...',
      detail: `${formatMegabytes(progress.total)} downloaded`,
      percent: '100%',
      valueText: `Loading model, 100%, ${formatMegabytes(progress.total)} downloaded`,
    }
  }

  const detail = `${formatMegabytes(progress.downloaded)} of ${formatMegabytes(progress.total)}`
  return {
    value,
    title: 'Downloading model',
    detail,
    percent: `${value}%`,
    valueText: `Downloading model, ${value}%, ${detail}`,
  }
}

/**
 * The embedding-model download as a progress bar: determinate while the
 * runtime reports byte counts, indeterminate while it is preparing or loading
 * the model around the measured download.
 */
export function ModelDownloadProgress({ progress }: ModelDownloadProgressProps): ReactNode {
  const state = progressState(progress)

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium text-foreground">{state.title}</span>
        {state.percent ? <span className="font-mono text-muted-foreground">{state.percent}</span> : null}
      </div>
      <Progress
        aria-label="Semantic search model download"
        aria-valuetext={state.valueText}
        value={state.value}
      />
      <p className="mt-1.5 text-xs text-muted-foreground">{state.detail}</p>
    </div>
  )
}
