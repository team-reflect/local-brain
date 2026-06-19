import type { Organizations } from '@local-brain/db'
import {
  archiveRecord,
  insertRecord,
  updateRecord,
  type NewRecord,
  type RecordPatch,
} from '../../db/records'
import { validateNewOrganization, validateOrganizationPatch } from './validators'

export type NewOrganization = NewRecord<Organizations>
export type OrganizationPatch = RecordPatch<Organizations>

/** Create an organization and return its generated id. */
export function createOrganization(input: NewOrganization): Promise<string> {
  return insertRecord('organizations', validateNewOrganization(input))
}

export function updateOrganization(id: string, patch: OrganizationPatch): Promise<number> {
  return updateRecord('organizations', id, validateOrganizationPatch(patch))
}

/** Soft-delete: archive rather than remove, so links and history survive. */
export function archiveOrganization(id: string): Promise<number> {
  return archiveRecord('organizations', id)
}
