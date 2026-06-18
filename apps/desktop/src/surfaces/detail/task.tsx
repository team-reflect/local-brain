import type { ReactNode } from 'react'
import { DetailFields } from '../../components/detail-fields'
import { EmptyState } from '../../components/empty-state'
import { LinkedRecords } from '../../components/linked-records'
import { PageHead } from '../../components/page-head'
import { useTask, useTaskLinks, useUnlinkFrom } from '../../lib/queries'

export function TaskDetail({ id }: { id: string }): ReactNode {
  const task = useTask(id)
  const links = useTaskLinks(id)
  const onUnlink = useUnlinkFrom({ kind: 'task', id })

  if (task.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!task.data) return <EmptyState title="Task not found" />

  const t = task.data
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHead eyebrow="Task" title={t.title} />
      <DetailFields
        fields={[
          { label: 'Status', value: t.status },
          { label: 'Priority', value: t.priority ?? '—' },
          { label: 'Due', value: t.dueAt?.slice(0, 10) ?? '—' },
          { label: 'Scheduled', value: t.scheduledFor?.slice(0, 10) ?? '—' },
          { label: 'Completed', value: t.completedAt?.slice(0, 10) ?? '—' },
        ]}
      />
      {t.description ? <p className="text-sm text-foreground">{t.description}</p> : null}
      {links.data ? (
        <>
          <LinkedRecords title="Project" records={links.data.projects} onUnlink={onUnlink} />
          <LinkedRecords title="People" records={links.data.people} onUnlink={onUnlink} />
          <LinkedRecords title="Documents" records={links.data.documents} onUnlink={onUnlink} />
          <LinkedRecords title="Interactions" records={links.data.interactions} onUnlink={onUnlink} />
        </>
      ) : null}
    </div>
  )
}
