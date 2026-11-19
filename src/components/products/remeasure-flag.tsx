"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Ruler, X } from "lucide-react"
import { toast } from "sonner"

import {
  clearProductRemeasure,
  flagProductForRemeasure,
} from "@/lib/actions/product"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  REMEASURE_NOTE_MAX,
  remeasureFlagSchema,
  type RemeasureFlagInput,
} from "@/lib/validations/product"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * "Measure this next time you are in the warehouse" for one product.
 *
 * Used inside the Postage dialog's weight & size form, so it renders no <form>
 * of its own -- a nested form is invalid HTML and Enter would submit the outer
 * one. The note is submitted through handleSubmit on the button instead, and
 * Enter in the note field is caught here.
 *
 * Clearing is normally automatic (products_remeasure_clear fires when weight or
 * size actually changes); the Clear button is for "measured it, it was right".
 */
export function RemeasureFlag({
  productId,
  requestedAt,
  note,
  className,
}: {
  productId: number
  requestedAt: string | null
  note: string | null
  className?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [editing, setEditing] = React.useState(false)
  // Local so the Postage dialog, which loads its products once, reflects the
  // change without reloading. Re-synced when the server sends a new value.
  const [flag, setFlag] = React.useState({ requestedAt, note })
  const [prev, setPrev] = React.useState({ requestedAt, note })
  if (prev.requestedAt !== requestedAt || prev.note !== note) {
    setPrev({ requestedAt, note })
    setFlag({ requestedAt, note })
  }

  const form = useForm<RemeasureFlagInput>({
    resolver: zodResolver(remeasureFlagSchema),
    defaultValues: { note: "" },
  })

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await flagProductForRemeasure(productId, values)
      if (!result.success) {
        toast.error("Could not flag the product", { description: result.error })
        return
      }
      toast.success("Flagged for re-measuring", {
        description: "It is listed on the dashboard until its weight or size is updated.",
      })
      setFlag({ requestedAt: new Date().toISOString(), note: values.note?.trim() || null })
      setEditing(false)
      form.reset({ note: "" })
      router.refresh()
    })
  })

  function clear() {
    startTransition(async () => {
      const result = await clearProductRemeasure(productId)
      if (!result.success) {
        toast.error("Could not clear the flag", { description: result.error })
        return
      }
      toast.success("Re-measure flag cleared")
      setFlag({ requestedAt: null, note: null })
      router.refresh()
    })
  }

  if (flag.requestedAt) {
    return (
      <div className={cn("flex flex-wrap items-center gap-2 text-sm", className)}>
        <Badge variant="warning">
          <Ruler />
          Re-measure requested {formatDate(flag.requestedAt)}
        </Badge>
        {flag.note ? <span className="text-muted-foreground">{flag.note}</span> : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={clear}
          disabled={isPending}
        >
          {isPending ? <Loader2 className="animate-spin" /> : <X />}
          Clear
        </Button>
      </div>
    )
  }

  if (!editing) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("h-7 w-fit px-2 text-xs", className)}
        onClick={() => setEditing(true)}
      >
        <Ruler />
        Flag for re-measure
      </Button>
    )
  }

  const error = form.formState.errors.note?.message

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          {...form.register("note")}
          autoFocus
          maxLength={REMEASURE_NOTE_MAX}
          placeholder="What looks wrong? (optional)"
          aria-label="Re-measure note"
          className="h-8 min-w-48 flex-1 text-sm"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              void submit()
            }
            if (event.key === "Escape") {
              event.stopPropagation()
              setEditing(false)
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          className="h-8"
          onClick={() => void submit()}
          disabled={isPending}
        >
          {isPending ? <Loader2 className="animate-spin" /> : null}
          Flag
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => setEditing(false)}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
