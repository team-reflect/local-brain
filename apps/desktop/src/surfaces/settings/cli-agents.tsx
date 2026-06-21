import type { ReactNode } from 'react'
import { AlertTriangle, Check, Terminal } from 'lucide-react'
import { isAppError } from '@local-brain/core'
import { Button } from '../../components/button'
import { Section } from '../../components/section'
import { useCliStatus, useInstallCli, useUninstallCli } from '../../lib/queries'

const PATH_EXPORT = 'export PATH="$HOME/.local/bin:$PATH"'

export function CliAgentsSettings(): ReactNode {
  const status = useCliStatus()
  const install = useInstallCli()
  const uninstall = useUninstallCli()
  const data = status.data
  const busy = install.isPending || uninstall.isPending
  const error = install.error ?? uninstall.error ?? status.error

  return (
    <Section title="CLI & agents">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          The bundled brain CLI is the supported local interface for agents and terminal workflows.
        </p>

        <div className="rounded-lg border border-border bg-card p-4">
          {data ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Terminal className="size-4 text-primary" aria-hidden />
                <span className="font-semibold text-foreground">{statusTitle(data.installState)}</span>
                {data.installState === 'current' ? (
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Check className="size-3.5 text-primary" aria-hidden />
                    installed
                  </span>
                ) : null}
              </div>

              <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">Bundled CLI</dt>
                <dd className="min-w-0 font-mono text-foreground">
                  <span className="block truncate">{data.bundledPath}</span>
                  <span className="text-muted-foreground">{data.bundledVersion ?? 'not staged'}</span>
                </dd>
                <dt className="text-muted-foreground">Command path</dt>
                <dd className="min-w-0 font-mono text-foreground">
                  <span className="block truncate">{data.installTargetPath}</span>
                  {data.installedPath ? (
                    <span className="text-muted-foreground">points to {data.installedPath}</span>
                  ) : null}
                </dd>
              </dl>

              {data.supported && !data.targetDirOnPath ? (
                <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                  <div className="mb-1 flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="size-3.5" aria-hidden />
                    {data.installTargetDir} is not on PATH
                  </div>
                  <code className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono">
                    {PATH_EXPORT}
                  </code>
                </div>
              ) : null}

              {data.installState === 'conflict' ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  Another file already exists at the command path. Move it before installing the
                  Local Brain CLI.
                </div>
              ) : null}

              {!data.supported ? (
                <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                  PATH installation is only available in the macOS desktop app.
                </div>
              ) : null}

              <div className="flex items-center gap-2">
                {data.installState === 'current' ? (
                  <Button variant="outline" disabled={busy} onClick={() => uninstall.mutate()}>
                    {uninstall.isPending ? 'Removing...' : 'Remove command'}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    disabled={
                      !data.supported ||
                      data.bundledVersion === null ||
                      data.installState === 'conflict' ||
                      busy
                    }
                    onClick={() => install.mutate()}
                  >
                    {install.isPending
                      ? 'Installing...'
                      : data.installState === 'stale'
                        ? 'Repair command'
                        : 'Install command'}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Checking CLI installation...</p>
          )}
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {errorMessage(error)}
          </div>
        ) : null}
      </div>
    </Section>
  )
}

function errorMessage(error: unknown): string {
  if (isAppError(error)) return error.message
  if (error instanceof Error) return error.message
  return 'Could not update the CLI command.'
}

function statusTitle(state: string): string {
  switch (state) {
    case 'current':
      return 'brain command is installed'
    case 'stale':
      return 'brain command needs repair'
    case 'conflict':
      return 'brain command has a conflict'
    case 'unsupported':
      return 'brain command install is unavailable'
    case 'missing':
    default:
      return 'brain command is not installed'
  }
}
