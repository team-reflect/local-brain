// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { installFakeBridge, renderWithProviders } from '../../test/utils'
import { OrganizationDetail } from './organization'
import { PersonDetail } from './person'

const personRow = {
  id: 'p1',
  full_name: 'Ada Lovelace',
  preferred_name: 'Ada',
  headline: 'Computing collaborator',
  summary: 'Works closely with analytical engine teams.',
  primary_email: 'ada@example.com',
  primary_phone: '+1 555 0100',
  location: null,
  city: 'London',
  region: 'England',
  country: 'UK',
  timezone: 'Europe/London',
  linkedin_url: 'linkedin.com/in/ada',
  website: 'ada.example.com',
  important_dates_json: JSON.stringify({ birthday: '1815-12-10' }),
  notes: 'Prefers concise project updates.',
  is_self: 0,
  current_title: 'Principal collaborator',
  current_department: 'Research',
  current_organization_id: 'org1',
  role_family: 'engineering',
  seniority: 'principal',
  last_interaction_at: '2026-06-12T09:00:00.000Z',
  relationship_strength: 84,
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-13T00:00:00.000Z',
  archived_at: null,
}

const personWithoutCurrentAffiliationRow = {
  ...personRow,
  id: 'p2',
  full_name: 'Grace Hopper',
  preferred_name: null,
  current_title: 'Compiler lead',
  current_organization_id: 'org-secret-id',
}

const organizationRow = {
  id: 'org1',
  name: 'Acme Labs',
  kind: 'company',
  domain: 'acme.test',
  headline: 'Builds analytical engines for research teams.',
  summary: 'A compact research tooling company.',
  website: 'acme.test',
  industry: 'Research software',
  location: 'London',
  hq_city: 'London',
  hq_region: 'England',
  hq_country: 'UK',
  notes: 'Potential partner for engine demos.',
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-14T00:00:00.000Z',
  archived_at: null,
}

function installProfileBridge(): void {
  installFakeBridge({
    query: (sql, params) => {
      if (sql.includes('from "people"') && sql.includes('where "people"."id" = ?')) {
        if (params[0] === 'p1') return [personRow]
        if (params[0] === 'p2') return [personWithoutCurrentAffiliationRow]
        return []
      }
      if (sql.includes('from "person_emails"')) {
        return [
          {
            id: 'em1',
            person_id: 'p1',
            email: 'ada@example.com',
            normalized_email: 'ada@example.com',
            label: 'work',
            is_primary: 1,
            source_id: null,
            created_at: '2026-06-01T00:00:00.000Z',
            updated_at: '2026-06-01T00:00:00.000Z',
          },
          {
            id: 'em2',
            person_id: 'p1',
            email: 'ada@personal.test',
            normalized_email: 'ada@personal.test',
            label: 'personal',
            is_primary: 0,
            source_id: null,
            created_at: '2026-06-01T00:00:00.000Z',
            updated_at: '2026-06-01T00:00:00.000Z',
          },
        ]
      }
      if (sql.includes('from "person_phones"')) {
        return [
          {
            id: 'ph1',
            person_id: 'p1',
            phone: '+1 555 0100',
            normalized_phone: '+15550100',
            label: 'mobile',
            is_primary: 1,
            source_id: null,
            created_at: '2026-06-01T00:00:00.000Z',
            updated_at: '2026-06-01T00:00:00.000Z',
          },
        ]
      }
      if (sql.includes('from "affiliations"') && sql.includes('left join "organizations"')) {
        if (params[0] === 'p2') return []
        return [
          {
            id: 'aff1',
            person_id: 'p1',
            organization_id: 'org1',
            organization_name: 'Acme Labs',
            title: 'Principal collaborator',
            department: 'Research',
            role: 'advisor',
            role_family: 'engineering',
            seniority: 'principal',
            started_on: '2026-01-01',
            ended_on: null,
            is_current: 1,
            is_primary: 1,
            evidence_ref_id: 'ev1',
            notes: 'Primary company relationship.',
            created_at: '2026-06-01T00:00:00.000Z',
            updated_at: '2026-06-01T00:00:00.000Z',
          },
        ]
      }
      if (sql.includes('from "organizations"') && sql.includes('where "id" = ?')) {
        return params[0] === 'org1' ? [organizationRow] : []
      }
      if (sql.includes('from "organization_profiles"')) {
        return [
          {
            id: 'op1',
            organization_id: 'org1',
            model: 'gpt-test',
            prompt_fingerprint: 'prompt-123',
            canonical_name: 'Acme Laboratories',
            website: 'https://acme.test',
            one_line_description: 'Research software for analytical teams.',
            category: 'software',
            why_it_matters: 'Useful context for technical partnerships.',
            offerings_json: JSON.stringify(['Analysis tools', 'Workflow automation']),
            notable_people_json: JSON.stringify(['Ada Lovelace']),
            suggested_tags_json: JSON.stringify(['research', 'software']),
            review_flags_json: JSON.stringify(['verify funding']),
            source_urls_json: JSON.stringify(['https://acme.test/about']),
            raw_enrichment_json: JSON.stringify({ ok: true }),
            researched_at: '2026-06-10T00:00:00.000Z',
            created_at: '2026-06-10T00:00:00.000Z',
            updated_at: '2026-06-10T00:00:00.000Z',
          },
        ]
      }
      if (sql.includes('from "record_provenance"')) {
        return [
          {
            id: 'prov1',
            record_type: params[0],
            record_id: params[1],
            provenance_kind: 'imported',
            source_id: 'src1',
            source_name: 'Contacts',
            source_slug: 'contacts',
            external_identity_id: 'eid1',
            external_kind: 'contact',
            external_id: 'external-1',
            external_url: 'https://contacts.test/external-1',
            original_path: null,
            original_url: 'https://source.test/record',
            imported_at: '2026-06-11T00:00:00.000Z',
            model: null,
            prompt_fingerprint: null,
            metadata_json: JSON.stringify({ batch: 'daily' }),
            created_at: '2026-06-11T00:00:00.000Z',
          },
        ]
      }
      if (sql.includes('from "external_identities"')) {
        return [
          {
            id: 'eid1',
            entity_type: params[0],
            entity_id: params[1],
            source_id: 'src1',
            source_name: 'Contacts',
            source_slug: 'contacts',
            kind: 'contact',
            external_id: 'external-1',
            url: 'https://contacts.test/external-1',
            metadata_json: null,
            created_at: '2026-06-11T00:00:00.000Z',
            updated_at: '2026-06-11T00:00:00.000Z',
          },
        ]
      }
      return []
    },
  })
}

