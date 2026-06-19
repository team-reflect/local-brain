import type { ReactNode } from 'react'
import { StatusBadge } from '../../components/badge'
import { DetailFields } from '../../components/detail-fields'
import { DetailPage } from '../../components/detail-page'
import { LinkedRecords } from '../../components/linked-records'
import { PageHead } from '../../components/page-head'
import { useTask, useTaskLinks, useUnlinkFrom } from '../../lib/queries'

export function TaskDetail({ id }: { id: string }): ReactNode {
  const task = useTask(id)
  const links = useTaskLinks(id)
  const onUnlink = useUnlinkFrom({ kind: 'task', id })

  return (
    <DetailPage query={task} notFoundTitle="Task not found">
      {(t) => (
        <>
          <PageHead eyebrow="Task" title={t.title} />
          <DetailFields
            fields={[
              { label: 'Status', value: <StatusBadge status={t.status} /> },
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
              {links.data.assignees.length > 0 ? (
                <LinkedRecords title="Assigned to" records={links.data.assignees} onUnlink={onUnlink} />
              ) : null}
              <LinkedRecords
                title="People"
                records={links.data.people.filter((p) => p.subtitle !== 'assignee')}
                onUnlink={onUnlink}
              />
              <LinkedRecords title="Documents" records={links.data.documents} onUnlink={onUnlink} />
              <LinkedRecords title="Interactions" records={links.data.interactions} onUnlink={onUnlink} />
            </>
          ) : null}
        </>
      )}
    </DetailPage>
  )
}
