import { todayLocalDayKey } from '../../lib/queries'

export function describeLastBackfill(day: string | null | undefined): string {
  if (!day) return 'never'
  return day === todayLocalDayKey() ? 'today' : day
}
