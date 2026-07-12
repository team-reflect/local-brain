import type { Organizations, People } from '@local-brain/db'
import type { Selectable } from 'kysely'

/** Person fields concatenated into the canonical profile search projection. */
export const PERSON_PROFILE_COLUMNS = [
  'fullName',
  'preferredName',
  'headline',
  'summary',
  'location',
  'city',
  'region',
  'country',
  'timezone',
  'currentTitle',
  'currentDepartment',
  'roleFamily',
  'seniority',
  'notes',
] as const satisfies readonly (keyof Selectable<People>)[]

/** Organization fields concatenated into the canonical profile search projection. */
export const ORGANIZATION_PROFILE_COLUMNS = [
  'name',
  'kind',
  'domain',
  'headline',
  'summary',
  'website',
  'industry',
  'location',
  'hqCity',
  'hqRegion',
  'hqCountry',
  'notes',
] as const satisfies readonly (keyof Selectable<Organizations>)[]

type PersonProfile = Pick<Selectable<People>, (typeof PERSON_PROFILE_COLUMNS)[number]>
type OrganizationProfile = Pick<
  Selectable<Organizations>,
  (typeof ORGANIZATION_PROFILE_COLUMNS)[number]
>
type PersonProfilePatch = Partial<PersonProfile>
type OrganizationProfilePatch = Partial<OrganizationProfile>

function profileText(values: readonly (string | null | undefined)[]): string {
  return values.map((value) => value ?? '').join(' ').trim()
}

/** Canonical person chunk text, kept byte-for-byte aligned with the CLI enrichment projection. */
export function personProfileText(
  person: PersonProfile,
  patch: PersonProfilePatch = {},
): string {
  return profileText(
    PERSON_PROFILE_COLUMNS.map((column) =>
      patch[column] === undefined ? person[column] : patch[column],
    ),
  )
}

/** Canonical organization chunk text, aligned with the CLI enrichment projection. */
export function organizationProfileText(
  organization: OrganizationProfile,
  patch: OrganizationProfilePatch = {},
): string {
  return profileText(
    ORGANIZATION_PROFILE_COLUMNS.map((column) =>
      patch[column] === undefined ? organization[column] : patch[column],
    ),
  )
}
