import type { ReactNode } from 'react'
import { ArrowDownToLine, RefreshCw, RotateCw } from 'lucide-react'
import { Button } from '../../components/button'
import { SettingsField } from '../../components/settings/field'
import { useUpdate } from '../../providers/update-provider'

/**
 * The manual path to the same updater the app checks on launch: one button
 * whose label tracks the update lifecycle, with the outcome reported inline.
 * (Layout adapted from Reflect Open's `UpdateField`.)
 */
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
    <SettingsField
      legend="Updates"
      description="Local Brain checks for new versions on launch and installs them only when you say so."
    >
      <div className="mt-3 flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={run === undefined}
          onClick={run ? () => void run() : undefined}
        >
          <action.icon
            aria-hidden
            strokeWidth={1.75}
            className={action.spinning ? 'size-3.5 animate-spin' : 'size-3.5'}
          />
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
    </SettingsField>
  )
}
