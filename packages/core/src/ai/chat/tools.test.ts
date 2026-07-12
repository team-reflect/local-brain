import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ZodType } from 'zod'
import { buildChatTools, executeChatWriteTool } from './tools'

const coreMocks = vi.hoisted(() => ({
  assertActiveDatabaseIdentity: vi.fn(),
  completeTask: vi.fn(),
  createInteraction: vi.fn(),
  createMemory: vi.fn(),
  createOrganization: vi.fn(),
  createPerson: vi.fn(),
  createProject: vi.fn(),
  createTask: vi.fn(),
  getChatRecords: vi.fn(),
  listChatTasks: vi.fn(),
  listProjects: vi.fn(),
  searchRecordCandidates: vi.fn(),
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
  RETRIEVABLE_SOURCE_KINDS: [
    'person',
    'organization',
    'organization_profile',
    'project',
    'task',
    'document',
    'interaction',
    'interaction_transcript',
    'ai_note',
    'extracted_fact',
    'memory',
    'asset',
  ],
}))

vi.mock('../../retrieval/record-candidates', () => ({
  searchRecordCandidates: coreMocks.searchRecordCandidates,
}))

vi.mock('../../db/identity', () => ({
  assertActiveDatabaseIdentity: coreMocks.assertActiveDatabaseIdentity,
}))

vi.mock('./task-browser', () => ({
  listChatTasks: coreMocks.listChatTasks,
}))

vi.mock('../../domains/projects/getters', () => ({
  listProjects: coreMocks.listProjects,
}))

