import { sql } from 'kysely'
import { db } from '../db/client'
import type { SourceRecordType } from './retrieve'

/** Stable typed relation filter accepted by record-level retrieval. */
export interface RelatedRecordRef {
  recordType: 'person' | 'organization' | 'project' | 'task' | 'document' | 'interaction'
  recordId: string
}

interface RelatedRow {
  recordType: SourceRecordType
  recordId: string
}

function key(row: RelatedRow): string {
  return `${row.recordType}:${row.recordId}`
}

/** Resolve ordinary typed-link rows, including searchable transcript children. */
async function typedRelatedRows(ref: RelatedRecordRef): Promise<RelatedRow[]> {
  const id = ref.recordId
  switch (ref.recordType) {
    case 'person':
      return (
        await sql<RelatedRow>`
          SELECT 'interaction' AS "recordType", interaction_id AS "recordId"
          FROM interaction_participants WHERE person_id = ${id}
          UNION SELECT 'interaction_transcript', tr.id
            FROM interaction_transcripts tr
            JOIN interaction_participants ip ON ip.interaction_id = tr.interaction_id
            WHERE ip.person_id = ${id}
          UNION SELECT 'document', document_id FROM document_people WHERE person_id = ${id}
          UNION SELECT 'project', project_id FROM project_people WHERE person_id = ${id}
          UNION SELECT 'task', task_id FROM task_people WHERE person_id = ${id}
          UNION SELECT 'organization', organization_id FROM affiliations WHERE person_id = ${id}
          UNION SELECT 'memory', memory_id FROM memory_links
            WHERE record_type = 'person' AND record_id = ${id}
        `.execute(db)
      ).rows
    case 'organization':
      return (
        await sql<RelatedRow>`
          SELECT 'interaction' AS "recordType", interaction_id AS "recordId"
          FROM interaction_organizations WHERE organization_id = ${id}
          UNION SELECT 'interaction_transcript', tr.id
            FROM interaction_transcripts tr
            JOIN interaction_organizations io ON io.interaction_id = tr.interaction_id
            WHERE io.organization_id = ${id}
          UNION SELECT 'document', document_id FROM document_organizations WHERE organization_id = ${id}
          UNION SELECT 'project', project_id FROM project_organizations WHERE organization_id = ${id}
          UNION SELECT 'task', task_id FROM task_organizations WHERE organization_id = ${id}
          UNION SELECT 'person', person_id FROM affiliations WHERE organization_id = ${id}
          UNION SELECT 'organization_profile', id FROM organization_profiles WHERE organization_id = ${id}
          UNION SELECT 'memory', memory_id FROM memory_links
            WHERE record_type = 'organization' AND record_id = ${id}
        `.execute(db)
      ).rows
    case 'project':
      return (
        await sql<RelatedRow>`
          SELECT 'interaction' AS "recordType", interaction_id AS "recordId"
          FROM project_interactions WHERE project_id = ${id}
          UNION SELECT 'interaction_transcript', tr.id
            FROM interaction_transcripts tr
            JOIN project_interactions pi ON pi.interaction_id = tr.interaction_id
            WHERE pi.project_id = ${id}
          UNION SELECT 'document', document_id FROM project_documents WHERE project_id = ${id}
          UNION SELECT 'person', person_id FROM project_people WHERE project_id = ${id}
          UNION SELECT 'organization', organization_id FROM project_organizations WHERE project_id = ${id}
          UNION SELECT 'task', id FROM tasks WHERE project_id = ${id}
          UNION SELECT 'memory', memory_id FROM memory_links
            WHERE record_type = 'project' AND record_id = ${id}
        `.execute(db)
      ).rows
    case 'task':
      return (
        await sql<RelatedRow>`
          SELECT 'interaction' AS "recordType", interaction_id AS "recordId"
          FROM task_interactions WHERE task_id = ${id}
          UNION SELECT 'interaction_transcript', tr.id
            FROM interaction_transcripts tr
            JOIN task_interactions ti ON ti.interaction_id = tr.interaction_id
            WHERE ti.task_id = ${id}
          UNION SELECT 'document', document_id FROM task_documents WHERE task_id = ${id}
          UNION SELECT 'person', person_id FROM task_people WHERE task_id = ${id}
          UNION SELECT 'organization', organization_id FROM task_organizations WHERE task_id = ${id}
          UNION SELECT 'project', project_id FROM tasks WHERE id = ${id} AND project_id IS NOT NULL
          UNION SELECT 'memory', memory_id FROM memory_links
            WHERE record_type = 'task' AND record_id = ${id}
        `.execute(db)
      ).rows
    case 'document':
      return (
        await sql<RelatedRow>`
          SELECT 'interaction' AS "recordType", interaction_id AS "recordId"
          FROM document_interactions WHERE document_id = ${id}
          UNION SELECT 'interaction_transcript', tr.id
            FROM interaction_transcripts tr
            JOIN document_interactions di ON di.interaction_id = tr.interaction_id
            WHERE di.document_id = ${id}
          UNION SELECT 'person', person_id FROM document_people WHERE document_id = ${id}
          UNION SELECT 'organization', organization_id FROM document_organizations WHERE document_id = ${id}
          UNION SELECT 'project', project_id FROM project_documents WHERE document_id = ${id}
          UNION SELECT 'task', task_id FROM task_documents WHERE document_id = ${id}
          UNION SELECT 'memory', memory_id FROM memory_links
            WHERE record_type = 'document' AND record_id = ${id}
        `.execute(db)
      ).rows
    case 'interaction':
      return (
        await sql<RelatedRow>`
          SELECT 'document' AS "recordType", document_id AS "recordId"
          FROM document_interactions WHERE interaction_id = ${id}
          UNION SELECT 'interaction_transcript', id FROM interaction_transcripts WHERE interaction_id = ${id}
          UNION SELECT 'person', person_id FROM interaction_participants
            WHERE interaction_id = ${id} AND person_id IS NOT NULL
          UNION SELECT 'organization', organization_id FROM interaction_organizations WHERE interaction_id = ${id}
          UNION SELECT 'project', project_id FROM project_interactions WHERE interaction_id = ${id}
          UNION SELECT 'task', task_id FROM task_interactions WHERE interaction_id = ${id}
          UNION SELECT 'memory', memory_id FROM memory_links
            WHERE record_type = 'interaction' AND record_id = ${id}
        `.execute(db)
      ).rows
  }
}

