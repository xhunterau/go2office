"use client"

import { Copy } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"

/**
 * Copies one short value to the clipboard.
 *
 * A plain button rather than a menu item: an invoice number or a tracking
 * number is copied constantly and often in a hurry, and burying it two clicks
 * deep in a `⋯` menu made it slower than selecting the text by hand.
 */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string
  /** What the button copies, for the tooltip and the screen reader. */
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={() => void copyToClipboard(value)}
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        className
      )}
    >
      <Copy className="size-3.5" />
    </button>
  )
}

/**
 * Copies a value and reports the outcome, for the places that need the action
 * without this button -- a dropdown item, say.
 */
export async function copyToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`Copied ${value}`)
  } catch {
    // Clipboard access is denied outside a secure context and in some embedded
    // browsers. Failing silently would look like the click missed.
    toast.error("Could not copy to the clipboard")
  }
}
