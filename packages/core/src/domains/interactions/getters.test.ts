import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../../ipc/bridge'
import { getInteractionEventDetail } from './getters'

describe('getInteractionEventDetail', () => {
  afterEach(() => setBridge({ invoke: () => Promise.reject(new Error('no bridge')) }))

  it('loads structured event rows from all event child tables', async () => {
    const sqlSeen: string[] = []
    setBridge({
      invoke: (command, args) => {
        if (command !== 'db_query') return Promise.resolve(null)
        const sql = String((args as { sql?: unknown }).sql ?? '')
        sqlSeen.push(sql)
        if (sql.includes('from "interaction_event_details"')) {
          return Promise.resolve([
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
              address: null,
              provider_name: 'Google Calendar',
              provider_record_kind: 'calendar_event',
              source_completeness: 'complete',
              needs_review_reason: null,
              created_at: '2026-06-21T00:00:00.000Z',
              updated_at: '2026-06-21T00:00:00.000Z',
            },
          ])
        }
        if (sql.includes('from "interaction_event_bookings"')) {
          return Promise.resolve([
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
          ])
        }
        if (sql.includes('from "interaction_event_lodging_stays"')) {
          return Promise.resolve([
            {
              interaction_id: 'i1',
              property_name: 'Four Seasons Montreal',
              check_in_local_at: '2026-07-09T16:00:00',
              check_out_local_at: '2026-07-12T11:00:00',
              nights: 3,
              room_count: 1,
              rooms_json: '[{"name":"Premier King"}]',
              guests_json: '[{"name":"Alex"}]',
              benefits_json: null,
              policies_json: null,
              arrival_notes: 'Late arrival requested',
              created_at: '2026-06-21T00:00:00.000Z',
              updated_at: '2026-06-21T00:00:00.000Z',
            },
          ])
        }
        if (sql.includes('from "interaction_event_flight_segments"')) {
          return Promise.resolve([
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
          ])
        }
        return Promise.resolve([])
      },
    })

    const detail = await getInteractionEventDetail('i1')

    expect(detail?.details?.startLocalAt).toBe('2026-07-09T09:00:00')
    expect(detail?.booking?.confirmationReference).toBe('ABC123')
    expect(detail?.lodgingStay?.propertyName).toBe('Four Seasons Montreal')
    expect(detail?.flightSegments).toHaveLength(1)
    expect(detail?.flightSegments[0]?.originCode).toBe('LHR')
    expect(sqlSeen.some((sql) => sql.includes('from "interaction_event_details"'))).toBe(true)
    expect(sqlSeen.some((sql) => sql.includes('from "interaction_event_bookings"'))).toBe(true)
    expect(sqlSeen.some((sql) => sql.includes('from "interaction_event_lodging_stays"'))).toBe(true)
    expect(
      sqlSeen.some(
        (sql) =>
          sql.includes('from "interaction_event_flight_segments"') &&
          sql.includes('order by "segment_index" asc'),
      ),
    ).toBe(true)
  })

  it('returns undefined when no structured event rows exist', async () => {
    setBridge({
      invoke: (command) => (command === 'db_query' ? Promise.resolve([]) : Promise.resolve(null)),
    })

    await expect(getInteractionEventDetail('missing')).resolves.toBeUndefined()
  })
})
