import { useState, type ReactNode } from 'react'
import { Unlink } from 'lucide-react'
import { Alert } from '../../components/alert'
import { Button } from '../../components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog'
import { errorMessage } from '../../lib/utils'
import { useActiveBrain, useForgetBrain } from '../../lib/queries'

export function DestructiveSettings(): ReactNode {
  const active = useActiveBrain()
  const forget = useForgetBrain()
  const [forgetOpen, setForgetOpen] = useState(false)
  const [forgetError, setForgetError] = useState<string | null>(null)
  const brain = active.data

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
    <section aria-label="Destructive settings" className="flex flex-col gap-2">
      <h2 className="text-xs font-medium text-destructive">Destructive</h2>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-destructive/35 bg-destructive/5 p-4 text-sm">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="font-semibold text-destructive">Forget brain</h3>
          <p className="text-xs text-muted-foreground">
            Remove this brain from Local Brain and close it. Files stay on disk.
          </p>
        </div>
        <Button
          variant="destructive"
          onClick={() => {
            setForgetError(null)
            setForgetOpen(true)
          }}
          disabled={!brain || forget.isPending}
        >
          <Unlink className="size-3.5" aria-hidden />
          Forget brain
        </Button>
      </div>

      {brain ? (
        <Dialog open={forgetOpen} onOpenChange={(next) => (next ? undefined : setForgetOpen(false))}>
          <DialogContent className="w-[28rem]" aria-label={`Forget ${brain.name}`}>
            <DialogTitle className="border-b border-border px-4 py-2.5">
              Forget {brain.name}
            </DialogTitle>
            <div className="flex flex-col gap-3 px-4 py-3">
              {forgetError ? <Alert variant="error">{forgetError}</Alert> : null}
              <DialogDescription>
                This removes the brain from Local Brain's list and returns you to the brain
                chooser. It does not delete the folder, database, assets, or support files.
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
      ) : null}
    </section>
  )
}
