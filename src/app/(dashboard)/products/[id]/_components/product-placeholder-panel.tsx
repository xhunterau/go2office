import type { LucideIcon } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"

// Empty state for the Stock and Kit Components tabs. Both domains get their own
// tables and actions in a later iteration; the tabs exist now so the detail
// page's information architecture is settled and does not have to be reshuffled
// when they land.
export function ProductPlaceholderPanel({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </div>
        <div className="grid gap-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="max-w-md text-sm text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  )
}
