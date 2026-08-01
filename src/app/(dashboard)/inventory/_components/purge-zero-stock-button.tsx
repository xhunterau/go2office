"use client"

import * as React from "react"
import { Eraser } from "lucide-react"
import { toast } from "sonner"

import { purgeZeroStockLevels } from "@/lib/actions/inventory"
import { useConfirm } from "@/components/providers/confirm-provider"
import { Button } from "@/components/ui/button"

export function PurgeZeroStockButton({ count }: { count: number }) {
  const confirm = useConfirm()
  const [isPending, startTransition] = React.useTransition()

  async function handleClick() {
    const ok = await confirm({
      title: "Clear zero-stock rows",
      description: `Delete ${count} stock row${
        count === 1 ? "" : "s"
      } sitting at zero? These hold no units — they only record that a product once belonged in a location, and they stop that location from being deleted. Receiving stock creates the row again, and the movement history is untouched.`,
      confirmText: "Clear rows",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await purgeZeroStockLevels()
      if (result.success) {
        const deleted = result.data ?? 0
        toast.success(
          `Cleared ${deleted} zero-stock row${deleted === 1 ? "" : "s"}`
        )
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })
  }

  return (
    <Button
      variant="outline"
      onClick={handleClick}
      // Nothing to clear is the normal steady state, so the button stays
      // visible (and explains itself) rather than disappearing from the header.
      disabled={count === 0 || isPending}
    >
      <Eraser />
      {count === 0 ? "No Zero Rows" : `Clear Zero Rows (${count})`}
    </Button>
  )
}
