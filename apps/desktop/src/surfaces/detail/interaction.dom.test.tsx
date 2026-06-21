// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { InteractionDetail } from './interaction'
import { installFakeBridge, renderWithProviders } from '../../test/utils'

const interactionRow = {
  id: 'i1',
  kind: 'event',
  title: 'Calendar: Flight: London Heathrow, LHR to AUS',
  body_text: 'Full readable source body.',
  summary: null,
  occurred_at: '2026-07-09T09:00:00',
  ended_at: '2026-07-09T15:20:00',
  duration_seconds: null,
  location: 'London Heathrow',
  external_id: 'calendar-event-1',
  original_path: null,
  original_url: null,
  content_hash: null,
  metadata_json: '{"provider":"google_calendar"}',
  created_at: '2026-06-21T00:00:00.000Z',
  updated_at: '2026-06-21T00:00:00.000Z',
  archived_at: null,
}

function installInteractionBridge({ structured }: { structured: boolean }): void {
  installFakeBridge({
    query: (sql) => {
      if (sql.includes('from "interactions"') && sql.includes('where "id" = ?')) {
        return [interactionRow]
      }
      if (!structured) {
        return []
      }
      if (sql.includes('from "interaction_event_details"')) {
        return [
          {
            interaction_id: 'i1',
            subtype: 'flight',
            status: 'confirmed',
            start_local_at: '2026-07-09T09:00:00',
            start_timezone: 'Europe/London',
            end_local_at: '2026-07-09T15:20:00',
            end_timezone: 'America/Chicago',
            is_all_day: 0,
            venue_name: 'London Heathrow',
            address: 'Heathrow Airport',
            provider_name: 'Google Calendar',
            provider_record_kind: 'calendar_event',
            source_completeness: 'complete',
            needs_review_reason: null,
            created_at: '2026-06-21T00:00:00.000Z',
            updated_at: '2026-06-21T00:00:00.000Z',
          },
        ]
      }
      if (sql.includes('from "interaction_event_bookings"')) {
        return [
          {
            interaction_id: 'i1',
            booking_type: 'flight',
            confirmation_reference: 'ABC123',
            booking_channel: 'British Airways',
            provider_name: 'BA',
            party_count: 1,
            guest_count: 1,
            contact_json: '{"email":"support@example.com"}',
            cost_json: '{"total":1200}',
            cancellation_policy_json: null,
            created_at: '2026-06-21T00:00:00.000Z',
            updated_at: '2026-06-21T00:00:00.000Z',
          },
        ]
      }
      if (sql.includes('from "interaction_event_lodging_stays"')) {
        return [
          {
            interaction_id: 'i1',
            property_name: 'Four Seasons Montreal',
            check_in_local_at: '2026-07-09T16:00:00',
            check_out_local_at: '2026-07-12T11:00:00',
            nights: 3,
            room_count: 1,
            rooms_json: '[{"name":"Premier King"}]',
            guests_json: '[{"name":"Alex"}]',
            benefits_json: '{"breakfast":true}',
            policies_json: null,
            arrival_notes: 'Late arrival requested',
            created_at: '2026-06-21T00:00:00.000Z',
            updated_at: '2026-06-21T00:00:00.000Z',
          },
        ]
      }
      if (sql.includes('from "interaction_event_flight_segments"')) {
        return [
          {
            interaction_id: 'i1',
            segment_index: 0,
            carrier_name: 'British Airways',
            carrier_code: 'BA',
            flight_number: '191',
            service_class: 'business',
            origin_code: 'LHR',
            origin_name: 'London Heathrow',
            origin_timezone: 'Europe/London',
            destination_code: 'AUS',
            destination_name: 'Austin',
            destination_timezone: 'America/Chicago',
            departure_local_at: '2026-07-09T09:00:00',
            arrival_local_at: '2026-07-09T15:20:00',
            departure_at: '2026-07-09T08:00:00Z',
            arrival_at: '2026-07-09T20:20:00Z',
            duration_minutes: 740,
            confirmation_reference: 'ABC123',
            ticket_numbers_json: '["1250000000001"]',
            passengers_json: '[{"name":"Alex"}]',
            created_at: '2026-06-21T00:00:00.000Z',
            updated_at: '2026-06-21T00:00:00.000Z',
          },
        ]
      }
      return []
    },
  })
}

describe('InteractionDetail structured events', () => {
  it('renders lodging check-in/out and flight local times', async () => {
    installInteractionBridge({ structured: true })
    renderWithProviders(<InteractionDetail id="i1" />)

    expect(
      await screen.findByRole('heading', {
        name: 'Calendar: Flight: London Heathrow, LHR to AUS',
      }),
    ).toBeDefined()
    expect(await screen.findByRole('heading', { name: 'Event' })).toBeDefined()
    expect(screen.getByText('Four Seasons Montreal')).toBeDefined()
    expect(screen.getByText('2026-07-09T16:00:00')).toBeDefined()
    expect(screen.getByText('2026-07-12T11:00:00')).toBeDefined()
    expect(screen.getByText('LHR to AUS')).toBeDefined()
    expect(screen.getAllByText('2026-07-09T09:00:00 Europe/London').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2026-07-09T15:20:00 America/Chicago').length).toBeGreaterThan(0)
  })

  it('hides the event section when no structured event rows exist', async () => {
    installInteractionBridge({ structured: false })
    renderWithProviders(<InteractionDetail id="i1" />)

    expect(
      await screen.findByRole('heading', {
        name: 'Calendar: Flight: London Heathrow, LHR to AUS',
      }),
    ).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Event' })).toBeNull()
  })
})
