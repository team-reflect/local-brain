/**
 * Content hashing for duplicate detection. SHA-256 over the UTF-8 bytes of the
 * (already-normalized) text, returned as lowercase hex. Computed with Web
 * Crypto, which is present in the Tauri webview and in Node/jsdom test runs.
 *
 * SHA-256 is chosen so the Rust file-import path (Plan 04b, `sha2`) produces the
 * SAME hash for identical content — a pasted note and an imported file dedupe
 * against each other.
 */
export async function contentHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
