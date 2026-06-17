import type { ReactNode } from 'react'
import type { Person } from '@local-brain/core'
import { DataList, type Column } from '../components/data-list'
import { EmptyState } from '../components/empty-state'
import { PageHead } from '../components/page-head'
import { cn } from '../lib/utils'
import { usePeople } from '../lib/queries'
import { useRouter } from '../routing/router'

const TABS = [
  { key: 'people', label: 'People' },
  { key: 'organizations', label: 'Organizations' },
] as const

export function NetworkSurface({ tab }: { tab: 'people' | 'organizations' }): ReactNode {
  const { navigate } = useRouter()
  const people = usePeople()

  const columns: Column<Person>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (person) => (
        <span className="text-foreground">
          {person.fullName}
          {person.isSelf ? (
            <span className="ml-2 font-mono text-[10px] uppercase text-muted-foreground">you</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'headline',
      header: 'Headline',
      render: (person) => (
        <span className="text-muted-foreground">{person.headline ?? '—'}</span>
      ),
    },
    {
      key: 'strength',
      header: 'Strength',
      className: 'w-24',
      render: (person) => (
        <span className="font-mono text-[11px] text-muted-foreground">
          {person.relationshipStrength ?? '—'}
        </span>
      ),
    },
  ]

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <PageHead
        eyebrow="Network"
        title="Network"
        actions={
          <div className="flex items-center gap-1">
            {TABS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => navigate({ kind: 'network', tab: option.key })}
                className={cn(
                  'rounded px-2 py-1 text-xs transition-colors',
                  tab === option.key
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />
      {tab === 'people' ? (
        <DataList
          rows={people.data ?? []}
          columns={columns}
          rowKey={(person) => person.id}
          isLoading={people.isLoading}
          onRowClick={(person) => navigate({ kind: 'person', id: person.id })}
          empty={<EmptyState title="No people yet" />}
        />
      ) : (
        <EmptyState
          title="Organizations"
          hint="Organization browsing arrives with the org getters in a follow-up."
        />
      )}
    </div>
  )
}
