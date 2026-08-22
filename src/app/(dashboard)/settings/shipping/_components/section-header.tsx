import Link from "next/link"
import { ChevronLeft } from "lucide-react"

// The sidebar stops at "Shipping", so every child page carries its own way back
// to the hub rather than relying on the browser's.
export function ShippingSectionHeader({
  title,
  description,
  action,
}: {
  title: string
  description: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <Link
        href="/settings/shipping"
        className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" />
        Shipping
      </Link>
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          <div className="max-w-3xl text-sm text-muted-foreground">
            {description}
          </div>
        </div>
        {action}
      </div>
    </div>
  )
}
