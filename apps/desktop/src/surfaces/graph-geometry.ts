import type { GraphLayout } from './graph-layout'

/**
 * Pure pointer/viewport math for the graph canvas. The SVG renders its viewBox
 * under `xMidYMid meet` — scaled uniformly to fit, then centered — so any
 * mapping between client pixels and graph units has to go through that fit, not
 * the raw bounding rect. Kept side-effect free so it can be unit-tested.
 */

export const MIN_ZOOM = 0.45
export const MAX_ZOOM = 3

export interface GraphPoint {
  x: number
  y: number
}

interface FitTransform {
  /** Pixels per viewBox unit (uniform — the viewBox keeps its aspect ratio). */
  scale: number
  /** Letterbox padding on each axis, from `xMidYMid` centering. */
  offsetX: number
  offsetY: number
}

export function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
}

/**
 * How the viewBox lands inside the rendered SVG box under the default
 * `xMidYMid meet`: scaled uniformly to fit, then centered. Pointer math must go
 * through this — the box can be wider/taller than the viewBox, so mapping across
 * the full rect would drift on letterboxed (height-bounded) routes.
 */
function fitTransform(
  rect: { width: number; height: number },
  layout: Pick<GraphLayout, 'width' | 'height'>,
): FitTransform | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  if (layout.width <= 0 || layout.height <= 0) return null
  const scale = Math.min(rect.width / layout.width, rect.height / layout.height)
  return {
    scale,
    offsetX: (rect.width - layout.width * scale) / 2,
    offsetY: (rect.height - layout.height * scale) / 2,
  }
}

export function clientPointToGraphPoint(
  svg: SVGSVGElement,
  layout: Pick<GraphLayout, 'width' | 'height'>,
  clientX: number,
  clientY: number,
): GraphPoint | null {
  const rect = svg.getBoundingClientRect()
  const fit = fitTransform(rect, layout)
  if (!fit) return null
  return {
    x: (clientX - rect.left - fit.offsetX) / fit.scale,
    y: (clientY - rect.top - fit.offsetY) / fit.scale,
  }
}

export function clientDeltaToGraphDelta(
  svg: SVGSVGElement,
  layout: Pick<GraphLayout, 'width' | 'height'>,
  deltaX: number,
  deltaY: number,
): GraphPoint | null {
  const rect = svg.getBoundingClientRect()
  const fit = fitTransform(rect, layout)
  if (!fit) return null
  // Centering offsets cancel for a delta; only the uniform scale matters.
  return {
    x: deltaX / fit.scale,
    y: deltaY / fit.scale,
  }
}
