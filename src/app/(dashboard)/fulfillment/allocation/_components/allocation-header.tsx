import Link from "next/link"
import { ArrowLeft, MapPin, Truck } from "lucide-react"

import { cn } from "@/lib/utils"

export type AllocationStage = "address" | "postage"

const STAGES: { key: AllocationStage; label: string; href: string; icon: typeof MapPin }[] = [
  { key: "address", label: "Address", href: "/fulfillment/allocation/address", icon: MapPin },
  { key: "postage", label: "Postage", href: "/fulfillment/allocation/postage", icon: Truck },
]

/**
 * The header every allocation page shares: where you are, one line on what the
 * page is for, and the two stages as tabs so moving between them does not need
 * a trip back to the overview.
 */
export function AllocationHeader({
  title,
  description,
  active,
  counts,
}: {
  title: string
  description: React.ReactNode
  /** The stage this page is; null on the overview, which has no back link. */
  active: AllocationStage | null
  /** Null when the counts could not be loaded: the tabs still navigate. */
  counts: Record<AllocationStage, number> | null
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        {active ? (
          <Link
            href="/fulfillment/allocation"
            className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Order Allocation
          </Link>
        ) : null}
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>

      {active ? (
        <nav className="flex w-fit gap-1 rounded-lg bg-muted p-1" aria-label="Allocation stages">
          {STAGES.map((stage) => {
            const current = stage.key === active
            const count = counts?.[stage.key]
            return (
              <Link
                key={stage.key}
                href={stage.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  current
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <stage.icon className="size-3.5" />
                {stage.label}
                {count != null ? (
                  <span
                    className={cn(
                      "min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums",
                      current ? "bg-primary text-primary-foreground" : "bg-background/70"
                    )}
                  >
                    {count}
                  </span>
                ) : null}
              </Link>
            )
          })}
        </nav>
      ) : null}
    </div>
  )
}

/** The page-level load failure, said the same way on every stage. */
export function QueueLoadError({ what, message }: { what: string; message: string }) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <p className="font-medium text-foreground">The {what} queue could not be loaded.</p>
      <p className="mt-1 text-muted-foreground">{message}</p>
    </div>
  )
}
