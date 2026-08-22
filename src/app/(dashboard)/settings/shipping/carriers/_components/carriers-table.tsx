"use client"

import * as React from "react"
import { Pencil } from "lucide-react"

import type { CarrierRow, CarrierUsage } from "@/lib/queries/shipping-reference"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CarrierFormDialog } from "./carrier-form-dialog"

const numberFormatter = new Intl.NumberFormat("en-AU")

const COLUMN_COUNT = 6

export function CarriersTable({
  rows,
  usage,
}: {
  rows: CarrierRow[]
  // A Map cannot cross the server/client boundary, so the page hands over its
  // entries and it is rebuilt here.
  usage: [number, CarrierUsage][]
}) {
  const usageById = React.useMemo(() => new Map(usage), [usage])
  const [editing, setEditing] = React.useState<CarrierRow | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Carrier</TableHead>
              <TableHead className="w-28">Code</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-40">Quoted methods</TableHead>
              <TableHead className="w-32 text-right">Weight tiers</TableHead>
              <TableHead className="w-32 text-right">Zone rows</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMN_COUNT}
                  className="h-24 text-center text-muted-foreground"
                >
                  No carriers found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const stats = usageById.get(row.id)
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{row.name}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Edit ${row.name}`}
                          onClick={() => {
                            setEditing(row)
                            setDialogOpen(true)
                          }}
                        >
                          <Pencil />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{row.code}</TableCell>
                    <TableCell>
                      <Badge variant={row.is_active ? "success" : "secondary"}>
                        {row.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    {/* Active dispatch options, not the raw total: a carrier
                        whose every option is switched off is not being quoted,
                        whatever its own status says. */}
                    <TableCell className="text-sm text-muted-foreground">
                      {stats
                        ? `${stats.activeDispatchOptionCount} of ${stats.dispatchOptionCount}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {stats ? numberFormatter.format(stats.serviceCount) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {stats ? numberFormatter.format(stats.zoneCount) : "—"}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <CarrierFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        carrier={editing}
      />
    </>
  )
}
