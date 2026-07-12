const METADATA_TEXT_LIMIT = 600
const METADATA_TOTAL_TEXT_LIMIT = 3_000
const METADATA_ARRAY_LIMIT = 20
const METADATA_OBJECT_KEY_LIMIT = 30
const METADATA_DEPTH_LIMIT = 4

interface MetadataBudget {
  remaining: number
}

function trimMetadataText(value: string, limit = METADATA_TEXT_LIMIT): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 3).trimEnd()}...`
}

/** Parse stored JSON while keeping malformed legacy text bounded and readable. */
export function parseJsonField(value: string | null): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return trimMetadataText(value)
  }
}

function boundedMetadataValue(
  value: unknown,
  budget: MetadataBudget,
  depth = 0,
): unknown {
  if (value === null || value === undefined || value === '' || budget.remaining <= 0) {
    return undefined
  }
  if (typeof value === 'string') {
    const compact = trimMetadataText(value)
    if (!compact) return undefined
    const available = Math.min(compact.length, budget.remaining)
    if (available <= 0) return undefined
    const bounded = compact.length <= available
      ? compact
      : available === 1
        ? compact.slice(0, 1)
        : `${compact.slice(0, available - 1).trimEnd()}…`
    budget.remaining -= bounded.length
    return bounded
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    budget.remaining -= Math.min(String(value).length, budget.remaining)
    return value
  }
  if (depth >= METADATA_DEPTH_LIMIT) return undefined
  if (Array.isArray(value)) {
    const bounded: unknown[] = []
    for (const item of value.slice(0, METADATA_ARRAY_LIMIT)) {
      const next = boundedMetadataValue(item, budget, depth + 1)
      if (next !== undefined) bounded.push(next)
      if (budget.remaining <= 0) break
    }
    return bounded.length > 0 ? bounded : undefined
  }
  if (typeof value === 'object') {
    const bounded: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value).slice(0, METADATA_OBJECT_KEY_LIMIT)) {
      if (budget.remaining <= 0) break
      budget.remaining -= Math.min(key.length, budget.remaining)
      const next = boundedMetadataValue(item, budget, depth + 1)
      if (next !== undefined) bounded[key] = next
    }
    return Object.keys(bounded).length > 0 ? bounded : undefined
  }
  return undefined
}

/** Remove empty metadata and enforce shared text, collection, and depth budgets. */
export function cleanMetadata(values: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  const budget: MetadataBudget = { remaining: METADATA_TOTAL_TEXT_LIMIT }
  for (const [key, value] of Object.entries(values)) {
    if (budget.remaining <= 0) break
    budget.remaining -= Math.min(key.length, budget.remaining)
    const bounded = boundedMetadataValue(value, budget)
    if (bounded !== undefined) metadata[key] = bounded
  }
  return metadata
}
