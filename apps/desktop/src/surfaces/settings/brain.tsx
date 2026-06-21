import { useState, type ReactNode } from 'react'
import { Check, ChevronsUpDown, SquareArrowOutUpRight } from 'lucide-react'
import { BrainSwatch } from '../../components/brain-swatch'
import { Button } from '../../components/button'
import { Section } from '../../components/section'
import { Input } from '../../components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { BRAIN_COLOR_OPTIONS } from '../../lib/brain-colors'
import { cn } from '../../lib/utils'
import { sectionLabel } from '../../lib/ui'
import {
  useActiveBrain,
  useRenameBrain,
  useRevealBrain,
  useSetBrainColor,
} from '../../lib/queries'

export function BrainSettings(): ReactNode {
  const active = useActiveBrain()
  const rename = useRenameBrain()
  const setColor = useSetBrainColor()
  const reveal = useRevealBrain()
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [colorOpen, setColorOpen] = useState(false)

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

  return (
    <Section title="Brain">
      <div className="flex flex-col gap-4 text-sm">
        {brain ? (
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
          </div>
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