describe('network detail profile sheets', () => {
  it('renders rich person profile fields, affiliations, and sources', async () => {
    installProfileBridge()
    renderWithProviders(<PersonDetail id="p1" />)

    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeDefined()
    expect(screen.getByText('Ada')).toBeDefined()
    expect(screen.getAllByText('Principal collaborator at Acme Labs').length).toBeGreaterThan(0)
    expect(screen.getByText('Europe/London')).toBeDefined()
    expect(screen.getByText('ada@personal.test')).toBeDefined()
    expect(screen.getByText('birthday: 1815-12-10')).toBeDefined()
    expect(screen.getByText('Prefers concise project updates.')).toBeDefined()
    expect(screen.getByText('Primary company relationship.')).toBeDefined()
    expect(screen.getAllByText('external-1').length).toBeGreaterThan(0)
  })

  it('does not expose raw organization ids in the current role field', async () => {
    installProfileBridge()
    renderWithProviders(<PersonDetail id="p2" />)

    expect(await screen.findByRole('heading', { name: 'Grace Hopper' })).toBeDefined()
    expect(screen.getByText('Compiler lead')).toBeDefined()
    expect(screen.queryByText(/org-secret-id/)).toBeNull()
  })

  it('renders rich organization fields, research profile, and sources', async () => {
    installProfileBridge()
    renderWithProviders(<OrganizationDetail id="org1" />)

    expect(await screen.findByRole('heading', { name: 'Acme Labs' })).toBeDefined()
    expect(screen.getByText('Research software')).toBeDefined()
    expect(screen.getByText('London, England, UK')).toBeDefined()
    expect(screen.getByText('Builds analytical engines for research teams.')).toBeDefined()
    expect(screen.getByText('Potential partner for engine demos.')).toBeDefined()
    expect(screen.getByText('Acme Laboratories')).toBeDefined()
    expect(screen.getByText('Useful context for technical partnerships.')).toBeDefined()
    expect(screen.getByText('Analysis tools')).toBeDefined()
    expect(screen.getByText('verify funding')).toBeDefined()
    expect(screen.getAllByText('external-1').length).toBeGreaterThan(0)
  })
})
