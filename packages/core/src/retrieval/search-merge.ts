import type { SearchHit } from './search-types'

/**
 * Collapse hits for the same record (a record can surface from text, name, and
 * tag passes), keeping the strongest — preferring one that carries a snippet on
 * a score tie — then rank by score with a title tie-break for stable ordering.
 *
 * Mirrored in Rust by `dedupe_and_rank_hits` in apps/cli/src/commands/read.rs.
 */
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
