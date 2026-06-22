import type { ReactNode } from 'react'
import type { GraphNodeKind } from '@local-brain/core'
import { X } from 'lucide-react'
import { Button } from '../components/button'
import type { GraphLayout, PositionedNode } from './graph-layout'
import type { Route } from '../routing/route'

export type GraphFilterKind = GraphNodeKind | 'interaction'
export type VisibleGraphNodeKind = Exclude<GraphNodeKind, 'memory'>
export type VisibleGraphFilterKind = VisibleGraphNodeKind | 'interaction'

/** A calm, distinguishable color per kind (Reflect cool palette, indigo self). */
export const KIND_COLOR: Record<GraphFilterKind, string> = {
  self: '#4f46e5',
  person: '#2563eb',
  organization: '#7c3aed',
  project: '#059669',
  task: '#0891b2',
  document: '#64748b',
  interaction: '#db2777',
  memory: '#d97706',
}

export const KIND_LABEL: Record<VisibleGraphFilterKind, string> = {
  self: 'You',
  person: 'People',
  organization: 'Organizations',
  project: 'Projects',
  task: 'Tasks',
  document: 'Documents',
  interaction: 'Interactions',
}

/** A singular label for a single selected node (the filter labels are plural). */
const KIND_SINGULAR: Record<VisibleGraphNodeKind, string> = {
  self: 'You',
  person: 'Person',
  organization: 'Organization',
  project: 'Project',
  task: 'Task',
  document: 'Document',
}

export const ALL_KINDS = Object.keys(KIND_LABEL) as VisibleGraphFilterKind[]
export const HIDDEN_NODE_KINDS = new Set<GraphNodeKind>(['memory'])

export function routeForNode(node: PositionedNode): Route | null {
  switch (node.kind) {
    case 'self':
    case 'person':
      return { kind: 'person', id: node.id }
    case 'organization':
      return { kind: 'organization', id: node.id }
    case 'project':
      return { kind: 'project', id: node.id }
    case 'task':
      return { kind: 'task', id: node.id }
    case 'document':
      return { kind: 'document', id: node.id }
    case 'memory':
      return null
  }
}

export function actionLabelForNode(node: PositionedNode): string {
  const kind = node.kind === 'self' ? 'person' : node.kind
  return `Open ${kind} ${node.label}`
}

export function selectLabelForNode(node: PositionedNode): string {
  const kind = node.kind === 'self' ? 'person' : node.kind
  return `Select ${kind} ${node.label}`
}

export function clip(label: string): string {
  return label.length > 22 ? `${label.slice(0, 21)}…` : label
}

/** Thicken an interaction edge by how many interactions connect the pair. */
export function interactionEdgeWidth(weight: number | undefined): number {
  return Math.min(6, 1.25 + Math.log2((weight ?? 1) + 1) * 1.1)
}

/** Distinct neighbours of a node among the edges currently drawn. */
export function countConnections(layout: GraphLayout, nodeId: string): number {
  const neighbours = new Set<string>()
  for (const edge of layout.edges) {
    if (edge.source.id === nodeId) neighbours.add(edge.target.id)
    else if (edge.target.id === nodeId) neighbours.add(edge.source.id)
  }
  return neighbours.size
}

/** Contextual panel for the selected node: what it is, how connected, and a way in. */
export function NodeDetailsPanel({
  node,
  connectionCount,
  onOpen,
  onClose,
}: {
  node: PositionedNode
  connectionCount: number
  onOpen: () => void
  onClose: () => void
}): ReactNode {
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border bg-background/95 p-2.5 shadow-[0_8px_28px_rgba(2,6,23,0.12)]"
      role="group"
      aria-label="Selected node"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span
            aria-hidden="true"
            className="inline-block size-2 shrink-0 rounded-full"
            style={{ backgroundColor: KIND_COLOR[node.kind] }}
          />
          {KIND_SINGULAR[node.kind as VisibleGraphNodeKind]}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Clear selection"
          title="Clear selection"
          className="-mr-1 -mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <p className="break-words text-sm font-medium leading-snug text-foreground">{node.label}</p>
      <p className="text-xs text-muted-foreground">
        {connectionCount} {connectionCount === 1 ? 'connection' : 'connections'}
      </p>
      <Button
        variant="primary"
        size="sm"
        className="w-full"
        onClick={onOpen}
        aria-label={actionLabelForNode(node)}
      >
        Open page
      </Button>
    </div>
  )
}
