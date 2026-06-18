/**
 * ISO-8601 UTC timestamp matching the SQLite column format
 * (`strftime('%Y-%m-%dT%H:%M:%fZ')`). New rows let SQLite fill `created_at`/
 * `updated_at`; setters call this to bump `updated_at` on edits.
 */
export function nowIso(): string {
  return new Date().toISOString()
}
