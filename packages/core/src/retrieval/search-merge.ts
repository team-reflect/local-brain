import type { SearchHit } from './search-types'

export function dedupeAndRank(hits: SearchHit[]): SearchHit[] {
  const unique = new Map<string, SearchHit>()
  for (const hit of hits) {
    const key = `${hit.kind}:${hit.id}`
    const existing = unique.get(key)
    if (
      !existing ||
      hit.score > existing.score ||
      (hit.score === existing.score && existing.snippet === null && hit.snippet !== null)
    ) {
      unique.set(key, hit)
    }
  }
  return [...unique.values()].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
}
