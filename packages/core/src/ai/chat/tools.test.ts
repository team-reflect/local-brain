import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ZodType } from 'zod'
import { buildChatTools } from './tools'

const coreMocks = vi.hoisted(() => ({
  completeTask: vi.fn(),
  createInteraction: vi.fn(),
  createMemory: vi.fn(),
  createOrganization: vi.fn(),
  createPerson: vi.fn(),
  createProject: vi.fn(),
  createTask: vi.fn(),
  listProjects: vi.fn(),
  retrieve: vi.fn(),
  updateMemory: vi.fn(),
  updateOrganization: vi.fn(),
  updatePerson: vi.fn(),
  updateProject: vi.fn(),
  updateTask: vi.fn(),
}))

vi.mock('ai', () => ({
  tool: (definition: unknown) => definition,
}))

vi.mock('../../retrieval/retrieve', () => ({
  retrieve: coreMocks.retrieve,
}))

vi.mock('../../domains/projects/getters', () => ({
  listProjects: coreMocks.listProjects,
}))

vi.mock('../../domains/people/setters', () => ({
  createPerson: coreMocks.createPerson,
  updatePerson: coreMocks.updatePerson,
}))

vi.mock('../../domains/organizations/setters', () => ({
  createOrganization: coreMocks.createOrganization,
  updateOrganization: coreMocks.updateOrganization,
}))

vi.mock('../../domains/projects/setters', () => ({
  createProject: coreMocks.createProject,
  updateProject: coreMocks.updateProject,
}))

vi.mock('../../domains/tasks/setters', () => ({
  completeTask: coreMocks.completeTask,
  createTask: coreMocks.createTask,
  updateTask: coreMocks.updateTask,
}))

vi.mock('../../domains/interactions/setters', () => ({
  createInteraction: coreMocks.createInteraction,
}))

vi.mock('../../domains/memories/setters', () => ({
  createMemory: coreMocks.createMemory,
  updateMemory: coreMocks.updateMemory,
}))

interface TestTool {
  description: string
  inputSchema: ZodType<Record<string, unknown>>
  needsApproval?: boolean
  execute: (input: Record<string, unknown>) => Promise<unknown>
}

function chatTools(): Record<string, TestTool> {
  return buildChatTools() as unknown as Record<string, TestTool>
}

function toolByName(tools: Record<string, TestTool>, name: string): TestTool {
  const found = tools[name]
  if (!found) throw new Error(`missing tool: ${name}`)
  return found
}

describe('buildChatTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps read tools executable without approval', async () => {
    coreMocks.retrieve.mockResolvedValue({
      chunks: [
        {
          recordType: 'interaction',
          recordId: 'i1',
          recordTitle: 'Sync',
          snippet: 'budget',
          text: 'budget changed',
        },
      ],
      semanticAvailable: true,
    })
    coreMocks.listProjects.mockResolvedValue([
      { id: 'p1', name: 'Atlas', status: 'active', summary: null, targetDate: null, completedOn: null },
    ])

    const tools = chatTools()
    const searchRecords = toolByName(tools, 'search_records')
    const listProjectsTool = toolByName(tools, 'list_projects')
    const searchOutput = await searchRecords.execute(searchRecords.inputSchema.parse({ query: 'budget' }))
    const projectsOutput = await listProjectsTool.execute(listProjectsTool.inputSchema.parse({ status: 'active' }))

    expect(searchRecords.needsApproval).toBeUndefined()
    expect(listProjectsTool.needsApproval).toBeUndefined()
    expect(searchOutput).toMatchObject({ count: 1, semanticAvailable: true })
    expect(projectsOutput).toMatchObject({ count: 1 })
  })

  it('requires approval for every write tool', () => {
    const tools = chatTools()
    for (const name of [
      'create_task',
      'update_task',
      'complete_task',
      'create_person',
      'update_person',
      'create_organization',
      'update_organization',
      'create_project',
      'update_project',
      'log_interaction',
      'remember_fact',
      'update_memory',
    ]) {
      expect(toolByName(tools, name).needsApproval, name).toBe(true)
    }
  })

  it('creates, updates, and completes tasks through domain setters', async () => {
    coreMocks.createTask.mockResolvedValue('task-1')
    coreMocks.updateTask.mockResolvedValue(1)
    coreMocks.completeTask.mockResolvedValue(1)
    const tools = chatTools()
    const createTaskTool = toolByName(tools, 'create_task')
    const updateTaskTool = toolByName(tools, 'update_task')
    const completeTaskTool = toolByName(tools, 'complete_task')

    await expect(
      createTaskTool.execute(createTaskTool.inputSchema.parse({ title: 'Send budget' })),
    ).resolves.toEqual({ kind: 'task', action: 'created', id: 'task-1' })
    await expect(
      updateTaskTool.execute(updateTaskTool.inputSchema.parse({ id: 'task-1', status: 'waiting' })),
    ).resolves.toEqual({ kind: 'task', action: 'updated', id: 'task-1', affected: 1 })
    await expect(
      completeTaskTool.execute(completeTaskTool.inputSchema.parse({ id: 'task-1' })),
    ).resolves.toEqual({ kind: 'task', action: 'completed', id: 'task-1', affected: 1 })
    await expect(
      completeTaskTool.execute(completeTaskTool.inputSchema.parse({ id: 'task-2', completedAt: '   ' })),
    ).resolves.toEqual({ kind: 'task', action: 'completed', id: 'task-2', affected: 1 })

    expect(coreMocks.createTask).toHaveBeenCalledWith({ title: 'Send budget' })
    expect(coreMocks.updateTask).toHaveBeenCalledWith('task-1', { status: 'waiting' })
    expect(coreMocks.completeTask).toHaveBeenCalledWith('task-1', undefined)
    expect(coreMocks.completeTask).toHaveBeenCalledWith('task-2', undefined)
  })

  it('logs interactions with participants', async () => {
    coreMocks.createInteraction.mockResolvedValue('interaction-1')
    const tools = chatTools()
    const logInteractionTool = toolByName(tools, 'log_interaction')

    await expect(
      logInteractionTool.execute(
        logInteractionTool.inputSchema.parse({
          kind: 'meeting',
          title: 'Launch sync',
          participants: [{ personId: 'person-1', role: 'attendee' }],
        }),
      ),
    ).resolves.toEqual({ kind: 'interaction', action: 'created', id: 'interaction-1' })

    expect(coreMocks.createInteraction).toHaveBeenCalledWith(
      { kind: 'meeting', title: 'Launch sync' },
      [{ personId: 'person-1', role: 'attendee' }],
    )
  })

  it('stores memories and reports duplicate existing memories', async () => {
    coreMocks.createMemory.mockResolvedValue({ id: 'memory-1', created: false })
    const tools = chatTools()
    const rememberFactTool = toolByName(tools, 'remember_fact')

    await expect(
      rememberFactTool.execute(
        rememberFactTool.inputSchema.parse({
          claim: 'Alex prefers async updates.',
          kind: 'preference',
          subjects: [{ recordType: 'person', recordId: 'person-1', role: 'subject' }],
        }),
      ),
    ).resolves.toEqual({ kind: 'memory', action: 'existing', id: 'memory-1' })

    expect(coreMocks.createMemory).toHaveBeenCalledWith(
      { claim: 'Alex prefers async updates.', kind: 'preference' },
      [{ recordType: 'person', recordId: 'person-1', role: 'subject' }],
    )
  })
})
