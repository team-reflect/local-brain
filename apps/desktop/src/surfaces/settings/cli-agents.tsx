import type { ReactNode } from 'react'
import { AlertTriangle, Check, Terminal } from 'lucide-react'
import { isAppError } from '@local-brain/core'
import { Button } from '../../components/button'
import { Section } from '../../components/section'
import {
  useCliStatus,
  useInstallCli,
  useInstallSkill,
  useSkillStatus,
  useUninstallCli,
  useUninstallSkill,
} from '../../lib/queries'

const PATH_EXPORT = 'export PATH="$HOME/.local/bin:$PATH"'

export function CliAgentsSettings(): ReactNode {
  const cliStatus = useCliStatus()
  const cliInstall = useInstallCli()
  const cliUninstall = useUninstallCli()
  const skillStatus = useSkillStatus()
  const skillInstall = useInstallSkill()
  const skillUninstall = useUninstallSkill()
  const error =
    cliInstall.error ??
    cliUninstall.error ??
    cliStatus.error ??
    skillInstall.error ??
    skillUninstall.error ??
    skillStatus.error

  return (
    <Section title="CLI & agents">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          The bundled brain CLI and agent skill are the supported local interface for agents and
          terminal workflows.
        </p>

        <CliInstallCard status={cliStatus} install={cliInstall} uninstall={cliUninstall} />
        <SkillInstallCard status={skillStatus} install={skillInstall} uninstall={skillUninstall} />

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {errorMessage(error)}
          </div>
        ) : null}
      </div>
    </Section>
  )
}

interface MutationState {
  isPending: boolean
  mutate: () => void
}

function CliInstallCard({
  status,
  install,
  uninstall,
}: {
  status: ReturnType<typeof useCliStatus>
  install: MutationState
  uninstall: MutationState
}): ReactNode {
  const data = status.data
  const busy = install.isPending || uninstall.isPending

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      {data ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Terminal className="size-4 text-primary" aria-hidden />
            <span className="font-semibold text-foreground">{cliStatusTitle(data.installState)}</span>
            {data.installState === 'current' ? <InstalledBadge /> : null}
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
            <WarningBox title={`${data.installTargetDir} is not on PATH`}>
              <code className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono">
                {PATH_EXPORT}
              </code>
            </WarningBox>
          ) : null}

          {data.installState === 'conflict' ? (
            <ConflictBox>
              Another file already exists at the command path. Move it before installing the Local
              Brain CLI.
            </ConflictBox>
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
  )
}

function SkillInstallCard({
  status,
  install,
  uninstall,
}: {
  status: ReturnType<typeof useSkillStatus>
  install: MutationState
  uninstall: MutationState
}): ReactNode {
  const data = status.data
  const busy = install.isPending || uninstall.isPending

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      {data ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Terminal className="size-4 text-primary" aria-hidden />
            <span className="font-semibold text-foreground">{skillStatusTitle(data.installState)}</span>
            {data.installState === 'current' ? <InstalledBadge /> : null}
          </div>

          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Agent skills</dt>
            <dd className="min-w-0 font-mono text-foreground">
              <ul className="flex min-w-0 flex-col gap-1">
                {data.skills.map((skill) => (
                  <li key={skill.id} className="min-w-0">
                    <span className="block truncate">{skill.installTargetDir}</span>
                    <span className="text-muted-foreground">
                      bundled {skill.bundledHash.slice(0, 12)}
                      {skill.installedHash ? ` · installed ${skill.installedHash.slice(0, 12)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </dl>

          {data.installState === 'conflict' ? (
            <ConflictBox>
              Another skill already exists at one of these paths. Move it before installing the
              Local Brain agent skills.
            </ConflictBox>
          ) : null}

          {!data.supported ? (
            <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
              Agent skill installation needs a writable home directory.
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            {data.installState === 'current' ? (
              <Button variant="outline" disabled={busy} onClick={() => uninstall.mutate()}>
                {uninstall.isPending ? 'Removing...' : 'Remove skills'}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={!data.supported || data.installState === 'conflict' || busy}
                onClick={() => install.mutate()}
              >
                {install.isPending
                  ? 'Installing...'
                  : data.installState === 'stale'
                    ? 'Repair skills'
                    : 'Install skills'}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Checking skill installation...</p>
      )}
    </div>
  )
}

function InstalledBadge(): ReactNode {
  return (
    <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Check className="size-3.5 text-primary" aria-hidden />
      installed
    </span>
  )
}

function WarningBox({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="mb-1 flex items-center gap-1.5 font-medium">
        <AlertTriangle className="size-3.5" aria-hidden />
        {title}
      </div>
      {children}
    </div>
  )
}

function ConflictBox({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      {children}
    </div>
  )
}

function errorMessage(error: unknown): string {
  if (isAppError(error)) return error.message
  if (error instanceof Error) return error.message
  return 'Could not update the CLI command.'
}

function cliStatusTitle(state: string): string {
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

function skillStatusTitle(state: string): string {
  switch (state) {
    case 'current':
      return 'Agent skills are installed'
    case 'stale':
      return 'Agent skills need repair'
    case 'conflict':
      return 'Agent skills have a conflict'
    case 'unsupported':
      return 'Agent skill install is unavailable'
    case 'missing':
    default:
      return 'Agent skills are not installed'
  }
}
