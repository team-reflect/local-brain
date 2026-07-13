/**
 * A generic "part" from a persisted UIMessage. We work with plain JSON records
 * because tool parts are stored and reloaded independently of the SDK types.
 */
export interface ToolPart {
  type: string
  toolCallId?: string
  state?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  approval?: {
    id?: string
    approved?: boolean
  }
  errorText?: string
}

export interface ToolApprovalResponse {
  id: string
  approved: boolean
}

/** Extract the tool name from the part type, e.g. 'tool-search_records' → 'search_records'. */
export function toolNameFromPart(part: ToolPart): string {
  return part.type.startsWith('tool-') ? part.type.slice(5) : part.type
}

/** True while the model is still calling the tool or waiting for its result. */
export function isToolPartPending(part: ToolPart): boolean {
  return part.state === 'input-streaming' || part.state === 'input-available'
}

/** True when a write tool is paused on an explicit user approval decision. */
export function isToolPartAwaitingApproval(part: ToolPart): boolean {
  return part.state === 'approval-requested' && typeof part.approval?.id === 'string'
}

export function messageHasAwaitingToolApproval(message: {
  role?: string
  parts?: readonly unknown[]
}): boolean {
  return message.role === 'assistant' && (message.parts ?? []).some((part) => {
    const record = part as Record<string, unknown>
    return String(record['type'] ?? '').startsWith('tool-') &&
      isToolPartAwaitingApproval(record as unknown as ToolPart)
  })
}
