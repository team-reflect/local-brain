import type { Selectable } from 'kysely'
import type {
  InteractionEventBookings,
  InteractionEventDetails,
  InteractionEventFlightSegments,
  InteractionEventLodgingStays,
  InteractionParticipants,
  Interactions,
  People,
} from '@local-brain/db'
import { db } from '../../db/client'

export type Interaction = Selectable<Interactions>
export type InteractionParticipant = Selectable<People>
export type InteractionParticipantRow = Selectable<InteractionParticipants>
export type InteractionEventDetailsRow = Selectable<InteractionEventDetails>
export type InteractionEventBooking = Selectable<InteractionEventBookings>
export type InteractionEventLodgingStay = Selectable<InteractionEventLodgingStays>
export type InteractionEventFlightSegment = Selectable<InteractionEventFlightSegments>

export interface InteractionEventDetail {
  details?: InteractionEventDetailsRow
  booking?: InteractionEventBooking
  lodgingStay?: InteractionEventLodgingStay
  flightSegments: InteractionEventFlightSegment[]
}

export interface ListInteractionsOptions {
  includeArchived?: boolean
  limit?: number
}

/** Interactions, most recent occurrence first. */
export function listInteractions(options: ListInteractionsOptions = {}): Promise<Interaction[]> {
  let query = db.selectFrom('interactions').selectAll()
  if (!options.includeArchived) {
    query = query.where('archivedAt', 'is', null)
  }
  query = query.orderBy('occurredAt', 'desc')
  if (options.limit !== undefined) {
    query = query.limit(options.limit)
  }
  return query.execute()
}

export function getInteraction(id: string): Promise<Interaction | undefined> {
  return db.selectFrom('interactions').selectAll().where('id', '=', id).executeTakeFirst()
}

export async function getInteractionEventDetail(
  interactionId: string,
): Promise<InteractionEventDetail | undefined> {
  const [details, booking, lodgingStay, flightSegments] = await Promise.all([
    db
      .selectFrom('interactionEventDetails')
      .selectAll()
      .where('interactionId', '=', interactionId)
      .executeTakeFirst(),
    db
      .selectFrom('interactionEventBookings')
      .selectAll()
      .where('interactionId', '=', interactionId)
      .executeTakeFirst(),
    db
      .selectFrom('interactionEventLodgingStays')
      .selectAll()
      .where('interactionId', '=', interactionId)
      .executeTakeFirst(),
    db
      .selectFrom('interactionEventFlightSegments')
      .selectAll()
      .where('interactionId', '=', interactionId)
      .orderBy('segmentIndex', 'asc')
      .execute(),
  ])

  if (
    details === undefined &&
    booking === undefined &&
    lodgingStay === undefined &&
    flightSegments.length === 0
  ) {
    return undefined
  }
  const eventDetail: InteractionEventDetail = { flightSegments }
  if (details !== undefined) {
    eventDetail.details = details
  }
  if (booking !== undefined) {
    eventDetail.booking = booking
  }
  if (lodgingStay !== undefined) {
    eventDetail.lodgingStay = lodgingStay
  }
  return eventDetail
}

/** The people linked to an interaction via `interaction_participants`. */
export function listInteractionParticipants(
  interactionId: string,
): Promise<InteractionParticipant[]> {
  return db
    .selectFrom('people')
    .innerJoin('interactionParticipants', 'interactionParticipants.personId', 'people.id')
    .where('interactionParticipants.interactionId', '=', interactionId)
    .selectAll('people')
    .execute()
}

/** Raw participant rows, including unresolved imported handles with no person row. */
export function listInteractionParticipantRows(
  interactionId: string,
): Promise<InteractionParticipantRow[]> {
  return db
    .selectFrom('interactionParticipants')
    .selectAll()
    .where('interactionId', '=', interactionId)
    .orderBy('createdAt', 'asc')
    .execute()
}
