import type { People } from '@local-brain/db'
import {
  archiveRecord,
  insertRecord,
  updateRecord,
  type NewRecord,
  type RecordPatch,
} from '../../db/records'
import { validateNewPerson, validatePersonPatch } from './validators'

export type NewPerson = NewRecord<People>
export type PersonPatch = RecordPatch<People>

/** Create a person and return its generated id. */
export function createPerson(input: NewPerson): Promise<string> {
  return insertRecord('people', validateNewPerson(input))
}

export function updatePerson(id: string, patch: PersonPatch): Promise<number> {
  return updateRecord('people', id, validatePersonPatch(patch))
}

/** Soft-delete: archive rather than remove, so links and history survive. */
export function archivePerson(id: string): Promise<number> {
  return archiveRecord('people', id)
}
