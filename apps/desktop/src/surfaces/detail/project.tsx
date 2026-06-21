import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { StatusBadge } from '../../components/badge'
import { DetailFields } from '../../components/detail-fields'
import { DetailPage } from '../../components/detail-page'
import { LinkedRecords } from '../../components/linked-records'
import { MemoryList } from '../../components/memory-list'
import { PageHead } from '../../components/page-head'
import { RecordInspectionPanel } from '../../components/record-inspection'
import { Drawer, DrawerContent, DrawerTitle } from '../../components/ui/drawer'
import {
  useMemoriesForRecord,
  useProject,
  useProjectLinks,
  useRecordInspection,
  useUnlinkFrom,
} from '../../lib/queries'
import { TaskDetail } from './task'

export function ProjectDetail({ id }: { id: string }): ReactNode {
  const project = useProject(id)
  const links = useProjectLinks(id)
  const memories = useMemoriesForRecord('project', id)
  const inspection = useRecordInspection('project', id)
  const onUnlink = useUnlinkFrom({ kind: 'project', id })
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  useEffect(() => {
    setSelectedTaskId(null)
  }, [id])

  return (
    <>
      <DetailPage query={project} notFoundTitle="Project not found">
        {(p) => (
          <>
            <PageHead eyebrow="Project" title={p.name} />
            <DetailFields
              fields={[
                { label: 'Status', value: <StatusBadge status={p.status} /> },
                { label: 'Kind', value: p.kind ?? '—' },
                { label: 'Started', value: p.startedOn ?? '—' },
                { label: 'Target', value: p.targetDate ?? '—' },
                { label: 'Completed', value: p.completedOn ?? '—' },
                { label: 'Created', value: p.createdAt.slice(0, 10) },
                { label: 'Updated', value: p.updatedAt.slice(0, 10) },
                { label: 'Archived', value: p.archivedAt?.slice(0, 10) ?? '—' },
              ]}
            />
            {p.summary ? <p className="text-sm text-foreground">{p.summary}</p> : null}
            {p.notes ? <p className="whitespace-pre-wrap text-sm text-foreground">{p.notes}</p> : null}
            {links.data ? (
              <>
                <LinkedRecords
                  title="Tasks"
                  records={links.data.tasks}
                  onUnlink={onUnlink}
                  onOpenRecord={(record) => setSelectedTaskId(record.id)}
                />
                <LinkedRecords title="People" records={links.data.people} onUnlink={onUnlink} />
                <LinkedRecords title="Organizations" records={links.data.organizations} onUnlink={onUnlink} />
                <LinkedRecords title="Documents" records={links.data.documents} onUnlink={onUnlink} />
                <LinkedRecords title="Interactions" records={links.data.interactions} onUnlink={onUnlink} />
                <LinkedRecords title="Assets" records={links.data.assets} onUnlink={onUnlink} />
              </>
            ) : null}
            {memories.data ? (
              <MemoryList records={memories.data} recordType="project" recordId={id} />
            ) : null}
            <RecordInspectionPanel inspection={inspection.data} />
          </>
        )}
      </DetailPage>
      {selectedTaskId ? (
        <TaskDetailDrawer taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
      ) : null}
    </>
  )
}

function TaskDetailDrawer({
  taskId,
  onClose,
}: {
  taskId: string
  onClose: () => void
}): ReactNode {
  return (
    <Drawer open direction="right" onOpenChange={(next) => (next ? undefined : onClose())}>
      <DrawerContent
        className="h-full max-h-full w-[min(40rem,calc(100vw-4rem))] max-w-none rounded-none rounded-l-lg border-y-0 border-r-0 bg-popover text-popover-foreground shadow-[0_18px_48px_rgba(2,6,23,0.22)] sm:max-w-none"
        aria-describedby={undefined}
      >
        <DrawerTitle className="sr-only">Task detail</DrawerTitle>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close task details"
          title="Close"
          className="absolute right-3 top-3 z-10 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto py-8 pl-7 pr-12">
          <TaskDetail id={taskId} />
        </div>
      </DrawerContent>
    </Drawer>
  )
}
