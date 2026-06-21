-- Structured semantics for calendar/imported events.
--
-- The parent interaction remains the durable event shell and owns the full
-- readable body text plus raw provider payload in interactions.metadata_json.
-- These child tables store queryable event, booking, lodging, and flight fields.

CREATE TABLE interaction_event_details (
  interaction_id       TEXT PRIMARY KEY REFERENCES interactions (id) ON DELETE CASCADE,
  subtype              TEXT NOT NULL DEFAULT 'generic' CHECK (
    subtype IN (
      'flight',
      'lodging',
      'dining_reservation',
      'transport',
      'travel_block',
      'appointment',
      'generic'
    )
  ),
  status               TEXT,
  start_local_at       TEXT,
  start_timezone       TEXT,
  end_local_at         TEXT,
  end_timezone         TEXT,
  is_all_day           INTEGER NOT NULL DEFAULT 0 CHECK (is_all_day IN (0, 1)),
  venue_name           TEXT,
  address              TEXT,
  provider_name        TEXT,
  provider_record_kind TEXT,
  source_completeness  TEXT,
  needs_review_reason  TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE interaction_event_bookings (
  interaction_id             TEXT PRIMARY KEY REFERENCES interactions (id) ON DELETE CASCADE,
  booking_type               TEXT,
  confirmation_reference     TEXT,
  booking_channel            TEXT,
  provider_name              TEXT,
  party_count                INTEGER CHECK (party_count IS NULL OR party_count >= 0),
  guest_count                INTEGER CHECK (guest_count IS NULL OR guest_count >= 0),
  contact_json               TEXT,
  cost_json                  TEXT,
  cancellation_policy_json   TEXT,
  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE interaction_event_lodging_stays (
  interaction_id     TEXT PRIMARY KEY REFERENCES interactions (id) ON DELETE CASCADE,
  property_name      TEXT,
  check_in_local_at  TEXT,
  check_out_local_at TEXT,
  nights             INTEGER CHECK (nights IS NULL OR nights >= 0),
  room_count         INTEGER CHECK (room_count IS NULL OR room_count >= 0),
  rooms_json         TEXT,
  guests_json        TEXT,
  benefits_json      TEXT,
  policies_json      TEXT,
  arrival_notes      TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE interaction_event_flight_segments (
  interaction_id          TEXT NOT NULL REFERENCES interactions (id) ON DELETE CASCADE,
  segment_index           INTEGER NOT NULL CHECK (segment_index >= 0),
  carrier_name            TEXT,
  carrier_code            TEXT,
  flight_number           TEXT,
  service_class           TEXT,
  origin_code             TEXT,
  origin_name             TEXT,
  origin_timezone         TEXT,
  destination_code        TEXT,
  destination_name        TEXT,
  destination_timezone    TEXT,
  departure_local_at      TEXT,
  arrival_local_at        TEXT,
  departure_at            TEXT,
  arrival_at              TEXT,
  duration_minutes        INTEGER CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  confirmation_reference  TEXT,
  ticket_numbers_json     TEXT,
  passengers_json         TEXT,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (interaction_id, segment_index)
);

CREATE INDEX idx_interaction_event_details_subtype
  ON interaction_event_details (subtype);
CREATE INDEX idx_interaction_event_details_provider
  ON interaction_event_details (provider_name);
CREATE INDEX idx_interaction_event_lodging_property
  ON interaction_event_lodging_stays (property_name);
CREATE INDEX idx_interaction_event_flight_route
  ON interaction_event_flight_segments (origin_code, destination_code);
