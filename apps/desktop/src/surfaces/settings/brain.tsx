import { useState, type ReactNode } from 'react'
import { Check, ChevronsUpDown, SquareArrowOutUpRight, Unlink } from 'lucide-react'
import { BrainSwatch } from '../../components/brain-swatch'
import { Button } from '../../components/button'
import { Section } from '../../components/section'
import { Alert } from '../../components/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { BRAIN_COLOR_OPTIONS } from '../../lib/brain-colors'
import { cn, errorMessage } from '../../lib/utils'
import { sectionLabel } from '../../lib/ui'
import {
  useActiveBrain,
  useForgetBrain,
  useRenameBrain,
  useRevealBrain,
  useSetBrainColor,
} from '../../lib/queries'

export function BrainSettings(): ReactNode {
  const active = useActiveBrain()
  const rename = useRenameBrain()
  const setColor = useSetBrainColor()
  const reveal = useRevealBrain()
  const forget = useForgetBrain()
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [colorOpen, setColorOpen] = useState(false)
  const [forgetOpen, setForgetOpen] = useState(false)
  const [forgetError, setForgetError] = useState<string | null>(null)

  const brain = active.data
  const nameValue = nameDraft ?? brain?.name ?? ''
  const nameChanged =
    brain != null && nameValue.trim().length > 0 && nameValue.trim() !== brain.name
  const colorLabel =
    BRAIN_COLOR_OPTIONS.find((option) => option.id === brain?.color)?.label ?? 'Indigo'

  function saveName(): void {
    if (brain && nameChanged) {
      rename.mutate({ rootPath: brain.rootPath, name: nameValue.trim() })
      setNameDraft(null)
    }
  }

  async function confirmForget(): Promise<void> {
    if (!brain) return
    setForgetError(null)
    try {
      await forget.mutateAsync(brain.rootPath)
      setForgetOpen(false)
    } catch (error) {
      setForgetError(errorMessage(error))
    }
  }

  return (
    <Section title="Brain">
      <div className="flex flex-col gap-4 text-sm">
        {brain ? (
          <>
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2.5">
                <BrainSwatch color={brain.color} className="size-5" />
                <span className="text-sm font-semibold text-foreground">{brain.name}</span>
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="size-3.5 text-primary" aria-hidden />
                  active
                </span>
              </div>

              <BrainField label="Name">
                <div className="flex items-center gap-2">
                  <Input
                    value={nameValue}
                    onChange={(event) => setNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') saveName()
                    }}
                  />
                  <Button
                    variant="outline"
                    disabled={!nameChanged || rename.isPending}
                    onClick={saveName}
                  >
                    Save
                  </Button>
                </div>
              </BrainField>

              <BrainField label="Color">
                <Popover open={colorOpen} onOpenChange={setColorOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-fit min-w-40 justify-between"
                      aria-label="Brain color"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <BrainSwatch color={brain.color} className="size-3.5" />
                        <span className="truncate">{colorLabel}</span>
                      </span>
                      <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-44 p-1">
                    {BRAIN_COLOR_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={option.id === brain.color}
                        onClick={() => {
                          setColor.mutate({ rootPath: brain.rootPath, color: option.id })
                          setColorOpen(false)
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary',
                          option.id === brain.color ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        <span
                          aria-hidden
                          className="size-3.5 rounded-[4px]"
                          style={{ backgroundColor: option.css }}
                        />
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        {option.id === brain.color ? (
                          <Check className="size-3.5 text-primary" aria-hidden />
                        ) : null}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              </BrainField>

              <BrainField label="Folder">
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-card-foreground">
                    {brain.rootPath}
                  </code>
                  <Button
                    variant="ghost"
                    onClick={() => reveal.mutate(brain.rootPath)}
                    aria-label="Reveal in file manager"
                  >
                    <SquareArrowOutUpRight className="size-3.5" aria-hidden />
                    Reveal
                  </Button>
                </div>
              </BrainField>

              <BrainActionField label="Forget">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 text-xs text-muted-foreground">
                    Remove this brain from Local Brain and close it. Files stay on disk.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setForgetError(null)
                      setForgetOpen(true)
                    }}
                    disabled={forget.isPending}
                  >
                    <Unlink className="size-3.5" aria-hidden />
                    Forget brain
                  </Button>
                </div>
              </BrainActionField>
            </div>

            <Dialog
              open={forgetOpen}
              onOpenChange={(next) => (next ? undefined : setForgetOpen(false))}
            >
              <DialogContent className="w-[28rem]" aria-label={`Forget ${brain.name}`}>
                <DialogTitle className="border-b border-border px-4 py-2.5">
                  Forget {brain.name}
                </DialogTitle>
                <div className="flex flex-col gap-3 px-4 py-3">
                  {forgetError ? <Alert variant="error">{forgetError}</Alert> : null}
                  <DialogDescription>
                    This removes the brain from Local Brain's list and returns you to the
                    brain chooser. It does not delete the folder, database, assets, or
                    support files.
                  </DialogDescription>
                  <code className="truncate rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-card-foreground">
                    {brain.rootPath}
                  </code>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
                  <Button
                    variant="ghost"
                    onClick={() => setForgetOpen(false)}
                    disabled={forget.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={forget.isPending}
                    onClick={() => void confirmForget()}
                  >
                    Forget brain
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </>
        ) : (
          <p className="text-muted-foreground">No active brain.</p>
        )}
      </div>
    </Section>
  )
}

function BrainField({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <label className="flex flex-col gap-1">
      <span className={sectionLabel}>{label}</span>
      {children}
    </label>
  )
}

function BrainActionField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <span className={sectionLabel}>{label}</span>
      {children}
    </div>
  )
}
