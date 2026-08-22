"use client"

import * as React from "react"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { formatMoney } from "@/lib/format"
import { SHIPPING_METHOD_LABELS } from "@/lib/orders/shipping-method"
import type {
  CarrierRow,
  DispatchOptionWithCarrier,
} from "@/lib/queries/shipping-reference"
import { deleteDispatchOption } from "@/lib/actions/dispatch-option"
import { useConfirm } from "@/components/providers/confirm-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { DispatchOptionFormDialog } from "./dispatch-option-form-dialog"

const COLUMN_COUNT = 7

export function DispatchOptionsTable({
  rows,
  carriers,
  serviceTypes,
  usedMethods,
}: {
  rows: DispatchOptionWithCarrier[]
  carriers: CarrierRow[]
  serviceTypes: [number, string[]][]
  usedMethods: string[]
}) {
  const confirm = useConfirm()
  const [isPending, startTransition] = React.useTransition()
  const [editing, setEditing] = React.useState<DispatchOptionWithCarrier | null>(
    null
  )
  const [dialogOpen, setDialogOpen] = React.useState(false)

  async function handleDelete(row: DispatchOptionWithCarrier) {
    const ok = await confirm({
      title: "Delete dispatch option",
      description: `Delete the option for ${SHIPPING_METHOD_LABELS[row.shipping_method]}? This method stops appearing in quotes entirely. If you only want it out of quoting for now, switch it off instead — that is reversible and keeps the limits you have set.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await deleteDispatchOption(row.id)
      if (result.success) toast.success("Dispatch option deleted")
      else toast.error(result.error ?? "Something went wrong")
    })
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Shipping method</TableHead>
              <TableHead className="w-40">Carrier</TableHead>
              <TableHead className="w-28">Service</TableHead>
              <TableHead className="w-32">Billed on</TableHead>
              <TableHead className="w-28 text-right">Fixed price</TableHead>
              <TableHead className="w-56">Limits</TableHead>
              <TableHead className="w-12 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMN_COUNT}
                  className="h-24 text-center text-muted-foreground"
                >
                  No dispatch options yet — nothing is being quoted.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  // Inactive rows are dimmed rather than hidden: an option that
                  // is off is exactly what someone comes here to find.
                  className={cn(!row.is_active && "opacity-55")}
                >
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">
                        {SHIPPING_METHOD_LABELS[row.shipping_method]}
                      </span>
                      {!row.is_active && <Badge variant="secondary">Off</Badge>}
                      {row.fixed_price_aud !== null && (
                        <Badge variant="info">Fixed price</Badge>
                      )}
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {row.shipping_method}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.carrier ? (
                      <span
                        className={cn(
                          !row.carrier.is_active && "text-muted-foreground"
                        )}
                      >
                        {row.carrier.name}
                        {!row.carrier.is_active && " (inactive)"}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {row.service_type ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.billing_weight_mode === "actual"
                      ? "Actual weight"
                      : "Chargeable weight"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.fixed_price_aud === null
                      ? "—"
                      : formatMoney(row.fixed_price_aud)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <LimitSummary row={row} />
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Actions for ${row.shipping_method}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditing(row)
                            setDialogOpen(true)
                          }}
                        >
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={isPending}
                          onSelect={(event) => {
                            event.preventDefault()
                            void handleDelete(row)
                          }}
                        >
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DispatchOptionFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        option={editing}
        carriers={carriers}
        serviceTypes={serviceTypes}
        usedMethods={usedMethods}
      />
    </>
  )
}

// The four ceilings, written out only where they are set. An empty cell means
// this option has no limit of its own beyond the carrier's own capabilities.
function LimitSummary({ row }: { row: DispatchOptionWithCarrier }) {
  const parts: string[] = []
  if (row.max_order_total_aud !== null) {
    parts.push(`order ≤ ${formatMoney(row.max_order_total_aud)}`)
  }
  if (row.max_packed_length_mm !== null) {
    parts.push(`L ≤ ${row.max_packed_length_mm}mm`)
  }
  if (row.max_packed_width_mm !== null) {
    parts.push(`W ≤ ${row.max_packed_width_mm}mm`)
  }
  if (row.max_packed_thickness_mm !== null) {
    parts.push(`thickness ≤ ${row.max_packed_thickness_mm}mm`)
  }

  if (parts.length === 0) return <span>No extra limits</span>
  return <span>{parts.join(" · ")}</span>
}
