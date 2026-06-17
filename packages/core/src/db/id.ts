/**
 * App-generated record ids.
 *
 * Ids are ULIDs (Crockford base32: 48-bit millisecond timestamp + 80 bits of
 * randomness), so they are globally unique and lexicographically sortable by
 * creation time — useful for stable ordering and cursor pagination without a
 * separate sequence. Stored as TEXT primary keys (see the launch schema).
 */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ENCODING_LEN = 32
const TIME_LEN = 10
const RANDOM_LEN = 16

function encodeTime(now: number): string {
  let time = now
  let out = ''
  for (let i = 0; i < TIME_LEN; i++) {
    out = ENCODING.charAt(time % ENCODING_LEN) + out
    time = Math.floor(time / ENCODING_LEN)
  }
  return out
}

function encodeRandom(): string {
  const bytes = new Uint8Array(RANDOM_LEN)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < RANDOM_LEN; i++) {
    out += ENCODING.charAt((bytes[i] ?? 0) % ENCODING_LEN)
  }
  return out
}

/** Generate a new ULID. */
export function newId(): string {
  return encodeTime(Date.now()) + encodeRandom()
}
