import type { ReactNode } from 'react'
import { ArrowDownToLine, RotateCw } from 'lucide-react'
import { useUpdate } from '../providers/update-provider'

export function UpdateNotice(): ReactNode {
  const { state, install, restart } = useUpdate()

  if (
    state.phase !== 'available' &&
    state.phase !== 'downloading' &&
    state.phase !== 'ready' &&
    !(state.phase === 'error' && state.during === 'install')
  ) {
    return null
  }

  if (state.phase === 'downloading') {
    return (
      <div role="status" className="px-6 py-1.5 text-xs font-medium text-muted-foreground">
        Downloading update{state.percent !== null ? ` ${state.percent}%` : '...'}
      </div>
    )
  }

  const ready = state.phase === 'ready'
  const Icon = ready ? RotateCw : ArrowDownToLine
  const label = ready
    ? 'Restart to update'
    : state.phase === 'error'
      ? 'Update failed - try again'
      : 'Install update'
  const action = ready ? restart : install

  return (
    <div className="px-4 pb-2">
      <button
        type="button"
        onClick={() => void action()}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-secondary/60"
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      </button>
    </div>
  )
}
