import type { Documents } from '@local-brain/db'
import {
  archiveRecord,
  insertRecord,
  updateRecord,
  type NewRecord,
  type RecordPatch,
} from '../../db/records'
import { validateNewDocument, validateDocumentPatch } from './validators'

export type NewDocument = NewRecord<Documents>
export type DocumentPatch = RecordPatch<Documents>

export function createDocument(input: NewDocument): Promise<string> {
  return insertRecord('documents', validateNewDocument(input))
}

export function updateDocument(id: string, patch: DocumentPatch): Promise<number> {
  return updateRecord('documents', id, validateDocumentPatch(patch))
}

export function archiveDocument(id: string): Promise<number> {
  return archiveRecord('documents', id)
}
