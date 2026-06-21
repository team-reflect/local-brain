import type { ReactNode } from 'react'
import type { Task } from '@local-brain/core'
import { DetailFields } from '../../components/detail-fields'

export function TaskMetadataFields({ task }: { task: Task }): ReactNode {
  return (
    <DetailFields
      fields={[
        { label: 'Origin document', value: task.originDocumentId ?? '—' },
        { label: 'Origin interaction', value: task.originInteractionId ?? '—' },
        { label: 'Source type', value: task.sourceRecordType ?? '—' },
        { label: 'Source id', value: task.sourceRecordId ?? '—' },
        { label: 'Created', value: task.createdAt.slice(0, 10) },
        { label: 'Updated', value: task.updatedAt.slice(0, 10) },
        { label: 'Archived', value: task.archivedAt?.slice(0, 10) ?? '—' },
      ]}
    />
  )
}
