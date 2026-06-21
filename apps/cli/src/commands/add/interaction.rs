//! `brain add interaction` — ingest a human interaction (meeting, call, note, …)
//! with its participants, links, and derived chunks in one transaction.
//! Deduped by external identity first, then by content hash; a matched
//! interaction is enriched (links, participants, identity, blank fields) rather
//! than re-created.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

use super::identity::{
    external_kind, find_duplicate, find_external_identity, insert_external_identity,
    insert_record_provenance, source_id, ExternalIdentityWrite, RecordProvenanceWrite,
};
use super::links::{insert_chunks, insert_links, replace_chunks};
use super::text::{normalize_optional, normalize_title};
use crate::commands::LinkRef;
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;
use crate::text::{content_hash, normalize_text};

pub struct AddInteractionArgs<'a> {
    pub title: Option<&'a str>,
    pub kind: &'a str,
    pub occurred_at: Option<&'a str>,
    pub ended_at: Option<&'a str>,
    pub location: Option<&'a str>,
    pub source_slug: Option<&'a str>,
    pub external_kind: &'a str,
    pub external_id: Option<&'a str>,
    pub original_url: Option<&'a str>,
    pub summary: Option<&'a str>,
    pub body: Option<String>,
    pub metadata_json: Option<String>,
    pub event_json: Option<String>,
    pub links: Vec<LinkRef>,
    pub raw_participants: Vec<&'a str>,
    pub self_participants: Vec<&'a str>,
    pub allow_duplicate: bool,
    pub replace_body: bool,
    /// On a source-backed re-import whose body changed, re-chunk like
    /// `--replace-body` instead of only filling blank fields. A no-op when the
    /// stored body already matches, so a daily automation can pass it freely.
    pub refresh: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EventPayload {
    details: Option<EventDetailsPayload>,
    booking: Option<EventBookingPayload>,
    lodging_stay: Option<EventLodgingStayPayload>,
    flight_segments: Option<Vec<EventFlightSegmentPayload>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EventDetailsPayload {
    subtype: Option<String>,
    status: Option<String>,
    start_local_at: Option<String>,
    start_timezone: Option<String>,
    end_local_at: Option<String>,
    end_timezone: Option<String>,
    is_all_day: Option<bool>,
    venue_name: Option<String>,
    address: Option<String>,
    provider_name: Option<String>,
    provider_record_kind: Option<String>,
    source_completeness: Option<String>,
    needs_review_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EventBookingPayload {
    booking_type: Option<String>,
    confirmation_reference: Option<String>,
    booking_channel: Option<String>,
    provider_name: Option<String>,
    party_count: Option<i64>,
    guest_count: Option<i64>,
    #[serde(alias = "contactJson")]
    contact: Option<Value>,
    #[serde(alias = "costJson")]
    cost: Option<Value>,
    #[serde(alias = "cancellationPolicyJson")]
    cancellation_policy: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EventLodgingStayPayload {
    property_name: Option<String>,
    check_in_local_at: Option<String>,
    check_out_local_at: Option<String>,
    nights: Option<i64>,
    room_count: Option<i64>,
    #[serde(alias = "roomsJson")]
    rooms: Option<Value>,
    #[serde(alias = "guestsJson")]
    guests: Option<Value>,
    #[serde(alias = "benefitsJson")]
    benefits: Option<Value>,
    #[serde(alias = "policiesJson")]
    policies: Option<Value>,
    arrival_notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EventFlightSegmentPayload {
    segment_index: Option<i64>,
    carrier_name: Option<String>,
    carrier_code: Option<String>,
    flight_number: Option<String>,
    service_class: Option<String>,
    origin_code: Option<String>,
    origin_name: Option<String>,
    origin_timezone: Option<String>,
    destination_code: Option<String>,
    destination_name: Option<String>,
    destination_timezone: Option<String>,
    departure_local_at: Option<String>,
    arrival_local_at: Option<String>,
    departure_at: Option<String>,
    arrival_at: Option<String>,
    duration_minutes: Option<i64>,
    confirmation_reference: Option<String>,
    #[serde(alias = "ticketNumbersJson")]
    ticket_numbers: Option<Value>,
    #[serde(alias = "passengersJson")]
    passengers: Option<Value>,
}

/// Whether the stored interaction's body differs from the incoming one, so a
/// re-imported thread/transcript that grew can be detected and re-digested.
/// Recomputes the stored body's hash rather than trusting `content_hash`: a null
/// or stale hash column (e.g. a body written without one, or by another writer)
/// would otherwise falsely report a change even when `body_text` already matches.
fn body_changed(
    conn: &Connection,
    existing: &str,
    incoming_hash: Option<&str>,
) -> Result<bool, CliError> {
    let Some(incoming_hash) = incoming_hash else {
        return Ok(false);
    };
    let stored_body: Option<String> = conn
        .query_row(
            "SELECT body_text FROM interactions WHERE id = ?1",
            params![existing],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    let stored_hash = stored_body
        .as_deref()
        .map(normalize_text)
        .filter(|body| !body.is_empty())
        .map(|body| content_hash(&body));
    Ok(stored_hash.as_deref() != Some(incoming_hash))
}

fn normalize_json(raw: Option<&str>, field: &str) -> Result<Option<String>, CliError> {
    let Some(value) = normalize_optional(raw) else {
        return Ok(None);
    };
    serde_json::from_str::<Value>(&value)
        .map_err(|e| CliError::Runtime(format!("{field} must be valid JSON: {e}")))?;
    Ok(Some(value))
}

fn parse_event_payload(
    raw: Option<&str>,
    interaction_kind: &str,
) -> Result<Option<EventPayload>, CliError> {
    let Some(value) = normalize_optional(raw) else {
        return Ok(None);
    };
    if interaction_kind != "event" {
        return Err(CliError::Runtime(
            "--event-json requires --kind event".into(),
        ));
    }
    let payload = serde_json::from_str::<EventPayload>(&value)
        .map_err(|e| CliError::Runtime(format!("--event-json must match the event schema: {e}")))?;
    validate_event_payload(&payload)?;
    Ok(Some(payload))
}

fn validate_event_payload(payload: &EventPayload) -> Result<(), CliError> {
    if let Some(details) = payload.details.as_ref() {
        if let Some(subtype) = details.subtype.as_deref() {
            let valid = matches!(
                subtype,
                "flight"
                    | "lodging"
                    | "dining_reservation"
                    | "transport"
                    | "travel_block"
                    | "appointment"
                    | "generic"
            );
            if !valid {
                return Err(CliError::Runtime(format!(
                    "--event-json details.subtype '{subtype}' is not supported"
                )));
            }
        }
    }
    Ok(())
}

fn json_column(value: Option<&Value>) -> Option<String> {
    value.map(Value::to_string)
}

fn optional_nonnegative(value: Option<i64>, field: &str) -> Result<Option<i64>, CliError> {
    if let Some(value) = value {
        if value < 0 {
            return Err(CliError::Runtime(format!(
                "--event-json {field} must be non-negative"
            )));
        }
    }
    Ok(value)
}

fn upsert_event_details(
    conn: &Connection,
    interaction_id: &str,
    details: &EventDetailsPayload,
) -> Result<(), CliError> {
    let subtype = details.subtype.as_deref().unwrap_or("generic");
    let has_subtype = if details.subtype.is_some() {
        1_i64
    } else {
        0_i64
    };
    let is_all_day = if details.is_all_day.unwrap_or(false) {
        1_i64
    } else {
        0_i64
    };
    let has_is_all_day = if details.is_all_day.is_some() {
        1_i64
    } else {
        0_i64
    };
    conn.execute(
        "INSERT INTO interaction_event_details
         (interaction_id, subtype, status, start_local_at, start_timezone,
          end_local_at, end_timezone, is_all_day, venue_name, address,
          provider_name, provider_record_kind, source_completeness,
          needs_review_reason)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
         ON CONFLICT(interaction_id) DO UPDATE SET
           subtype = CASE WHEN ?15 = 1 THEN excluded.subtype ELSE interaction_event_details.subtype END,
           status = COALESCE(excluded.status, interaction_event_details.status),
           start_local_at = COALESCE(excluded.start_local_at, interaction_event_details.start_local_at),
           start_timezone = COALESCE(excluded.start_timezone, interaction_event_details.start_timezone),
           end_local_at = COALESCE(excluded.end_local_at, interaction_event_details.end_local_at),
           end_timezone = COALESCE(excluded.end_timezone, interaction_event_details.end_timezone),
           is_all_day = CASE WHEN ?16 = 1 THEN excluded.is_all_day ELSE interaction_event_details.is_all_day END,
           venue_name = COALESCE(excluded.venue_name, interaction_event_details.venue_name),
           address = COALESCE(excluded.address, interaction_event_details.address),
           provider_name = COALESCE(excluded.provider_name, interaction_event_details.provider_name),
           provider_record_kind = COALESCE(excluded.provider_record_kind, interaction_event_details.provider_record_kind),
           source_completeness = COALESCE(excluded.source_completeness, interaction_event_details.source_completeness),
           needs_review_reason = COALESCE(excluded.needs_review_reason, interaction_event_details.needs_review_reason),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        params![
            interaction_id,
            subtype,
            normalize_optional(details.status.as_deref()),
            normalize_optional(details.start_local_at.as_deref()),
            normalize_optional(details.start_timezone.as_deref()),
            normalize_optional(details.end_local_at.as_deref()),
            normalize_optional(details.end_timezone.as_deref()),
            is_all_day,
            normalize_optional(details.venue_name.as_deref()),
            normalize_optional(details.address.as_deref()),
            normalize_optional(details.provider_name.as_deref()),
            normalize_optional(details.provider_record_kind.as_deref()),
            normalize_optional(details.source_completeness.as_deref()),
            normalize_optional(details.needs_review_reason.as_deref()),
            has_subtype,
            has_is_all_day,
        ],
    )?;
    Ok(())
}

fn upsert_event_booking(
    conn: &Connection,
    interaction_id: &str,
    booking: &EventBookingPayload,
) -> Result<(), CliError> {
    let contact_json = json_column(booking.contact.as_ref());
    let cost_json = json_column(booking.cost.as_ref());
    let cancellation_policy_json = json_column(booking.cancellation_policy.as_ref());
    conn.execute(
        "INSERT INTO interaction_event_bookings
         (interaction_id, booking_type, confirmation_reference, booking_channel,
          provider_name, party_count, guest_count, contact_json, cost_json,
          cancellation_policy_json)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(interaction_id) DO UPDATE SET
           booking_type = COALESCE(excluded.booking_type, interaction_event_bookings.booking_type),
           confirmation_reference = COALESCE(excluded.confirmation_reference, interaction_event_bookings.confirmation_reference),
           booking_channel = COALESCE(excluded.booking_channel, interaction_event_bookings.booking_channel),
           provider_name = COALESCE(excluded.provider_name, interaction_event_bookings.provider_name),
           party_count = COALESCE(excluded.party_count, interaction_event_bookings.party_count),
           guest_count = COALESCE(excluded.guest_count, interaction_event_bookings.guest_count),
           contact_json = COALESCE(excluded.contact_json, interaction_event_bookings.contact_json),
           cost_json = COALESCE(excluded.cost_json, interaction_event_bookings.cost_json),
           cancellation_policy_json = COALESCE(excluded.cancellation_policy_json, interaction_event_bookings.cancellation_policy_json),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        params![
            interaction_id,
            normalize_optional(booking.booking_type.as_deref()),
            normalize_optional(booking.confirmation_reference.as_deref()),
            normalize_optional(booking.booking_channel.as_deref()),
            normalize_optional(booking.provider_name.as_deref()),
            optional_nonnegative(booking.party_count, "booking.partyCount")?,
            optional_nonnegative(booking.guest_count, "booking.guestCount")?,
            contact_json.as_deref(),
            cost_json.as_deref(),
            cancellation_policy_json.as_deref(),
        ],
    )?;
    Ok(())
}

fn upsert_event_lodging_stay(
    conn: &Connection,
    interaction_id: &str,
    stay: &EventLodgingStayPayload,
) -> Result<(), CliError> {
    let rooms_json = json_column(stay.rooms.as_ref());
    let guests_json = json_column(stay.guests.as_ref());
    let benefits_json = json_column(stay.benefits.as_ref());
    let policies_json = json_column(stay.policies.as_ref());
    conn.execute(
        "INSERT INTO interaction_event_lodging_stays
         (interaction_id, property_name, check_in_local_at, check_out_local_at,
          nights, room_count, rooms_json, guests_json, benefits_json,
          policies_json, arrival_notes)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
         ON CONFLICT(interaction_id) DO UPDATE SET
           property_name = COALESCE(excluded.property_name, interaction_event_lodging_stays.property_name),
           check_in_local_at = COALESCE(excluded.check_in_local_at, interaction_event_lodging_stays.check_in_local_at),
           check_out_local_at = COALESCE(excluded.check_out_local_at, interaction_event_lodging_stays.check_out_local_at),
           nights = COALESCE(excluded.nights, interaction_event_lodging_stays.nights),
           room_count = COALESCE(excluded.room_count, interaction_event_lodging_stays.room_count),
           rooms_json = COALESCE(excluded.rooms_json, interaction_event_lodging_stays.rooms_json),
           guests_json = COALESCE(excluded.guests_json, interaction_event_lodging_stays.guests_json),
           benefits_json = COALESCE(excluded.benefits_json, interaction_event_lodging_stays.benefits_json),
           policies_json = COALESCE(excluded.policies_json, interaction_event_lodging_stays.policies_json),
           arrival_notes = COALESCE(excluded.arrival_notes, interaction_event_lodging_stays.arrival_notes),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        params![
            interaction_id,
            normalize_optional(stay.property_name.as_deref()),
            normalize_optional(stay.check_in_local_at.as_deref()),
            normalize_optional(stay.check_out_local_at.as_deref()),
            optional_nonnegative(stay.nights, "lodgingStay.nights")?,
            optional_nonnegative(stay.room_count, "lodgingStay.roomCount")?,
            rooms_json.as_deref(),
            guests_json.as_deref(),
            benefits_json.as_deref(),
            policies_json.as_deref(),
            normalize_optional(stay.arrival_notes.as_deref()),
        ],
    )?;
    Ok(())
}

fn replace_event_flight_segments(
    conn: &Connection,
    interaction_id: &str,
    segments: &[EventFlightSegmentPayload],
) -> Result<(), CliError> {
    conn.execute(
        "DELETE FROM interaction_event_flight_segments WHERE interaction_id = ?1",
        params![interaction_id],
    )?;
    for (index, segment) in segments.iter().enumerate() {
        let segment_index = segment.segment_index.unwrap_or(index as i64);
        if segment_index < 0 {
            return Err(CliError::Runtime(
                "--event-json flightSegments[].segmentIndex must be non-negative".into(),
            ));
        }
        let ticket_numbers_json = json_column(segment.ticket_numbers.as_ref());
        let passengers_json = json_column(segment.passengers.as_ref());
        conn.execute(
            "INSERT INTO interaction_event_flight_segments
             (interaction_id, segment_index, carrier_name, carrier_code,
              flight_number, service_class, origin_code, origin_name,
              origin_timezone, destination_code, destination_name,
              destination_timezone, departure_local_at, arrival_local_at,
              departure_at, arrival_at, duration_minutes,
              confirmation_reference, ticket_numbers_json, passengers_json)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)",
            params![
                interaction_id,
                segment_index,
                normalize_optional(segment.carrier_name.as_deref()),
                normalize_optional(segment.carrier_code.as_deref()),
                normalize_optional(segment.flight_number.as_deref()),
                normalize_optional(segment.service_class.as_deref()),
                normalize_optional(segment.origin_code.as_deref()),
                normalize_optional(segment.origin_name.as_deref()),
                normalize_optional(segment.origin_timezone.as_deref()),
                normalize_optional(segment.destination_code.as_deref()),
                normalize_optional(segment.destination_name.as_deref()),
                normalize_optional(segment.destination_timezone.as_deref()),
                normalize_optional(segment.departure_local_at.as_deref()),
                normalize_optional(segment.arrival_local_at.as_deref()),
                normalize_optional(segment.departure_at.as_deref()),
                normalize_optional(segment.arrival_at.as_deref()),
                optional_nonnegative(segment.duration_minutes, "flightSegments[].durationMinutes")?,
                normalize_optional(segment.confirmation_reference.as_deref()),
                ticket_numbers_json.as_deref(),
                passengers_json.as_deref(),
            ],
        )?;
    }
    Ok(())
}

fn apply_event_payload(
    conn: &Connection,
    interaction_id: &str,
    payload: Option<&EventPayload>,
) -> Result<(), CliError> {
    let Some(payload) = payload else {
        return Ok(());
    };
    if let Some(details) = payload.details.as_ref() {
        upsert_event_details(conn, interaction_id, details)?;
    }
    if let Some(booking) = payload.booking.as_ref() {
        upsert_event_booking(conn, interaction_id, booking)?;
    }
    if let Some(stay) = payload.lodging_stay.as_ref() {
        upsert_event_lodging_stay(conn, interaction_id, stay)?;
    }
    if let Some(segments) = payload.flight_segments.as_ref() {
        replace_event_flight_segments(conn, interaction_id, segments)?;
    }
    Ok(())
}

fn find_duplicate_interaction(
    conn: &Connection,
    hash: &str,
    identity_kind: &str,
    external_id: Option<&str>,
    source_id: Option<&str>,
) -> Result<Option<String>, CliError> {
    if identity_kind == "record" {
        if let Some(external_id) = normalize_optional(external_id) {
            // The source-scoped `external_identities` lookup already ran in the
            // caller. This legacy fallback matches only rows that predate
            // `external_identities`; once any scoped identity claims a row, the
            // generic denormalized `interactions.external_id` must not merge across
            // sources or external-kind scopes.
            let id = conn
                .query_row(
                    "SELECT i.id FROM interactions i
                 WHERE i.archived_at IS NULL
                   AND i.external_id IS NOT NULL
                   AND i.external_id = ?1
                   AND NOT EXISTS (
                     SELECT 1 FROM external_identities ei
                     WHERE ei.entity_type = 'interaction'
                       AND ei.entity_id = i.id
                   )
                 LIMIT 1",
                    params![external_id],
                    |row| row.get::<_, String>(0),
                )
                .ok();
            if id.is_some() {
                return Ok(id);
            }
            if source_id.is_some() {
                return Ok(None);
            }
        }
    }
    if source_id.is_some() && normalize_optional(external_id).is_some() {
        return Ok(None);
    }
    find_duplicate(conn, "interactions", hash)
}

fn enrich_duplicate_interaction(
    conn: &Connection,
    id: &str,
    args: &AddInteractionArgs,
) -> Result<(), CliError> {
    super::fill_blanks(
        conn,
        "interactions",
        id,
        &[
            ("external_id", normalize_optional(args.external_id)),
            ("original_url", normalize_optional(args.original_url)),
            ("summary", normalize_optional(args.summary)),
            ("occurred_at", normalize_optional(args.occurred_at)),
            ("ended_at", normalize_optional(args.ended_at)),
            ("location", normalize_optional(args.location)),
        ],
    )
}

struct ExistingInteractionEnrichment<'a> {
    source_id: Option<&'a str>,
    identity_kind: &'a str,
    replace_body: bool,
    metadata_json: Option<&'a str>,
    event_payload: Option<&'a EventPayload>,
}

/// Apply a duplicate import onto an existing interaction: fill blank fields, add
/// any new links/participants, and (re)assert the external identity. The two
/// dedupe paths (external-identity match and content-hash match) both funnel
/// through here so they enrich identically.
fn enrich_existing_interaction(
    tx: &Connection,
    existing: &str,
    args: &AddInteractionArgs,
    enrichment: ExistingInteractionEnrichment<'_>,
) -> Result<usize, CliError> {
    enrich_duplicate_interaction(tx, existing, args)?;
    let mut chunk_count = 0;
    if enrichment.replace_body {
        let body = args
            .body
            .as_deref()
            .map(normalize_text)
            .filter(|body| !body.is_empty())
            .ok_or_else(|| CliError::Runtime("--replace-body requires body text".into()))?;
        let hash = content_hash(&body);
        tx.execute(
            "UPDATE interactions
             SET body_text = ?1,
                 summary = CASE WHEN ?2 IS NOT NULL THEN ?2 ELSE summary END,
                 content_hash = ?3,
                 metadata_json = CASE WHEN ?4 IS NOT NULL THEN ?4 ELSE metadata_json END,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?5",
            params![
                &body,
                normalize_optional(args.summary),
                hash,
                enrichment.metadata_json,
                existing,
            ],
        )?;
        chunk_count = replace_chunks(tx, "interaction", existing, &body)?;
    } else if enrichment.metadata_json.is_some() {
        tx.execute(
            "UPDATE interactions
             SET metadata_json = ?1,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?2",
            params![enrichment.metadata_json, existing],
        )?;
    }
    apply_event_payload(tx, existing, enrichment.event_payload)?;
    insert_links(tx, "interaction", existing, &args.links)?;
    insert_raw_participants(tx, existing, enrichment.source_id, &args.raw_participants)?;
    insert_self_participants(tx, existing, enrichment.source_id, &args.self_participants)?;
    insert_external_identity(
        tx,
        ExternalIdentityWrite {
            entity_type: "interaction",
            entity_id: existing,
            source_id: enrichment.source_id,
            kind: enrichment.identity_kind,
            external_id: args.external_id,
            url: args.original_url,
            force_duplicate: false,
        },
    )?;
    insert_record_provenance(
        tx,
        RecordProvenanceWrite {
            record_type: "interaction",
            record_id: existing,
            provenance_kind: "imported",
            source_id: enrichment.source_id,
            original_path: None,
            original_url: args.original_url,
            model: None,
            prompt_fingerprint: None,
            metadata_json: None,
        },
    )?;
    Ok(chunk_count)
}

#[derive(Debug)]
struct RawParticipant {
    role: String,
    handle: Option<String>,
    normalized_handle: Option<String>,
    display_name: Option<String>,
}

fn parse_raw_participant(raw: &str) -> Result<Option<RawParticipant>, CliError> {
    let Some(value) = normalize_optional(Some(raw)) else {
        return Ok(None);
    };
    let (role, payload) = value
        .split_once(':')
        .map(|(role, payload)| (role.trim(), payload.trim()))
        .unwrap_or(("participant", value.as_str()));
    let role = normalize_optional(Some(role)).unwrap_or_else(|| "participant".to_string());
    let payload = normalize_optional(Some(payload)).ok_or_else(|| {
        CliError::Runtime(format!("--participant '{raw}' is missing a name or handle"))
    })?;

    let (display_name, handle) =
        if let (Some(start), Some(end)) = (payload.rfind('<'), payload.rfind('>')) {
            if start < end {
                (
                    normalize_optional(Some(&payload[..start])),
                    normalize_optional(Some(&payload[start + 1..end])),
                )
            } else {
                (Some(payload.clone()), None)
            }
        } else if payload.contains('@') {
            (None, normalize_optional(Some(&payload)))
        } else {
            (Some(payload.clone()), None)
        };

    let normalized_handle = handle.as_deref().map(|handle| {
        if handle.contains('@') {
            handle.to_lowercase()
        } else {
            handle.to_string()
        }
    });
    // Empty angle brackets (e.g. `from:<>`) leave no usable identity. Without a
    // display name or handle the row would violate the interaction_participants
    // CHECK (person_id OR normalized_handle OR display_name), so reject it with
    // the same error used for an entirely missing payload.
    if display_name.is_none() && normalized_handle.is_none() {
        return Err(CliError::Runtime(format!(
            "--participant '{raw}' is missing a name or handle"
        )));
    }
    Ok(Some(RawParticipant {
        role,
        handle,
        normalized_handle,
        display_name,
    }))
}

fn insert_raw_participants(
    conn: &Connection,
    interaction_id: &str,
    source_id: Option<&str>,
    participants: &[&str],
) -> Result<usize, CliError> {
    let mut inserted = 0;
    for raw in participants {
        let Some(participant) = parse_raw_participant(raw)? else {
            continue;
        };
        let person_id = match participant.normalized_handle.as_deref() {
            Some(handle) if handle.contains('@') => find_person_by_email(conn, handle)?,
            _ => None,
        };
        inserted += insert_participant(
            conn,
            interaction_id,
            source_id,
            &participant,
            person_id.as_deref(),
        )?;
    }
    Ok(inserted)
}

fn insert_self_participants(
    conn: &Connection,
    interaction_id: &str,
    source_id: Option<&str>,
    participants: &[&str],
) -> Result<usize, CliError> {
    if participants.is_empty() {
        return Ok(0);
    }
    let self_id = find_self_person(conn)?.ok_or_else(|| {
        CliError::Runtime("--self-participant requires an active self person".into())
    })?;
    let mut inserted = 0;
    for raw in participants {
        let Some(participant) = parse_raw_participant(raw)? else {
            continue;
        };
        inserted += insert_participant(
            conn,
            interaction_id,
            source_id,
            &participant,
            Some(&self_id),
        )?;
    }
    Ok(inserted)
}

fn insert_participant(
    conn: &Connection,
    interaction_id: &str,
    source_id: Option<&str>,
    participant: &RawParticipant,
    person_id: Option<&str>,
) -> Result<usize, CliError> {
    if participant.normalized_handle.is_none()
        && participant.display_name.is_none()
        && person_id.is_none()
    {
        return Ok(0);
    }

    if let Some(person_id) = person_id {
        let changed = conn.execute(
            "UPDATE interaction_participants
             SET role = CASE
                   WHEN (role IS NULL OR trim(role) = '') AND ?3 IS NOT NULL
                   THEN ?3 ELSE role END,
                 handle = CASE
                   WHEN (handle IS NULL OR trim(handle) = '') AND ?4 IS NOT NULL
                   THEN ?4 ELSE handle END,
                 normalized_handle = CASE
                   WHEN (normalized_handle IS NULL OR trim(normalized_handle) = '') AND ?5 IS NOT NULL
                   THEN ?5 ELSE normalized_handle END,
                 display_name = CASE
                   WHEN (display_name IS NULL OR trim(display_name) = '') AND ?6 IS NOT NULL
                   THEN ?6 ELSE display_name END,
                 source_id = CASE
                   WHEN source_id IS NULL AND ?7 IS NOT NULL THEN ?7 ELSE source_id END
             WHERE interaction_id = ?1
               AND person_id = ?2",
            params![
                interaction_id,
                person_id,
                participant.role,
                participant.handle,
                participant.normalized_handle,
                participant.display_name,
                source_id,
            ],
        )?;
        if changed > 0 {
            return Ok(0);
        }
    }

    if let Some(handle) = participant.normalized_handle.as_deref() {
        let changed = conn.execute(
            "UPDATE interaction_participants
             SET person_id = CASE
                   WHEN person_id IS NULL AND ?4 IS NOT NULL THEN ?4 ELSE person_id END,
                 handle = CASE
                   WHEN (handle IS NULL OR trim(handle) = '') AND ?5 IS NOT NULL
                   THEN ?5 ELSE handle END,
                 display_name = CASE
                   WHEN (display_name IS NULL OR trim(display_name) = '') AND ?6 IS NOT NULL
                   THEN ?6 ELSE display_name END,
                 source_id = CASE
                   WHEN source_id IS NULL AND ?7 IS NOT NULL THEN ?7 ELSE source_id END
             WHERE interaction_id = ?1
               AND normalized_handle = ?2
               AND COALESCE(role, '') = ?3
               AND (?4 IS NULL OR person_id IS NULL OR person_id = ?4)",
            params![
                interaction_id,
                handle,
                participant.role,
                person_id,
                participant.handle,
                participant.display_name,
                source_id,
            ],
        )?;
        if changed > 0 {
            return Ok(0);
        }
    } else if participant.display_name.is_some() {
        let already_present = conn
            .query_row(
                "SELECT 1 FROM interaction_participants
                 WHERE interaction_id = ?1
                   AND normalized_handle IS NULL
                   AND display_name = ?2
                   AND COALESCE(role, '') = ?3
                 LIMIT 1",
                params![interaction_id, participant.display_name, participant.role],
                |_| Ok(()),
            )
            .ok()
            .is_some();
        if already_present {
            return Ok(0);
        }
    }

    let changed = conn.execute(
        "INSERT OR IGNORE INTO interaction_participants
         (id, interaction_id, person_id, role, handle, normalized_handle, display_name, source_id)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            new_id(),
            interaction_id,
            person_id,
            participant.role,
            participant.handle,
            participant.normalized_handle,
            participant.display_name,
            source_id,
        ],
    )?;
    Ok(changed)
}

fn find_self_person(conn: &Connection) -> Result<Option<String>, CliError> {
    let id = conn
        .query_row(
            "SELECT id FROM people
             WHERE is_self = 1 AND archived_at IS NULL
             LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(id)
}

fn find_person_by_email(
    conn: &Connection,
    normalized_email: &str,
) -> Result<Option<String>, CliError> {
    let id = conn
        .query_row(
            "SELECT p.id
             FROM people p
             LEFT JOIN person_emails pe ON pe.person_id = p.id
             WHERE p.archived_at IS NULL
               AND (
                 lower(p.primary_email) = ?1
                 OR pe.normalized_email = ?1
               )
             ORDER BY p.created_at ASC
             LIMIT 1",
            params![normalized_email],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(id)
}

fn requires_post_analysis(args: &AddInteractionArgs) -> bool {
    args.source_slug
        .is_some_and(|slug| slug.eq_ignore_ascii_case("granola"))
}

fn report_interaction(
    json_output: bool,
    id: &str,
    duplicate: bool,
    chunk_count: usize,
    post_analysis_required: bool,
    body_changed: bool,
) -> Result<(), CliError> {
    if json_output {
        let mut value = json!({
            "kind": "interaction",
            "id": id,
            "isDuplicate": duplicate,
            "chunkCount": chunk_count,
        });
        if body_changed {
            // The upstream body differs from the stored one. Re-import with
            // --replace-body (or --refresh) to re-digest the grown thread.
            value["bodyChanged"] = json!(true);
        }
        if post_analysis_required {
            value["postAnalysisRequired"] = json!(true);
            value["postAnalysisChecklist"] = json!([
                "summary",
                "people",
                "existingProjectLinks",
                "followUpTasks",
                "stableMemories",
            ]);
        }
        print_json(&value)
    } else {
        if duplicate {
            println!("interaction {id} (duplicate, skipped)");
        } else {
            println!("interaction {id} ({chunk_count} chunks)");
        }
        if post_analysis_required {
            eprintln!(
                "brain: post-analysis required: summary, people, existing project links, follow-up tasks, stable memories"
            );
        }
        Ok(())
    }
}

pub fn add_interaction(
    conn: &mut Connection,
    json: bool,
    args: AddInteractionArgs,
) -> Result<(), CliError> {
    let body = args
        .body
        .as_deref()
        .map(normalize_text)
        .filter(|body| !body.is_empty());
    let title = normalize_title(args.title);
    if title.is_none() && body.is_none() {
        return Err(CliError::Runtime(
            "an interaction needs a title or body text".into(),
        ));
    }
    let metadata_json = normalize_json(args.metadata_json.as_deref(), "--metadata-json")?;
    let event_payload = parse_event_payload(args.event_json.as_deref(), args.kind)?;
    let hash = body.as_deref().map(content_hash);
    let source_id = source_id(conn, args.source_slug)?;
    let identity_kind = external_kind(args.external_kind);
    if args.replace_body && body.is_none() {
        return Err(CliError::Runtime(
            "--replace-body requires body text".into(),
        ));
    }
    if args.replace_body && (source_id.is_none() || normalize_optional(args.external_id).is_none())
    {
        return Err(CliError::Runtime(
            "--replace-body requires --source and --external-id".into(),
        ));
    }
    let existing_by_external = find_external_identity(
        conn,
        "interaction",
        source_id.as_deref(),
        &identity_kind,
        args.external_id,
    )?;
    if let Some(existing) = existing_by_external.as_deref() {
        if !args.allow_duplicate {
            let changed = body_changed(conn, existing, hash.as_deref())?;
            let do_replace = args.replace_body || (args.refresh && changed);
            let tx = conn.transaction()?;
            let count = enrich_existing_interaction(
                &tx,
                existing,
                &args,
                ExistingInteractionEnrichment {
                    source_id: source_id.as_deref(),
                    identity_kind: &identity_kind,
                    replace_body: do_replace,
                    metadata_json: metadata_json.as_deref(),
                    event_payload: event_payload.as_ref(),
                },
            )?;
            tx.commit()?;
            // Surface staleness only when we didn't already re-digest the body.
            let still_stale = changed && !do_replace;
            return report_interaction(
                json,
                existing,
                true,
                count,
                requires_post_analysis(&args),
                still_stale,
            );
        }
    }
    let existing_by_dup = match hash.as_deref() {
        Some(hash) => find_duplicate_interaction(
            conn,
            hash,
            &identity_kind,
            args.external_id,
            source_id.as_deref(),
        )?,
        None => None,
    };
    if let Some(existing) = existing_by_dup.as_deref() {
        if !args.allow_duplicate {
            // This path matched on identical content_hash, so the body is byte-for-
            // byte the same — never stale.
            let tx = conn.transaction()?;
            let count = enrich_existing_interaction(
                &tx,
                existing,
                &args,
                ExistingInteractionEnrichment {
                    source_id: source_id.as_deref(),
                    identity_kind: &identity_kind,
                    replace_body: args.replace_body,
                    metadata_json: metadata_json.as_deref(),
                    event_payload: event_payload.as_ref(),
                },
            )?;
            tx.commit()?;
            return report_interaction(
                json,
                existing,
                true,
                count,
                requires_post_analysis(&args),
                false,
            );
        }
    }
    // Reaching here past a match means `--allow-duplicate` forced a new record; it
    // must not steal the matched interaction's external identity.
    let force_duplicate = existing_by_external.is_some() || existing_by_dup.is_some();
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO interactions
         (id, kind, title, body_text, summary, occurred_at, ended_at, location,
          external_id, original_url, content_hash, metadata_json)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![
            id,
            args.kind,
            title,
            body.as_deref(),
            normalize_optional(args.summary),
            normalize_optional(args.occurred_at),
            normalize_optional(args.ended_at),
            normalize_optional(args.location),
            normalize_optional(args.external_id),
            normalize_optional(args.original_url),
            hash.as_deref(),
            metadata_json.as_deref()
        ],
    )?;
    let count = match body.as_deref() {
        Some(body) => insert_chunks(&tx, "interaction", &id, body)?,
        None => 0,
    };
    insert_links(&tx, "interaction", &id, &args.links)?;
    apply_event_payload(&tx, &id, event_payload.as_ref())?;
    insert_raw_participants(&tx, &id, source_id.as_deref(), &args.raw_participants)?;
    insert_self_participants(&tx, &id, source_id.as_deref(), &args.self_participants)?;
    insert_external_identity(
        &tx,
        ExternalIdentityWrite {
            entity_type: "interaction",
            entity_id: &id,
            source_id: source_id.as_deref(),
            kind: &identity_kind,
            external_id: args.external_id,
            url: args.original_url,
            force_duplicate,
        },
    )?;
    insert_record_provenance(
        &tx,
        RecordProvenanceWrite {
            record_type: "interaction",
            record_id: &id,
            provenance_kind: "imported",
            source_id: source_id.as_deref(),
            original_path: None,
            original_url: args.original_url,
            model: None,
            prompt_fingerprint: None,
            metadata_json: None,
        },
    )?;
    tx.commit()?;
    report_interaction(
        json,
        &id,
        false,
        count,
        requires_post_analysis(&args),
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_participant_rejects_empty_brackets() {
        let err = parse_raw_participant("from:<>").unwrap_err();
        assert!(matches!(err, CliError::Runtime(_)));
        let err = parse_raw_participant("from: <>").unwrap_err();
        assert!(matches!(err, CliError::Runtime(_)));
    }

    #[test]
    fn parse_participant_keeps_named_and_handled() {
        // A display name alone is enough to satisfy the CHECK.
        let named = parse_raw_participant("from:Name <>").unwrap().unwrap();
        assert_eq!(named.display_name.as_deref(), Some("Name"));
        assert!(named.normalized_handle.is_none());

        let handled = parse_raw_participant("from:Robin <robin@example.com>")
            .unwrap()
            .unwrap();
        assert_eq!(handled.display_name.as_deref(), Some("Robin"));
        assert_eq!(
            handled.normalized_handle.as_deref(),
            Some("robin@example.com")
        );
    }

    #[test]
    fn parse_participant_skips_blank() {
        assert!(parse_raw_participant("   ").unwrap().is_none());
    }

    fn interaction_args<'a>(
        body: &str,
        external_id: Option<&'a str>,
        allow_duplicate: bool,
    ) -> AddInteractionArgs<'a> {
        AddInteractionArgs {
            title: Some("Subject"),
            kind: "note",
            occurred_at: None,
            ended_at: None,
            location: None,
            source_slug: Some("manual"),
            external_kind: "record",
            external_id,
            original_url: None,
            summary: None,
            body: Some(body.to_string()),
            metadata_json: None,
            event_json: None,
            links: vec![],
            raw_participants: vec![],
            self_participants: vec![],
            allow_duplicate,
            replace_body: false,
            refresh: false,
        }
    }

    #[test]
    fn body_changed_recomputes_from_body_text_ignoring_null_hash() {
        let conn = brain_schema::open_in_memory().unwrap();
        // A stored interaction with a body but NULL content_hash (e.g. written by
        // another writer or a legacy path).
        conn.execute(
            "INSERT INTO interactions (id, kind, title, body_text, content_hash)
             VALUES ('i1', 'email', 'T', 'shared body text', NULL)",
            [],
        )
        .unwrap();
        let same = content_hash(&normalize_text("shared body text"));
        assert!(
            !body_changed(&conn, "i1", Some(&same)).unwrap(),
            "a matching body must not report a change despite the null stored hash"
        );
        let different = content_hash(&normalize_text("a genuinely different body"));
        assert!(
            body_changed(&conn, "i1", Some(&different)).unwrap(),
            "a different body still reports a change"
        );
    }

    #[test]
    fn refresh_redigests_a_changed_thread_body() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // Seed a source-backed thread with an initial body.
        add_interaction(
            &mut conn,
            true,
            interaction_args("first body", Some("thr-1"), false),
        )
        .unwrap();
        let id: String = conn
            .query_row(
                "SELECT entity_id FROM external_identities WHERE external_id = 'thr-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        // Re-import the same thread with a grown body and --refresh: the stored body
        // and chunks must be replaced.
        let mut grown = interaction_args("first body. and a new reply.", Some("thr-1"), false);
        grown.refresh = true;
        add_interaction(&mut conn, true, grown).unwrap();

        let stored_body: String = conn
            .query_row(
                "SELECT body_text FROM interactions WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored_body, "first body. and a new reply.");
        let chunk_has_reply: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM content_chunks
                 WHERE record_type = 'interaction' AND record_id = ?1
                   AND text LIKE '%new reply%'",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(chunk_has_reply, 1, "refresh re-chunks the grown body");
    }

    #[test]
    fn registered_self_email_auto_resolves_participant_without_self_flag() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // Register the user's address on the self person.
        crate::commands::add::set_self(
            &mut conn,
            true,
            crate::commands::add::SetSelfArgs {
                full_name: Some("Alex MacCaw"),
                preferred_name: None,
                emails: vec!["alex@maccaw.org"],
                phones: vec![],
                headline: None,
                location: None,
            },
        )
        .unwrap();
        let self_id: String = conn
            .query_row("SELECT id FROM people WHERE is_self = 1", [], |row| {
                row.get(0)
            })
            .unwrap();

        // Import an interaction with the user as a *plain* --participant (no
        // --self-participant). Resolution by registered email must link it to self.
        let mut args = interaction_args("body text", Some("ext-self"), false);
        args.raw_participants = vec!["from:Alex MacCaw <alex@maccaw.org>"];
        add_interaction(&mut conn, true, args).unwrap();

        let resolved: Option<String> = conn
            .query_row(
                "SELECT person_id FROM interaction_participants
                 WHERE normalized_handle = 'alex@maccaw.org'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            resolved.as_deref(),
            Some(self_id.as_str()),
            "a participant on a registered self address must resolve to the self person"
        );
    }

    #[test]
    fn allow_duplicate_interaction_does_not_steal_external_identity() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // First import: an interaction owning external id int-1.
        add_interaction(
            &mut conn,
            true,
            interaction_args("first body", Some("int-1"), false),
        )
        .unwrap();
        let original_id: String = conn
            .query_row(
                "SELECT entity_id FROM external_identities
                 WHERE entity_type = 'interaction' AND external_id = 'int-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        // A forced duplicate (distinct body, so find_duplicate_interaction would
        // not match on content) for the same external id must succeed and leave
        // the identity on the original interaction.
        add_interaction(
            &mut conn,
            true,
            interaction_args("a totally different body", Some("int-1"), true),
        )
        .unwrap();

        let interaction_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM interactions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            interaction_count, 2,
            "allow-duplicate must fork a second interaction"
        );
        let identity_rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM external_identities
                 WHERE entity_type = 'interaction' AND external_id = 'int-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            identity_rows, 1,
            "the unique external identity stays a single row"
        );
        let identity_target: String = conn
            .query_row(
                "SELECT entity_id FROM external_identities
                 WHERE entity_type = 'interaction' AND external_id = 'int-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            identity_target, original_id,
            "a forced duplicate must not steal the original interaction's external identity"
        );
    }
}