vi.mock('./record-details', () => ({
  DEFAULT_RECORD_DETAIL_CHARS: 4000,
  DEFAULT_RECORD_DETAIL_TOTAL_CHARS: 24000,
  MAX_RECORD_DETAIL_CHARS: 12000,
  MAX_RECORD_DETAIL_TOTAL_CHARS: 32000,
  getChatRecords: coreMocks.getChatRecords,
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
    coreMocks.assertActiveDatabaseIdentity.mockResolvedValue(undefined)
  })

  it('discards a read result when the active brain switches during the tool', async () => {
    const stale = {
      kind: 'stale',
      message: 'The active brain changed while this operation was in flight.',
    }
    coreMocks.searchRecordCandidates.mockResolvedValue({
      candidates: [{
        recordType: 'document',
        recordId: 'private-b-record',
        recordRef: 'document:private-b-record',
        title: 'Must not escape',
        date: null,
        evidence: [],
        matchReasons: ['title'],
      }],
      semanticAvailable: false,
    })
    coreMocks.assertActiveDatabaseIdentity
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(stale)
    const tools = buildChatTools({
      databaseIdentity: { databasePath: '/brain-a/brain.sqlite', generation: 7 },
    }) as unknown as Record<string, TestTool>

    await expect(toolByName(tools, 'search_records').execute({ query: 'private' })).rejects.toEqual(
      stale,
    )
    expect(coreMocks.assertActiveDatabaseIdentity).toHaveBeenCalledTimes(2)
  })

  it('keeps read tools executable without approval', async () => {
    coreMocks.searchRecordCandidates.mockResolvedValue({
      candidates: [
        {
          recordType: 'interaction',
          recordId: 'i1',
          recordRef: 'interaction:i1',
          title: 'Sync',
          date: null,
          evidence: [{ chunkId: 'chunk-1', chunkIndex: 0, snippet: 'budget' }],
          matchReasons: ['title'],
        },
      ],
      semanticAvailable: true,
    })
    coreMocks.listProjects.mockResolvedValue([
      {
        id: 'p1',
        name: 'Atlas',
        status: 'active',
        summary: null,
        targetDate: null,
        completedOn: null,
        updatedAt: '2026-06-19T00:00:00.000Z',
      },
    ])
    coreMocks.listChatTasks.mockResolvedValue([
      {
        recordType: 'task',
        recordId: 'task-1',
        recordRef: 'task:task-1',
        title: 'Send budget',
        date: '2026-06-20',
        status: 'open',
      },
    ])
    coreMocks.getChatRecords.mockResolvedValue([
      {
        recordType: 'interaction',
        recordId: 'i1',
        recordRef: 'interaction:i1',
        found: true,
        title: 'Sync',
        date: null,
        metadata: {},
        chunks: [],
        truncated: false,
      },
    ])

    const tools = chatTools()
    const searchRecords = toolByName(tools, 'search_records')
    const browseRecords = toolByName(tools, 'browse_records')
    const getRecords = toolByName(tools, 'get_records')
    const listTasks = toolByName(tools, 'list_tasks')
    const listProjectsTool = toolByName(tools, 'list_projects')
    const searchOutput = await searchRecords.execute(searchRecords.inputSchema.parse({ query: 'budget' }))
    const browseOutput = await browseRecords.execute(
      browseRecords.inputSchema.parse({ recordTypes: ['interaction'] }),
    )
    const recordsOutput = await getRecords.execute(
      getRecords.inputSchema.parse({ records: [{ recordType: 'interaction', recordId: 'i1' }] }),
    )
    const tasksOutput = await listTasks.execute(listTasks.inputSchema.parse({ statuses: ['open'] }))
    const projectsOutput = await listProjectsTool.execute(listProjectsTool.inputSchema.parse({ status: 'active' }))

    for (const tool of [searchRecords, browseRecords, getRecords, listTasks, listProjectsTool]) {
      expect(tool.needsApproval).toBeUndefined()
    }
    expect(searchOutput).toMatchObject({ count: 1, semanticAvailable: true })
    expect(browseOutput).toMatchObject({ count: 1 })
    expect(coreMocks.searchRecordCandidates).toHaveBeenCalledWith(
      'budget',
      expect.objectContaining({ mode: 'hybrid', sort: 'relevance' }),
    )
    expect(recordsOutput).toMatchObject({ count: 1 })
    expect(tasksOutput).toMatchObject({
      count: 1,
      records: [expect.objectContaining({ recordRef: 'task:task-1' })],
    })
    expect(projectsOutput).toMatchObject({
      count: 1,
      records: [expect.objectContaining({ recordRef: 'project:p1' })],
    })
  })

  it('combines topic search with relationship, type, kind, and date filters', async () => {
    coreMocks.searchRecordCandidates.mockResolvedValue({
      candidates: [
        {
          recordType: 'interaction',
          recordId: 'i1',
          recordRef: 'interaction:i1',
          title: 'Budget email',
          date: '2026-06-18T00:00:00.000Z',
          evidence: [{ chunkId: 'chunk-1', chunkIndex: 0, snippet: 'budget' }],
          matchReasons: ['chunk'],
        },
      ],
      semanticAvailable: true,
    })
    const searchRecords = toolByName(chatTools(), 'search_records')

    const output = await searchRecords.execute(
      searchRecords.inputSchema.parse({
        query: 'pricing',
        recordTypes: ['interaction'],
        kinds: ['email'],
        after: '2026-06-07T00:00:00.000Z',
        relatedTo: [{ recordType: 'person', recordId: 'person-jordan' }],
      }),
    )

    expect(coreMocks.searchRecordCandidates).toHaveBeenCalledWith('pricing', {
      mode: 'hybrid',
      sort: 'relevance',
      limit: 20,
      recordTypes: ['interaction'],
      kinds: ['email'],
      after: '2026-06-07T00:00:00.000Z',
      relatedTo: [{ recordType: 'person', recordId: 'person-jordan' }],
    })
    expect(output).toMatchObject({
      count: 1,
      records: [expect.objectContaining({
        recordRef: 'interaction:i1',
        evidence: [expect.objectContaining({ chunkId: 'chunk-1' })],
      })],
    })
  })

  it('uses queryless recency browse and rejects an unconstrained browse', async () => {
    coreMocks.searchRecordCandidates.mockResolvedValue({ candidates: [], semanticAvailable: false })
    const browseRecords = toolByName(chatTools(), 'browse_records')

    await browseRecords.execute(
      browseRecords.inputSchema.parse({
        recordTypes: ['interaction'],
        kinds: ['email'],
        after: '2026-06-01',
        limit: 50,
      }),
    )

    expect(coreMocks.searchRecordCandidates).toHaveBeenCalledWith('', {
      mode: 'hybrid',
      sort: 'recency',
      limit: 50,
      recordTypes: ['interaction'],
      kinds: ['email'],
      after: '2026-06-01',
    })
    await expect(browseRecords.execute(browseRecords.inputSchema.parse({}))).rejects.toThrow(
      /Choose at least one browse filter/,
    )
    expect(() => browseRecords.inputSchema.parse({ recordTypes: ['interaction'], limit: 51 })).toThrow()
  })

  it('keeps retrieval mode and sort out of the model-selectable search contract', async () => {
    coreMocks.searchRecordCandidates.mockResolvedValue({ candidates: [], semanticAvailable: true })
    const searchRecords = toolByName(chatTools(), 'search_records')

    const parsed = searchRecords.inputSchema.parse({
      query: '01ABC exact phrase',
      mode: 'lexical',
      sort: 'recency',
    })
    await searchRecords.execute(parsed)

    expect(parsed).not.toHaveProperty('mode')
    expect(parsed).not.toHaveProperty('sort')
    expect(coreMocks.searchRecordCandidates).toHaveBeenCalledWith(
      '01ABC exact phrase',
      expect.objectContaining({ mode: 'hybrid', sort: 'relevance' }),
    )
  })

  it('passes searchable kinds through get_records with chunk focus and bounded call budget', async () => {
    coreMocks.getChatRecords.mockResolvedValue([])
    const getRecords = toolByName(chatTools(), 'get_records')
    const recordTypes = [
      'person',
      'organization',
      'organization_profile',
      'project',
      'task',
      'document',
      'interaction',
      'interaction_transcript',
      'ai_note',
      'extracted_fact',
      'memory',
      'asset',
    ]
    const records = recordTypes.map((recordType, index) => ({
      recordType,
      recordId: `record-${index}`,
      chunkIds: [`chunk-${index}`],
    }))

    for (const record of records) {
      expect(() => getRecords.inputSchema.parse({ records: [record] })).not.toThrow()
    }

    await getRecords.execute(getRecords.inputSchema.parse({
      records: records.slice(0, 10),
      maxCharsPerRecord: 12000,
      maxTotalChars: 32000,
    }))

    expect(coreMocks.getChatRecords).toHaveBeenCalledWith(
      records.slice(0, 10),
      { maxCharsPerRecord: 12000, maxTotalChars: 32000 },
    )
    expect(() => getRecords.inputSchema.parse({ records })).toThrow()
    expect(() =>
      getRecords.inputSchema.parse({
        records: [{ recordType: 'interaction', recordId: 'i1', chunkIds: ['a', 'b', 'c', 'd', 'e', 'f'] }],
      }),
    ).toThrow()
    expect(() =>
      getRecords.inputSchema.parse({
        records: [{ recordType: 'interaction', recordId: 'i1' }],
        maxCharsPerRecord: 12001,
      }),
    ).toThrow()
    expect(() =>
      getRecords.inputSchema.parse({
        records: [{ recordType: 'interaction', recordId: 'i1' }],
        maxTotalChars: 32001,
      }),
    ).toThrow()
  })

  it('requires a non-blank topic query for search_records', () => {
    const searchRecords = toolByName(chatTools(), 'search_records')

    expect(() => searchRecords.inputSchema.parse({})).toThrow()
    expect(() => searchRecords.inputSchema.parse({ query: '   ' })).toThrow()
    expect(coreMocks.searchRecordCandidates).not.toHaveBeenCalled()
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

  it('executes approved write tools directly from persisted tool input', async () => {
    coreMocks.createTask.mockResolvedValue('task-1')

    await expect(
      executeChatWriteTool('create_task', {
        title: 'Send budget',
        status: 'open',
        priority: 2,
      }),
    ).resolves.toEqual({ kind: 'task', action: 'created', id: 'task-1' })

    expect(coreMocks.createTask).toHaveBeenCalledWith({
      title: 'Send budget',
      status: 'open',
      priority: 2,
    })
  })

  it('throws when an approved update affects no rows', async () => {
    coreMocks.updateTask.mockResolvedValue(0)
    const tools = chatTools()
    const updateTaskTool = toolByName(tools, 'update_task')

    await expect(
      updateTaskTool.execute(updateTaskTool.inputSchema.parse({ id: 'missing-task', status: 'waiting' })),
    ).rejects.toThrow('No task was updated')
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
