import { z } from 'zod'

/**
 * A **brain** is Local Brain's top-level container — one self-contained SQLite
 * database file. Reflect calls this a "graph"; Local Brain keeps "graph" for the
 * Network visualization and uses "brain" for the workspace the picker switches
 * between. These types mirror the Rust `BrainInfo` and the registry's color set.
 */

/**
 * The closed set of brain identity colors, in picker display order. Mirrors the
 * Rust `BRAIN_COLORS`; `indigo` is the default (rendered as the app accent).
 */
export const brainColorSchema = z.enum([
  'indigo',
  'blue',
  'teal',
  'green',
  'amber',
  'orange',
  'red',
  'pink',
  'purple',
])

export type BrainColor = z.infer<typeof brainColorSchema>

/** Every brain color id, in the order pickers should display them. */
export const BRAIN_COLOR_IDS = brainColorSchema.options

/** The color a brain shows before the user picks one. */
export const DEFAULT_BRAIN_COLOR: BrainColor = 'indigo'

/**
 * One brain as the desktop sees it (mirrors the Rust `BrainInfo`). `color` is
 * validated leniently so an unknown value from an older/newer registry degrades
 * to the default rather than failing the whole list.
 */
export const brainInfoSchema = z.object({
  /** Absolute, canonical path of the brain's SQLite file. */
  path: z.string(),
  /** User-facing display name. */
  name: z.string(),
  /** Identity color id; unknown values fall back to the default. */
  color: brainColorSchema.catch(DEFAULT_BRAIN_COLOR),
  createdMs: z.number(),
  lastOpenedMs: z.number(),
  /** Whether this is the currently open brain. */
  isActive: z.boolean(),
  /** Applied schema version — present only for the active brain. */
  schemaVersion: z.number().nullable(),
})

export type BrainInfo = z.infer<typeof brainInfoSchema>

export const brainInfoListSchema = z.array(brainInfoSchema)
