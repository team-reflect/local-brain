/**
 * Text normalization and chunking for ingestion. Pure and synchronous so it is
 * trivially unit-testable and identical whether called from the app or a test.
 *
 * Chunks are what retrieval (Plan 06) embeds and searches, and what citations
 * (Plan 03b) quote — so chunking is paragraph-aware: it never splits mid-line
 * when it can avoid it, and only hard-splits a single oversized paragraph.
 */

/**
 * Canonicalize raw text: normalize newlines to `\n`, strip trailing whitespace
 * from each line, collapse 3+ blank lines down to one, and trim the ends.
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface Chunk {
  index: number
  text: string
}

export interface ChunkOptions {
  /** Soft maximum characters per chunk; paragraphs pack up to this size. */
  maxChars?: number
}

const DEFAULT_MAX_CHARS = 1000

/** Hard-split a paragraph that is larger than `maxChars` on its own. */
function splitOversized(paragraph: string, maxChars: number): string[] {
  const pieces: string[] = []
  for (let start = 0; start < paragraph.length; start += maxChars) {
    pieces.push(paragraph.slice(start, start + maxChars))
  }
  return pieces
}

/**
 * Split normalized text into ordered chunks. Paragraphs (blank-line separated)
 * are packed greedily up to `maxChars`; a paragraph that alone exceeds the cap
 * is hard-split. Returns `[]` for empty input.
 */
export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const normalized = normalizeText(text)
  if (!normalized) return []

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .flatMap((paragraph) =>
      paragraph.length > maxChars ? splitOversized(paragraph, maxChars) : [paragraph],
    )

  const chunks: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph
    } else if (current.length + 2 + paragraph.length <= maxChars) {
      current = `${current}\n\n${paragraph}`
    } else {
      chunks.push(current)
      current = paragraph
    }
  }
  if (current) chunks.push(current)

  return chunks.map((chunk, index) => ({ index, text: chunk }))
}
