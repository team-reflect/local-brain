import type { ExtractionContext } from '../extraction/preprocess'
import type { Extractor } from '../extraction/extractor'
import { getModelStatus } from './boundary'
import { getModelProvider } from './provider'

/**
 * The model-backed {@link Extractor} (Plan 05 step 3, deferred here per DEC-12).
 *
 * It feeds the deterministic 05a seam: given an {@link ExtractionContext} (source
 * chunks + dedupe candidates + hints), it prompts the registered provider to
 * return JSON matching the extraction output contract, then hands the raw object
 * back to `runExtraction`, which validates it with `parseExtractionResult` and
 * merges it via `applyExtraction`. The model only ever produces the typed
 * contract; it never writes to the store directly.
 *
 * If the boundary is closed it throws — the ingest-queue handler is best-effort
 * and swallows the error, so capture is never blocked by a missing model.
 */

const INSTRUCTIONS = `You extract structured CRM context from a personal note or meeting record.
Return ONLY a single JSON object (no prose, no code fences) with these optional arrays:
- "people": { ref, fullName, preferredName?, primaryEmail?, headline?, location? }
- "organizations": { ref, name, kind?, domain?, location? }
- "affiliations": { personRef, organizationRef, title?, role?, isCurrent? }
- "projects": { ref, name, status?, summary?, targetDate? }
- "tasks": { ref, title, description?, status?, dueAt?, projectRef?, personRefs?, evidence? }
- "memories": { kind, claim, confidence?, subjects?: [{ ref, role? }], evidence?: [{ chunkIndex, note? }] }
Rules:
- "ref" is a short local id you invent (e.g. "p1", "org1"); reuse it to link entities.
- memory "kind" is one of: fact, preference, decision, commitment, instruction, risk, idea.
- evidence "chunkIndex" must point at one of the numbered SOURCE CHUNKS below.
- Prefer merging onto an existing candidate (reuse its exact name) over inventing duplicates.
- Only include what the text supports. Omit anything you are unsure of. Empty arrays are fine.`

function buildPrompt(context: ExtractionContext): string {
  const lines: string[] = []
  lines.push(INSTRUCTIONS, '')
  lines.push(`SOURCE (${context.source.recordType}): ${context.source.title ?? '(untitled)'}`, '')

  lines.push('SOURCE CHUNKS:')
  for (const chunk of context.chunks) {
    lines.push(`[chunkIndex ${chunk.index}] ${chunk.text}`)
  }
  lines.push('')

  if (context.dates.length) lines.push(`Dates seen: ${context.dates.map((d) => d.value).join(', ')}`)
  if (context.emails.length) lines.push(`Emails seen: ${context.emails.join(', ')}`)

  const { people, organizations } = context.duplicateCandidates
  if (people.length) {
    lines.push('Existing people (merge onto these by name when they match):')
    for (const p of people) lines.push(`- ${p.fullName}${p.primaryEmail ? ` <${p.primaryEmail}>` : ''}`)
  }
  if (organizations.length) {
    lines.push('Existing organizations:')
    for (const o of organizations) lines.push(`- ${o.name}${o.domain ? ` (${o.domain})` : ''}`)
  }

  return lines.join('\n')
}

/** Pull the first balanced JSON object out of model text (tolerates code fences/prose). */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  if (start === -1) throw new Error('model returned no JSON object')
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return JSON.parse(text.slice(start, i + 1))
    }
  }
  throw new Error('model returned an unterminated JSON object')
}

/**
 * Build the model-backed extractor. Register it via
 * `installExtractionPipeline(createModelExtractor())` once a provider is wired.
 */
export function createModelExtractor(): Extractor {
  return async (context: ExtractionContext): Promise<unknown> => {
    const status = await getModelStatus()
    if (!status.canRun) throw new Error(`extraction skipped: ${status.reason}`)
    const provider = getModelProvider()
    if (!provider) throw new Error('extraction skipped: no provider')

    const completion = await provider.generate({
      system: 'You are a precise information-extraction engine. Output only valid JSON.',
      messages: [{ role: 'user', content: buildPrompt(context) }],
      temperature: 0,
      maxTokens: 2048,
    })
    return extractJsonObject(completion.text)
  }
}
