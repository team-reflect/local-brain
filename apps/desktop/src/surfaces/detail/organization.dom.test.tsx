// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { OrganizationDetail } from './organization'
import { installFakeBridge, renderWithProviders } from '../../test/utils'

const organizationRow = {
  id: 'org1',
  name: 'Acme Labs',
  kind: 'company',
  domain: 'acme.test',
  headline: 'Builds careful tools',
  summary: 'A customer with several stored enrichment rows.',
  website: 'https://acme.test',
  industry: 'Developer tools',
  location: 'San Francisco',
  hq_city: 'San Francisco',
  hq_region: 'CA',
  hq_country: 'US',
  notes: 'Prefers short launch notes.',
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-02T00:00:00.000Z',
  archived_at: null,
}

function installOrganizationBridge(): void {
  installFakeBridge({
    query: (sql) => {
      if (sql.includes('from "organizations"') && sql.includes('where "id" = ?')) {
        return [organizationRow]
      }
      if (sql.includes('from "organization_profiles"')) {
        return [
          {
            id: 'profile1',
            organization_id: 'org1',
            model: 'test-model',
            prompt_fingerprint: 'prompt-1',
            canonical_name: 'Acme Labs Inc.',
            website: 'https://acme.test',
            one_line_description: 'Careful tools for local-first teams.',
            category: 'software',
            why_it_matters: 'High-value relationship.',
            offerings_json: '["desktop app", "sync"]',
            notable_people_json: '[{"name":"Ada"}]',
            suggested_tags_json: '["customer"]',
            review_flags_json: '[]',
            source_urls_json: '["https://acme.test/about"]',
            raw_enrichment_json: '{"employees":42}',
            researched_at: '2026-06-03T00:00:00.000Z',
            created_at: '2026-06-03T00:00:00.000Z',
            updated_at: '2026-06-03T00:00:00.000Z',
          },
        ]
      }
      if (sql.includes('from "record_provenance"')) {
        return [
          {
            id: 'prov1',
            record_type: 'organization',
            record_id: 'org1',
            provenance_kind: 'imported',
            source_id: 'source1',
            external_identity_id: null,
            original_path: null,
            original_url: 'https://crm.test/acme',
            imported_at: '2026-06-04T00:00:00.000Z',
            model: null,
            prompt_fingerprint: null,
            metadata_json: '{"batch":"demo"}',
            created_at: '2026-06-04T00:00:00.000Z',
          },
        ]
      }
      if (sql.includes('from "taggings"')) {
        return [
          {
            id: 'tag1',
            name: 'Customer',
            slug: 'customer',
            color: '#0f766e',
            description: 'Paying relationship',
            created_at: '2026-06-01T00:00:00.000Z',
            updated_at: '2026-06-01T00:00:00.000Z',
            tagging_id: 'tagging1',
            source_id: 'source1',
            tagged_at: '2026-06-02T00:00:00.000Z',
          },
        ]
      }
      if (sql.includes('from "extracted_facts"')) {
        return [
          {
            id: 'fact1',
            subject_type: 'organization',
            subject_id: 'org1',
            key: 'ARR',
            value_text: '$10k',
            value_json: null,
            confidence: 0.9,
            source_record_type: 'document',
            source_record_id: 'doc1',
            source_excerpt: 'Acme pays annually.',
            observed_at: '2026-06-05T00:00:00.000Z',
            model: 'test-model',
            prompt_fingerprint: 'prompt-2',
            metadata_json: null,
            created_at: '2026-06-05T00:00:00.000Z',
            updated_at: '2026-06-05T00:00:00.000Z',
            archived_at: null,
          },
        ]
      }
      if (sql.includes('FROM assets a')) {
        return [{ id: 'asset1', title: 'contract.pdf', subtitle: 'application/pdf' }]
      }
      return []
    },
  })
}

describe('OrganizationDetail data coverage', () => {
  it('shows stored company fields and auxiliary database rows', async () => {
    installOrganizationBridge()
    renderWithProviders(<OrganizationDetail id="org1" />)

    expect(await screen.findByRole('heading', { name: 'Acme Labs' })).toBeDefined()
    expect(screen.getAllByText('https://acme.test').length).toBeGreaterThan(0)
    expect(screen.getByText('Developer tools')).toBeDefined()
    expect(screen.getByText('Prefers short launch notes.')).toBeDefined()
    expect(await screen.findByText('Organization profiles')).toBeDefined()
    expect(screen.getByText('Acme Labs Inc.')).toBeDefined()
    expect(screen.getByText(/desktop app/)).toBeDefined()
    expect(screen.getByText('Provenance')).toBeDefined()
    expect(screen.getByText('https://crm.test/acme')).toBeDefined()
    expect(screen.getByText('Tags')).toBeDefined()
    expect(screen.getByText('Customer')).toBeDefined()
    expect(screen.getByText('Extracted facts')).toBeDefined()
    expect(screen.getByText('$10k')).toBeDefined()
    expect(screen.getByText('contract.pdf')).toBeDefined()
  })
})
