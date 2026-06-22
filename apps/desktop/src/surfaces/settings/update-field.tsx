import type { ReactNode } from 'react'
import { ArrowDownToLine, RefreshCw, RotateCw } from 'lucide-react'
import { Button } from '../../components/button'
import { useUpdate } from '../../providers/update-provider'

export function UpdateField(): ReactNode {
  const { state, checkNow, install, restart } = useUpdate()

  const action: {
    label: string
    icon: typeof RefreshCw
    run?: (() => Promise<void>) | undefined
    spinning?: boolean | undefined
  } = (() => {
    switch (state.phase) {
      case 'checking':
        return { label: 'Checking...', icon: RefreshCw, spinning: true }
      case 'available':
        return { label: `Install ${state.version}`, icon: ArrowDownToLine, run: install }
      case 'downloading':
        return {
          label: `Downloading${state.percent !== null ? ` ${state.percent}%` : '...'}`,
          icon: ArrowDownToLine,
        }
      case 'ready':
        return { label: 'Restart to update', icon: RotateCw, run: restart }
      case 'error':
        return state.during === 'install'
          ? { label: 'Retry install', icon: ArrowDownToLine, run: install }
          : { label: 'Check for updates', icon: RefreshCw, run: checkNow }
      default:
        return { label: 'Check for updates', icon: RefreshCw, run: checkNow }
    }
  })()

  const run = action.run
  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={run === undefined}
          onClick={run ? () => void run() : undefined}
        >
          <action.icon className={action.spinning ? 'size-3.5 animate-spin' : 'size-3.5'} />
          {action.label}
        </Button>
        {state.phase === 'upToDate' ? (
          <span role="status" className="text-xs text-muted-foreground">
            You're up to date.
          </span>
        ) : null}
        {state.phase === 'error' ? (
          <span role="alert" className="text-xs text-destructive">
            {state.message}
          </span>
        ) : null}
      </div>
    </div>
  )
}
