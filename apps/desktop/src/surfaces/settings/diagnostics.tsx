import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { appVersion } from '@local-brain/core'
import { Section } from '../../components/section'
import {
  useActiveBrain,
  useBrains,
  useDatabasePath,
  useEmbeddingsStatus,
  useModelSettings,
  useModelStatus,
} from '../../lib/queries'
import { describeSemantic } from './format'

export function DiagnosticsSettings(): ReactNode {
  const info = useQuery({ queryKey: ['app-version'], queryFn: appVersion })
  const model = useModelStatus()
  const settings = useModelSettings()
  const path = useDatabasePath()
  const active = useActiveBrain()
  const brains = useBrains()
  const embeddings = useEmbeddingsStatus()

  const brainCount = brains.data?.length
  const lines: [string, string][] = [
    ['app', info.data ? `${info.data.name} v${info.data.version} · ${info.data.platform}` : '…'],
    [
      'brain',
      active.data
        ? `${active.data.name}${active.data.schemaVersion != null ? ` · schema v${active.data.schemaVersion}` : ''}` +
          (brainCount ? ` · ${brainCount} known` : '')
        : '…',
    ],
    ['database', path.data ?? '…'],
    ['migrations', 'applied at startup (schema versioned)'],
    ['lexical search', 'FTS5 (available)'],
    ['semantic search', describeSemantic(embeddings.data)],
    [
      'keychain',
      settings.data
        ? settings.data.providers.length > 0
          ? `${settings.data.providers.length} provider key${settings.data.providers.length === 1 ? '' : 's'} configured`
          : 'no provider key'
        : '…',
    ],
    ['model', model.data ? (model.data.canRun ? 'ready' : `unavailable (${model.data.reason})`) : '…'],
    ['CLI / skill', 'brain sidecar bundled · skills/brain/SKILL.md'],
  ]

  return (
    <Section title="Diagnostics">
      <div className="rounded-lg border border-border bg-card px-4 py-3 font-mono text-xs text-card-foreground">
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5">
          {lines.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  )
}
