/**
 * The canonical, ordered registry of settings page sections. The section cards
 * and the sticky navigator both render from this list, so the navigator's
 * labels and jump targets can never drift from the page itself. (Adapted from
 * Reflect Open's settings registry.)
 *
 * The "Destructive" danger zone is deliberately NOT listed here: it renders as
 * its own labelled region below the navigated sections, so it never appears in
 * the rail.
 */
export const SETTINGS_SECTIONS = [
  { id: 'about', title: 'About' },
  { id: 'appearance', title: 'Appearance' },
  { id: 'brain', title: 'Brain' },
  { id: 'ai-providers', title: 'AI providers' },
  { id: 'search', title: 'Semantic search' },
  { id: 'cli-agents', title: 'CLI & agents' },
] as const

/** Identifier of one {@link SETTINGS_SECTIONS} entry. */
export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']

/** Whether an arbitrary route `section` value names a real section card. */
export function isSettingsSectionId(value: string | undefined): value is SettingsSectionId {
  return value !== undefined && SETTINGS_SECTIONS.some((section) => section.id === value)
}

/** The heading a section renders — shared by its card and the navigator. */
export function settingsSectionTitle(id: SettingsSectionId): string {
  return SETTINGS_SECTIONS.find((section) => section.id === id)?.title ?? id
}

/** The DOM id a section card carries (prefixed to keep document ids unique). */
export function settingsSectionDomId(id: SettingsSectionId): string {
  return `settings-${id}`
}