/**
 * Resolve direct polymorphic anchors without recursively following artifacts
 * discovered through another relation. Transcript children are the sole
 * exception because they are searchable representations of an interaction.
 */
async function anchoredRelatedRows(ref: RelatedRecordRef): Promise<RelatedRow[]> {
  const { recordId, recordType } = ref
  return (
    await sql<RelatedRow>`
      SELECT 'asset' AS "recordType", asset_id AS "recordId"
      FROM asset_links
      WHERE record_type = ${recordType} AND record_id = ${recordId}

      UNION SELECT 'ai_note', id
      FROM ai_notes
      WHERE (subject_type = ${recordType} AND subject_id = ${recordId})
        OR (${recordType} = 'document' AND document_id = ${recordId})
        OR (${recordType} = 'interaction' AND interaction_id = ${recordId})

      UNION SELECT 'extracted_fact', id
      FROM extracted_facts
      WHERE (subject_type = ${recordType} AND subject_id = ${recordId})
        OR (source_record_type = ${recordType} AND source_record_id = ${recordId})

      UNION SELECT 'task', id
      FROM tasks
      WHERE (source_record_type = ${recordType} AND source_record_id = ${recordId})
        OR (${recordType} = 'document' AND origin_document_id = ${recordId})
        OR (${recordType} = 'interaction' AND origin_interaction_id = ${recordId})

      UNION SELECT cc.record_type, cc.record_id
      FROM evidence_refs er
      JOIN content_chunks cc ON cc.id = er.chunk_id
      WHERE er.subject_type = ${recordType}
        AND er.subject_id = ${recordId}
        AND cc.record_type IN (
          'person', 'organization', 'organization_profile', 'project', 'task', 'document',
          'interaction', 'interaction_transcript', 'ai_note', 'extracted_fact', 'memory', 'asset'
        )

      UNION SELECT er.subject_type, er.subject_id
      FROM evidence_refs er
      JOIN content_chunks cc ON cc.id = er.chunk_id
      WHERE er.subject_type IN (
          'person', 'organization', 'organization_profile', 'project', 'task', 'document',
          'interaction', 'interaction_transcript', 'ai_note', 'extracted_fact', 'memory', 'asset'
        )
        AND (
          (cc.record_type = ${recordType} AND cc.record_id = ${recordId})
          OR (
            ${recordType} = 'interaction'
            AND cc.record_type = 'interaction_transcript'
            AND EXISTS (
              SELECT 1
              FROM interaction_transcripts tr
              WHERE tr.id = cc.record_id AND tr.interaction_id = ${recordId}
            )
          )
        )

      UNION SELECT 'document', origin_document_id
      FROM tasks
      WHERE ${recordType} = 'task' AND id = ${recordId} AND origin_document_id IS NOT NULL

      UNION SELECT 'interaction', origin_interaction_id
      FROM tasks
      WHERE ${recordType} = 'task' AND id = ${recordId} AND origin_interaction_id IS NOT NULL

      UNION SELECT source_record_type, source_record_id
      FROM tasks
      WHERE ${recordType} = 'task'
        AND id = ${recordId}
        AND source_record_id IS NOT NULL
        AND source_record_type IN (
          'person', 'organization', 'organization_profile', 'project', 'task', 'document',
          'interaction', 'interaction_transcript', 'ai_note', 'extracted_fact', 'memory', 'asset'
        )

      UNION SELECT 'interaction_transcript', tr.id
      FROM tasks t
      JOIN interaction_transcripts tr ON tr.interaction_id = t.origin_interaction_id
      WHERE ${recordType} = 'task' AND t.id = ${recordId}

      UNION SELECT 'interaction_transcript', tr.id
      FROM tasks t
      JOIN interaction_transcripts tr ON tr.interaction_id = t.source_record_id
      WHERE ${recordType} = 'task'
        AND t.id = ${recordId}
        AND t.source_record_type = 'interaction'
    `.execute(db)
  ).rows
}

/**
 * Resolve records connected to a typed ref through durable one-hop links and
 * anchors. Callers pass Local Brain ids, never provider-specific identities.
 */
async function relatedRows(ref: RelatedRecordRef): Promise<RelatedRow[]> {
  const [typedRows, anchoredRows] = await Promise.all([
    typedRelatedRows(ref),
    anchoredRelatedRows(ref),
  ])
  return [...typedRows, ...anchoredRows]
}

/**
 * Resolve an AND intersection for multiple typed relation filters. `undefined`
 * means no relation filter; an empty set means the filter matched no records.
 */
export async function relatedRecordKeys(
  refs: readonly RelatedRecordRef[] | undefined,
): Promise<ReadonlySet<string> | undefined> {
  if (!refs || refs.length === 0) return undefined
  const groups = await Promise.all(refs.map(relatedRows))
  let intersection = new Set(groups[0]?.map(key) ?? [])
  for (const rows of groups.slice(1)) {
    const allowed = new Set(rows.map(key))
    intersection = new Set([...intersection].filter((recordKey) => allowed.has(recordKey)))
  }
  return intersection
}
