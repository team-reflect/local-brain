import type { ReactNode } from 'react'
import type { Organization, Person } from '@local-brain/core'
import { Badge } from '../components/badge'
import { DataList, type Column } from '../components/data-list'
import { EmptyState } from '../components/empty-state'
import { cn } from '../lib/utils'
import { useOrganizations, usePeople } from '../lib/queries'
import { useRouter } from '../routing/router'
import { GraphSurface } from './graph'

const TABS = [
  { key: 'graph', label: 'Graph' },
  { key: 'people', label: 'People' },
  { key: 'organizations', label: 'Organizations' },
] as const

type NetworkTab = (typeof TABS)[number]['key']

export function NetworkSurface({ tab }: { tab: NetworkTab }): ReactNode {
  const { navigate } = useRouter()
  const people = usePeople()
  const organizations = useOrganizations()

  const orgColumns: Column<Organization>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (org) => <span className="text-foreground">{org.name}</span>,
    },
    {
      key: 'kind',
      header: 'Kind',
      className: 'w-28',
      render: (org) => <span className="text-muted-foreground">{org.kind ?? '—'}</span>,
    },
    {
      key: 'domain',
      header: 'Domain',
      className: 'w-48',
      render: (org) => (
        <span className="font-mono text-[11px] text-muted-foreground">{org.domain ?? '—'}</span>
      ),
    },
  ]

  const columns: Column<Person>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (person) => (
        <span className="text-foreground">
          {person.fullName}
          {person.isSelf ? (
            <Badge tone="accent" className="ml-2">
              You
            </Badge>
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
    <div className="mx-auto grid max-w-6xl grid-cols-[10rem_minmax(0,1fr)] gap-6">
      <nav className="flex h-fit flex-col gap-0.5 border-l border-border py-1">
        {TABS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => navigate({ kind: 'network', tab: option.key })}
            aria-current={tab === option.key ? 'page' : undefined}
            className={cn(
              'rounded-r-md border-l-2 px-3 py-1.5 text-left text-sm font-medium transition-colors',
              tab === option.key
                ? '-ml-px border-primary text-foreground'
                : '-ml-px border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0">
        {tab === 'graph' ? (
          <GraphSurface showHeader={false} />
        ) : tab === 'people' ? (
          <DataList
            rows={people.data ?? []}
            columns={columns}
            rowKey={(person) => person.id}
            isLoading={people.isLoading}
            onRowClick={(person) => navigate({ kind: 'person', id: person.id })}
            empty={<EmptyState title="No people yet" />}
          />
        ) : (
          <DataList
            rows={organizations.data ?? []}
            columns={orgColumns}
            rowKey={(org) => org.id}
            isLoading={organizations.isLoading}
            onRowClick={(org) => navigate({ kind: 'organization', id: org.id })}
            empty={<EmptyState title="No organizations yet" />}
          />
        )}
      </div>
    </div>
  )
}
