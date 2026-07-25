"use client"

import * as React from "react"
import { Check, ChevronsUpDown, ImageOff, Loader2 } from "lucide-react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import {
  addKitItem,
  searchKitCandidatesAction,
  updateKitItemQty,
} from "@/lib/actions/product-kit-item"
import type { KitCandidate } from "@/lib/queries/product-kit-items"
import {
  kitItemFormSchema,
  type KitItemFormValues,
} from "@/lib/validations/product-kit-item"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// Editing an existing line: the component is fixed, only the quantity changes.
export type KitItemToEdit = {
  id: number
  componentProductId: number
  componentLabel: string
  qty: number
}

const SEARCH_DEBOUNCE_MS = 300

function candidateLabel(candidate: KitCandidate): string {
  return candidate.name ? `${candidate.sku} — ${candidate.name}` : candidate.sku
}

// Async component picker. Filtering happens on the server (there are thousands
// of products), so cmdk's own filtering is switched off.
function ComponentPicker({
  kitProductId,
  value,
  onChange,
  disabled,
}: {
  kitProductId: number
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [keyword, setKeyword] = React.useState("")
  // Results are stored together with the keyword they belong to, so "still
  // loading" is derived (results are stale) instead of tracked in its own state.
  const [result, setResult] = React.useState<{
    keyword: string
    candidates: KitCandidate[]
  } | null>(null)
  // Remembered separately from the result list: the picked product drops out of
  // it as soon as the search term changes, but its label must stay on the
  // trigger button.
  const [picked, setPicked] = React.useState<KitCandidate | null>(null)

  // Debounce the search so typing does not queue one action per keystroke
  // (Server Actions are dispatched sequentially per client).
  React.useEffect(() => {
    if (!open) return

    let active = true
    const timer = setTimeout(async () => {
      const response = await searchKitCandidatesAction(kitProductId, keyword)
      if (!active) return
      if (!response.success) {
        toast.error(response.error ?? "Failed to search products")
      }
      setResult({ keyword, candidates: response.data ?? [] })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [open, keyword, kitProductId])

  const candidates = result?.candidates ?? []
  const isLoading = result?.keyword !== keyword
  const selected =
    picked && String(picked.id) === value
      ? picked
      : (candidates.find((c) => String(c.id) === value) ?? null)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected ? candidateLabel(selected) : "Select a product"}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by SKU or name..."
            value={keyword}
            onValueChange={setKeyword}
          />
          <CommandList>
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Searching...
              </div>
            ) : (
              <CommandEmpty>No matching product found.</CommandEmpty>
            )}
            {candidates.map((candidate) => (
              <CommandItem
                key={candidate.id}
                value={String(candidate.id)}
                onSelect={(next) => {
                  onChange(next)
                  setPicked(candidate)
                  setOpen(false)
                }}
              >
                {candidate.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={candidate.image_url}
                    alt={candidate.name ?? candidate.sku}
                    className="size-7 rounded object-cover"
                  />
                ) : (
                  <div className="flex size-7 items-center justify-center rounded bg-muted text-muted-foreground">
                    <ImageOff className="size-3.5" />
                  </div>
                )}
                <span className="min-w-0 flex-1 truncate">
                  {candidateLabel(candidate)}
                </span>
                <Check
                  className={cn(
                    "ml-auto",
                    String(candidate.id) === value ? "opacity-100" : "opacity-0"
                  )}
                />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// One dialog for both adding a component and editing a line's quantity: the
// only difference is whether the component is picked or already fixed.
export function ProductKitItemDialog({
  open,
  onOpenChange,
  kitProductId,
  item,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kitProductId: number
  item: KitItemToEdit | null
}) {
  const [isPending, startTransition] = React.useTransition()

  const defaultValues = React.useMemo<KitItemFormValues>(
    () => ({
      component_product_id: item ? String(item.componentProductId) : "",
      qty: item ? String(item.qty) : "1",
    }),
    [item]
  )

  const form = useForm<KitItemFormValues>({
    resolver: zodResolver(kitItemFormSchema),
    defaultValues,
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues)
  }, [open, defaultValues, form])

  function onSubmit(values: KitItemFormValues) {
    startTransition(async () => {
      const result = item
        ? await updateKitItemQty(item.id, kitProductId, { qty: values.qty })
        : await addKitItem({
            kit_product_id: kitProductId,
            component_product_id: values.component_product_id,
            qty: values.qty,
          })

      if (result.success) {
        toast.success(item ? "Quantity updated" : "Component added")
        onOpenChange(false)
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {item ? "Edit component quantity" : "Add kit component"}
          </DialogTitle>
          <DialogDescription>
            {item
              ? item.componentLabel
              : "Pick the product that goes into this kit and how many of it are needed."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {!item && (
              <FormField
                control={form.control}
                name="component_product_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Component</FormLabel>
                    <FormControl>
                      <ComponentPicker
                        kitProductId={kitProductId}
                        value={field.value}
                        onChange={field.onChange}
                        disabled={isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="qty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="1"
                      disabled={isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
