import { useState, type ReactNode } from 'react'
import {
  readTextFile,
  readTextFolder,
  type IngestResult,
  isAppError,
} from '@local-brain/core'
import { cn } from '../lib/utils'
import {
  useIngestDocument,
  useIngestInteraction,
  useOrganizations,
  usePeople,
  useProjects,
  useTasks,
} from '../lib/queries'
import { useRouter } from '../routing/router'

export type AddRecordType = 'document' | 'interaction'
type Mode = 'compose' | 'folder'

interface LinkSelection {
  people: string[]
  organizations: string[]
  projects: string[]
  tasks: string[]
}

const EMPTY_LINKS: LinkSelection = { people: [], organizations: [], projects: [], tasks: [] }

/**
 * Add a record by paste or import. Paste/compose creates one document or
 * interaction (with optional links); folder import drains a directory of
 * text/markdown files into documents via the Rust scanner. All writes go through
 * `ingestDocument`/`ingestInteraction`, so chunks, hashing, and dedupe are shared
 * with the rest of ingestion.
 */
export function AddRecordDialog({
  open,
  onClose,
  initialType,
}: {
  open: boolean
  onClose: () => void
  initialType: AddRecordType
}): ReactNode {
  const { navigate } = useRouter()
  const [type, setType] = useState<AddRecordType>(initialType)
  const [mode, setMode] = useState<Mode>('compose')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('')
  const [date, setDate] = useState('')
  const [body, setBody] = useState('')
  const [links, setLinks] = useState<LinkSelection>(EMPTY_LINKS)
  const [folderPath, setFolderPath] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const people = usePeople()
  const projects = useProjects()
  const organizations = useOrganizations()
  const tasks = useTasks({})
  const ingestDocument = useIngestDocument()
  const ingestInteraction = useIngestInteraction()

  // Reset to a clean slate whenever the dialog is (re)opened for a type.
  const [openedFor, setOpenedFor] = useState<AddRecordType | null>(null)
  if (open && openedFor !== initialType) {
    setOpenedFor(initialType)
    setType(initialType)
    setMode('compose')
    setTitle('')
    setKind('')
    setDate('')
    setBody('')
    setLinks(EMPTY_LINKS)
    setFolderPath('')
    setNotice(null)
    setError(null)
  }
  if (!open) {
    if (openedFor !== null) setOpenedFor(null)
    return null
  }

  const busy = ingestDocument.isPending || ingestInteraction.isPending

  function toggle(group: keyof LinkSelection, id: string): void {
    setLinks((current) => {
      const set = current[group]
      return {
        ...current,
        [group]: set.includes(id) ? set.filter((value) => value !== id) : [...set, id],
      }
    })
  }

  async function loadFromPath(path: string): Promise<void> {
    setError(null)
    try {
      const file = await readTextFile(path)
      setBody(file.contents)
      if (!title) setTitle(file.path.split('/').pop() ?? file.path)
    } catch (err) {
      setError(isAppError(err) ? err.message : 'Could not read file')
    }
  }

  function openResult(result: IngestResult): void {
    navigate(type === 'document' ? { kind: 'document', id: result.id } : { kind: 'interaction', id: result.id })
    onClose()
  }

  async function save(): Promise<void> {
    setError(null)
    if (!body.trim()) {
      setError('Add some text first.')
      return
    }
    try {
      if (type === 'document') {
        const result = await ingestDocument.mutateAsync({
          title: title.trim() || null,
          kind: kind.trim() || null,
          bodyText: body,
          authoredAt: date || null,
          links,
        })
        if (result.isDuplicate) {
          setNotice('That content already exists — opening the existing document.')
          openResult(result)
        } else {
          openResult(result)
        }
      } else {
        const result = await ingestInteraction.mutateAsync({
          title: title.trim() || null,
          kind: kind.trim() || 'note',
          bodyText: body,
          occurredAt: date ? new Date(date).toISOString() : null,
          links,
        })
        openResult(result)
      }
    } catch (err) {
      setError(isAppError(err) ? err.message : 'Could not save the record.')
    }
  }

  async function importFolder(): Promise<void> {
    setError(null)
    setNotice(null)
    if (!folderPath.trim()) {
      setError('Enter a folder path.')
      return
    }
    try {
      const scan = await readTextFolder(folderPath.trim())
      let imported = 0
      let duplicates = 0
      for (const file of scan.files) {
        const result = await ingestDocument.mutateAsync({
          title: file.path.split('/').pop() ?? file.path,
          kind: file.kind,
          bodyText: file.contents,
          originalPath: file.path,
        })
        if (result.isDuplicate) duplicates += 1
        else imported += 1
      }
      setNotice(
        `Imported ${imported} document${imported === 1 ? '' : 's'}` +
          ` · ${duplicates} duplicate${duplicates === 1 ? '' : 's'}` +
          ` · ${scan.skippedCount} skipped.`,
      )
    } catch (err) {
      setError(isAppError(err) ? err.message : 'Could not import the folder.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[8vh]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[84vh] w-[40rem] max-w-[92vw] flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <Segmented
            options={[
              { key: 'document', label: 'Document' },
              { key: 'interaction', label: 'Interaction' },
            ]}
            value={type}
            onChange={(next) => setType(next as AddRecordType)}
          />
          <span className="text-muted-foreground">·</span>
          <Segmented
            options={[
              { key: 'compose', label: 'Paste' },
              { key: 'folder', label: 'Import folder' },
            ]}
            value={mode}
            onChange={(next) => setMode(next as Mode)}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-secondary"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {error ? (
            <p className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="mb-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-foreground">
              {notice}
            </p>
          ) : null}

          {mode === 'compose' ? (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Title">
                  <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Kind">
                  <input
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                    placeholder={type === 'document' ? 'note' : 'meeting'}
                    className={inputClass}
                  />
                </Field>
              </div>
              <Field label={type === 'document' ? 'Authored' : 'Occurred'}>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Text">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={8}
                  placeholder="Paste a note or a transcript…"
                  className={cn(inputClass, 'resize-y font-sans')}
                />
              </Field>
              <PathLoader onLoad={loadFromPath} />
              <LinkPickers
                people={people.data ?? []}
                projects={projects.data ?? []}
                organizations={organizations.data ?? []}
                tasks={tasks.data ?? []}
                selection={links}
                onToggle={toggle}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                Scan a folder for <code className="font-mono">.txt</code> and{' '}
                <code className="font-mono">.md</code> files and import each as a document.
                Hidden, unsupported, oversized, and duplicate files are skipped.
              </p>
              <Field label="Folder path">
                <input
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="/Users/you/notes"
                  className={inputClass}
                />
              </Field>
              <button
                type="button"
                disabled={busy}
                onClick={() => void importFolder()}
                className="self-start rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40"
              >
                Scan &amp; import
              </button>
            </div>
          )}
        </div>

        {mode === 'compose' ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40"
            >
              Save {type}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

const inputClass =
  'w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus:border-primary/50'

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[]
  value: string
  onChange: (key: string) => void
}): ReactNode {
  return (
    <div className="flex items-center gap-1">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={cn(
            'rounded px-2 py-1 text-xs transition-colors',
            value === option.key ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function PathLoader({ onLoad }: { onLoad: (path: string) => void | Promise<void> }): ReactNode {
  const [path, setPath] = useState('')
  return (
    <div className="flex items-end gap-2">
      <Field label="…or load from a file path">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/Users/you/notes/meeting.md"
          className={inputClass}
        />
      </Field>
      <button
        type="button"
        onClick={() => void onLoad(path)}
        disabled={path.trim().length === 0}
        className="mb-px rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary/60 disabled:opacity-40"
      >
        Load
      </button>
    </div>
  )
}

interface NamedRow {
  id: string
}

function LinkPickers({
  people,
  projects,
  organizations,
  tasks,
  selection,
  onToggle,
}: {
  people: Array<NamedRow & { fullName: string }>
  projects: Array<NamedRow & { name: string }>
  organizations: Array<NamedRow & { name: string }>
  tasks: Array<NamedRow & { title: string }>
  selection: LinkSelection
  onToggle: (group: keyof LinkSelection, id: string) => void
}): ReactNode {
  return (
    <details className="rounded-md border border-border">
      <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">Link records</summary>
      <div className="grid grid-cols-2 gap-3 px-3 pb-3">
        <LinkGroup label="People" items={people.map((p) => ({ id: p.id, label: p.fullName }))} selected={selection.people} onToggle={(id) => onToggle('people', id)} />
        <LinkGroup label="Projects" items={projects.map((p) => ({ id: p.id, label: p.name }))} selected={selection.projects} onToggle={(id) => onToggle('projects', id)} />
        <LinkGroup label="Organizations" items={organizations.map((o) => ({ id: o.id, label: o.name }))} selected={selection.organizations} onToggle={(id) => onToggle('organizations', id)} />
        <LinkGroup label="Tasks" items={tasks.map((t) => ({ id: t.id, label: t.title }))} selected={selection.tasks} onToggle={(id) => onToggle('tasks', id)} />
      </div>
    </details>
  )
}

function LinkGroup({
  label,
  items,
  selected,
  onToggle,
}: {
  label: string
  items: { id: string; label: string }[]
  selected: string[]
  onToggle: (id: string) => void
}): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="max-h-28 overflow-y-auto">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">None yet.</p>
        ) : (
          items.map((item) => (
            <label key={item.id} className="flex items-center gap-2 py-0.5 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={() => onToggle(item.id)}
              />
              <span className="truncate">{item.label}</span>
            </label>
          ))
        )}
      </div>
    </div>
  )
}
