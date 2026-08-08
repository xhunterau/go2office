"use client"

import * as React from "react"
import { Check, ChevronsUpDown, ImageOff, Loader2 } from "lucide-react"
import { toast } from "sonner"

import type { ActionResult } from "@/lib/actions/action-result"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// The minimum a row needs to be rendered. Callers search for wider shapes (the
// order line picker also reads retail_price and is_kit) and get them back in
// onSelect, so the extra columns never have to be re-fetched.
export type ProductPickerOption = {
  id: number
  sku: string
  name: string | null
  image_url: string | null
}

const SEARCH_DEBOUNCE_MS = 300

export function productPickerLabel(option: ProductPickerOption): string {
  return option.name ? `${option.sku} — ${option.name}` : option.sku
}

// Async product picker, shared by the kit component dialog and the order line
// dialog.
//
// Filtering happens on the server -- there are thousands of products -- so
// cmdk's own filtering is switched off and the list is whatever the last search
// returned.
export function ProductPicker<T extends ProductPickerOption>({
  search,
  value,
  onSelect,
  disabled,
  placeholder = "Select a product",
  searchPlaceholder = "Search by SKU or name...",
  emptyText = "No matching product found.",
  renderMeta,
}: {
  // A Server Action bound to whatever candidate set this picker offers.
  search: (keyword: string) => Promise<ActionResult<T[]>>
  // The selected option's id as a string, or "" -- matching what react-hook-form
  // holds for a select.
  value: string
  onSelect: (option: T) => void
  disabled?: boolean
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  // Trailing content per row, e.g. price and status badges.
  renderMeta?: (option: T) => React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [keyword, setKeyword] = React.useState("")
  // Results are stored together with the keyword they belong to, so "still
  // loading" is derived (results are stale) instead of tracked in its own state.
  const [result, setResult] = React.useState<{
    keyword: string
    options: T[]
  } | null>(null)
  // Remembered separately from the result list: the picked product drops out of
  // it as soon as the search term changes, but its label must stay on the
  // trigger button.
  const [picked, setPicked] = React.useState<T | null>(null)

  // Debounce the search so typing does not queue one action per keystroke
  // (Server Actions are dispatched sequentially per client).
  //
  // `search` is a dependency, so a caller that builds it inline must memoize it
  // -- an unstable one restarts the debounce on every render of the parent form,
  // which is every keystroke in any other field.
  React.useEffect(() => {
    if (!open) return

    let active = true
    const timer = setTimeout(async () => {
      const response = await search(keyword)
      if (!active) return
      if (!response.success) {
        toast.error(response.error ?? "Failed to search products")
      }
      setResult({ keyword, options: response.data ?? [] })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [open, keyword, search])

  const options = result?.options ?? []
  const isLoading = result?.keyword !== keyword
  const selected =
    picked && String(picked.id) === value
      ? picked
      : (options.find((option) => String(option.id) === value) ?? null)

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
            {selected ? productPickerLabel(selected) : placeholder}
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
            placeholder={searchPlaceholder}
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
              <CommandEmpty>{emptyText}</CommandEmpty>
            )}
            {options.map((option) => (
              <CommandItem
                key={option.id}
                value={String(option.id)}
                onSelect={() => {
                  setPicked(option)
                  onSelect(option)
                  setOpen(false)
                }}
              >
                {option.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={option.image_url}
                    alt={option.name ?? option.sku}
                    className="size-7 rounded object-cover"
                  />
                ) : (
                  <div className="flex size-7 items-center justify-center rounded bg-muted text-muted-foreground">
                    <ImageOff className="size-3.5" />
                  </div>
                )}
                <span className="min-w-0 flex-1 truncate">
                  {productPickerLabel(option)}
                </span>
                {renderMeta?.(option)}
                <Check
                  className={cn(
                    "ml-auto",
                    String(option.id) === value ? "opacity-100" : "opacity-0"
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
