import type { ReactNode } from 'react'
import type { Organization, Person } from '@local-brain/core'
import { X } from 'lucide-react'
import { Badge } from '../components/badge'
import { DataList, type Column } from '../components/data-list'
import { EmptyState } from '../components/empty-state'
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog'
import { cn } from '../lib/utils'
import { useOrganizations, usePeople } from '../lib/queries'
import { useRouter } from '../routing/router'
import { OrganizationDetail } from './detail/organization'
import { PersonDetail } from './detail/person'
import { GraphSurface } from './graph'

const TABS = [
  { key: 'graph', label: 'Graph' },
  { key: 'people', label: 'People' },
  { key: 'organizations', label: 'Organizations' },
] as const

type NetworkTab = (typeof TABS)[number]['key']

type NetworkDetail =
  | { kind: 'person'; id: string }
  | { kind: 'organization'; id: string }

export function NetworkSurface({ tab, detail }: { tab: NetworkTab; detail?: NetworkDetail }): ReactNode {
  const { navigate } = useRouter()
  const people = usePeople()
  const organizations = useOrganizations()

  const orgColumns: Column<Organization>[] = [
    {
      key: 'name',
      header: 'Name',
      width: 'minmax(14rem, 1fr)',
      render: (org) => <span className="text-foreground">{org.name}</span>,
    },
    {
      key: 'kind',
      header: 'Kind',
      width: '7rem',
      className: 'w-28',
      render: (org) => <span className="text-muted-foreground">{org.kind ?? '—'}</span>,
    },
    {
      key: 'domain',
      header: 'Domain',
      width: '12rem',
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
      width: 'minmax(12rem, 0.9fr)',
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
      width: 'minmax(14rem, 1.1fr)',
      render: (person) => (
        <span className="text-muted-foreground">{person.headline ?? '—'}</span>
      ),
    },
    {
      key: 'strength',
      header: 'Strength',
      width: '6rem',
      className: 'w-24',
      render: (person) => (
        <span className="font-mono text-[11px] text-muted-foreground">
          {person.relationshipStrength ?? '—'}
        </span>
      ),
    },
  ]

  return (
    <>
      <div className="mx-auto grid h-full min-h-0 max-w-6xl grid-cols-[10rem_minmax(0,1fr)] gap-6">
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
        <div className="min-h-0 min-w-0">
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
              virtualize
              estimateRowHeight={40}
            />
          ) : (
            <DataList
              rows={organizations.data ?? []}
              columns={orgColumns}
              rowKey={(org) => org.id}
              isLoading={organizations.isLoading}
              onRowClick={(org) => navigate({ kind: 'organization', id: org.id })}
              empty={<EmptyState title="No organizations yet" />}
              virtualize
              estimateRowHeight={40}
            />
          )}
        </div>
      </div>
      {detail ? (
        <NetworkDetailDrawer
          detail={detail}
          onClose={() =>
            navigate({
              kind: 'network',
              tab: detail.kind === 'person' ? 'people' : 'organizations',
            })
          }
        />
      ) : null}
    </>
  )
}

function NetworkDetailDrawer({
  detail,
  onClose,
}: {
  detail: NetworkDetail
  onClose: () => void
}): ReactNode {
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        overlayClassName="items-stretch justify-end overflow-hidden bg-foreground/10 px-0 py-0 backdrop-blur-0"
        className="my-0 h-full max-h-full w-[min(40rem,calc(100vw-4rem))] max-w-none rounded-none rounded-l-lg border-y-0 border-r-0 shadow-[0_18px_48px_rgba(2,6,23,0.22)] data-[state=open]:slide-in-from-right-4 data-[state=closed]:slide-out-to-right-4"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Network detail</DialogTitle>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          title="Close"
          className="absolute right-3 top-3 z-10 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto py-8 pl-7 pr-12">
          {detail.kind === 'person' ? <PersonDetail id={detail.id} /> : <OrganizationDetail id={detail.id} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
