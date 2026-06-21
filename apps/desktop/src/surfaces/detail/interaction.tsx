import type { ReactNode } from 'react'
import type { InteractionEventDetail, InteractionEventFlightSegment } from '@local-brain/core'
import { DetailFields } from '../../components/detail-fields'
import { DetailPage } from '../../components/detail-page'
import { LinkedRecords } from '../../components/linked-records'
import { PageHead } from '../../components/page-head'
import { Section } from '../../components/section'
import {
  useInteraction,
  useInteractionEventDetail,
  useInteractionLinks,
  useInteractionParticipants,
  useUnlinkFrom,
} from '../../lib/queries'
import { useRouter } from '../../routing/router'

export function InteractionDetail({ id }: { id: string }): ReactNode {
  const { navigate } = useRouter()
  const interaction = useInteraction(id)
  const eventDetail = useInteractionEventDetail(id)
  const participants = useInteractionParticipants(id)
  const links = useInteractionLinks(id)
  const onUnlink = useUnlinkFrom({ kind: 'interaction', id })

  return (
    <DetailPage query={interaction} notFoundTitle="Interaction not found">
      {(i) => (
        <>
          <PageHead eyebrow={i.kind} title={i.title ?? 'Interaction'} />
          <DetailFields
            fields={[
              { label: 'Occurred', value: i.occurredAt?.slice(0, 16).replace('T', ' ') ?? '—' },
              { label: 'Location', value: i.location ?? '—' },
            ]}
          />
          {i.kind === 'event' && eventDetail.data ? (
            <EventDetailSection eventDetail={eventDetail.data} />
          ) : null}
          <Section title="Participants">
            {participants.data && participants.data.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {participants.data.map((person) => (
                  <li key={person.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => navigate({ kind: 'person', id: person.id })}
                      className="flex-1 rounded px-2 py-1 text-left text-sm text-foreground hover:bg-secondary/60"
                    >
                      {person.fullName}
                    </button>
                    <button
                      type="button"
                      aria-label={`Unlink ${person.fullName}`}
                      title="Unlink"
                      onClick={() =>
                        onUnlink({
                          kind: 'person',
                          id: person.id,
                          title: person.fullName,
                          subtitle: null,
                        })
                      }
                      className="shrink-0 rounded-md px-2 py-1 text-[11px] text-muted-foreground opacity-0 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                    >
                      Unlink
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No linked participants.</p>
            )}
          </Section>
          {i.bodyText ? (
            <Section title="Notes">
              <p className="whitespace-pre-wrap text-sm text-foreground">{i.bodyText}</p>
            </Section>
          ) : null}
          {links.data ? (
            <>
              <LinkedRecords title="Projects" records={links.data.projects} onUnlink={onUnlink} />
              <LinkedRecords title="Organizations" records={links.data.organizations} onUnlink={onUnlink} />
              <LinkedRecords title="Documents" records={links.data.documents} onUnlink={onUnlink} />
              <LinkedRecords title="Tasks" records={links.data.tasks} onUnlink={onUnlink} />
              <LinkedRecords title="Assets" records={links.data.assets} onUnlink={onUnlink} />
            </>
          ) : null}
        </>
      )}
    </DetailPage>
  )
}

function EventDetailSection({ eventDetail }: { eventDetail: InteractionEventDetail }): ReactNode {
  const { details, booking, lodgingStay, flightSegments } = eventDetail
  return (
    <Section title="Event">
      <div className="flex flex-col gap-4">
        {details ? (
          <DetailFields
            fields={[
              { label: 'Subtype', value: formatValue(details.subtype) },
              { label: 'Status', value: formatValue(details.status) },
              {
                label: 'Local start',
                value: formatZonedTime(details.startLocalAt, details.startTimezone),
              },
              {
                label: 'Local end',
                value: formatZonedTime(details.endLocalAt, details.endTimezone),
              },
              { label: 'Venue', value: formatValue(details.venueName) },
              { label: 'Address', value: formatValue(details.address) },
              { label: 'Provider', value: formatValue(details.providerName) },
              { label: 'Source', value: formatValue(details.sourceCompleteness) },
              { label: 'Review', value: formatValue(details.needsReviewReason) },
            ]}
          />
        ) : null}
        {booking ? (
          <DetailFields
            fields={[
              { label: 'Booking type', value: formatValue(booking.bookingType) },
              { label: 'Reference', value: formatValue(booking.confirmationReference) },
              { label: 'Channel', value: formatValue(booking.bookingChannel) },
              { label: 'Provider', value: formatValue(booking.providerName) },
              { label: 'Party count', value: formatNumber(booking.partyCount) },
              { label: 'Guest count', value: formatNumber(booking.guestCount) },
              { label: 'Contact', value: formatJson(booking.contactJson) },
              { label: 'Cost', value: formatJson(booking.costJson) },
              { label: 'Policy', value: formatJson(booking.cancellationPolicyJson) },
            ]}
          />
        ) : null}
        {lodgingStay ? (
          <DetailFields
            fields={[
              { label: 'Property', value: formatValue(lodgingStay.propertyName) },
              { label: 'Check-in', value: formatValue(lodgingStay.checkInLocalAt) },
              { label: 'Check-out', value: formatValue(lodgingStay.checkOutLocalAt) },
              { label: 'Nights', value: formatNumber(lodgingStay.nights) },
              { label: 'Rooms', value: formatNumber(lodgingStay.roomCount) },
              { label: 'Room details', value: formatJson(lodgingStay.roomsJson) },
              { label: 'Guests', value: formatJson(lodgingStay.guestsJson) },
              { label: 'Benefits', value: formatJson(lodgingStay.benefitsJson) },
              { label: 'Policies', value: formatJson(lodgingStay.policiesJson) },
              { label: 'Arrival', value: formatValue(lodgingStay.arrivalNotes) },
            ]}
          />
        ) : null}
        {flightSegments.length > 0 ? (
          <div className="flex flex-col gap-3">
            {flightSegments.map((segment) => (
              <FlightSegment key={segment.segmentIndex} segment={segment} />
            ))}
          </div>
        ) : null}
      </div>
    </Section>
  )
}

function FlightSegment({ segment }: { segment: InteractionEventFlightSegment }): ReactNode {
  const route = [segment.originCode, segment.destinationCode].filter(Boolean).join(' to ')
  const flight = [segment.carrierCode, segment.flightNumber].filter(Boolean).join(' ')
  return (
    <div className="border-l border-border pl-3">
      <DetailFields
        fields={[
          { label: 'Route', value: formatValue(route) },
          { label: 'Flight', value: formatValue(flight || segment.carrierName) },
          { label: 'Class', value: formatValue(segment.serviceClass) },
          {
            label: 'Departs',
            value: formatZonedTime(segment.departureLocalAt, segment.originTimezone),
          },
          {
            label: 'Arrives',
            value: formatZonedTime(segment.arrivalLocalAt, segment.destinationTimezone),
          },
          { label: 'Duration', value: formatDuration(segment.durationMinutes) },
          { label: 'Reference', value: formatValue(segment.confirmationReference) },
          { label: 'Passengers', value: formatJson(segment.passengersJson) },
        ]}
      />
    </div>
  )
}

function formatValue(value: string | null | undefined): string {
  return value && value.trim() ? value : '—'
}

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(value)
}

function formatZonedTime(
  value: string | null | undefined,
  timezone: string | null | undefined,
): string {
  if (!value) {
    return '—'
  }
  return timezone ? `${value} ${timezone}` : value
}

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—'
  }
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  if (hours === 0) {
    return `${minutes}m`
  }
  if (minutes === 0) {
    return `${hours}h`
  }
  return `${hours}h ${minutes}m`
}

function formatJson(value: string | null | undefined): ReactNode {
  if (!value) {
    return '—'
  }
  try {
    return (
      <span className="break-words font-mono text-xs">
        {JSON.stringify(JSON.parse(value))}
      </span>
    )
  } catch {
    return <span className="break-words font-mono text-xs">{value}</span>
  }
}
