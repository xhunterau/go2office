"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export function RefreshButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCw className={cn("size-4", pending && "animate-spin")} />
      Refresh
    </Button>
  )
}
