/**
 * ISO-8601 UTC timestamp matching the SQLite column format
 * (`strftime('%Y-%m-%dT%H:%M:%fZ')`). New rows let SQLite fill `created_at`/
 * `updated_at`; setters call this to bump `updated_at` on edits.
 */
export function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Current local calendar date in YYYY-MM-DD format.
 * Uses the device's local timezone rather than UTC, so the date is correct
 * for the user's locale even near midnight UTC.
 */
export function localDateString(date: Date = new Date()): string {
  // en-CA locale formats dates as YYYY-MM-DD, matching ISO 8601 date format.
  return date.toLocaleDateString('en-CA')
}
