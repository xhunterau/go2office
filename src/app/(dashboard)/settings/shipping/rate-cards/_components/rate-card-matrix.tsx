"use client"

import * as React from "react"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { formatMoney } from "@/lib/format"
import type {
  CarrierServiceRow,
  CarrierZoneRateRow,
} from "@/lib/queries/shipping-reference"
import { rateKey } from "@/lib/queries/shipping-reference"
import { deleteCarrierService } from "@/lib/actions/rate-card"
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
import { ServiceFormDialog } from "./service-form-dialog"
import { ZoneRateDialog } from "./zone-rate-dialog"

export function RateCardMatrix({
  services,
  zones,
  rates,
}: {
  services: CarrierServiceRow[]
  zones: string[]
  // A Map cannot cross the server/client boundary; the page hands over entries.
  rates: [string, CarrierZoneRateRow][]
}) {
  const confirm = useConfirm()
  const rateByKey = React.useMemo(() => new Map(rates), [rates])
  const [isPending, startTransition] = React.useTransition()
  const [editingService, setEditingService] =
    React.useState<CarrierServiceRow | null>(null)
  const [serviceDialogOpen, setServiceDialogOpen] = React.useState(false)
  const [editingCell, setEditingCell] = React.useState<{
    service: CarrierServiceRow
    zone: string
    rate: CarrierZoneRateRow | null
  } | null>(null)

  async function handleDeleteService(service: CarrierServiceRow) {
    const priced = zones.filter((zone) =>
      rateByKey.has(rateKey(service.id, zone))
    ).length

    const ok = await confirm({
      title: "Delete weight tier",
      // The FK is ON DELETE CASCADE, so the database will not stop this and
      // will not say how much goes with it.
      description: `Delete ${service.service_type} ${service.size_label}? Its ${priced} zone rate${priced === 1 ? "" : "s"} are deleted with it, and any shipping method priced through this tier stops being quoted.`,
      confirmText: "Delete tier",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    startTransition(async () => {
      const result = await deleteCarrierService(service.id)
      if (result.success) toast.success("Weight tier deleted")
      else toast.error(result.error ?? "Something went wrong")
    })
  }

  if (services.length === 0) {
    return (
      <div className="rounded-xl border border-border p-6 text-sm text-muted-foreground">
        This carrier has no weight tiers. It is priced by its own API or by a
        fixed price on the dispatch option — or its rate card has not been set up
        yet.
      </div>
    )
  }

  if (zones.length === 0) {
    return (
      <div className="rounded-xl border border-border p-6 text-sm text-muted-foreground">
        This carrier has no delivery zones mapped, so there are no columns to
        price. Zones come from the postcode mapping.
      </div>
    )
  }

  // Grouped so the card reads as its two halves rather than one long ladder.
  const groups = [...new Set(services.map((service) => service.service_type))]

  return (
    <>
      <div className="flex flex-col gap-6">
        {groups.map((serviceType) => (
          <section key={serviceType} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              {serviceType}
            </h2>
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-56">Tier</TableHead>
                    {zones.map((zone) => (
                      <TableHead key={zone} className="text-right whitespace-nowrap">
                        {zone.replace(/_/g, " ")}
                      </TableHead>
                    ))}
                    <TableHead className="w-12 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services
                    .filter((service) => service.service_type === serviceType)
                    .map((service) => (
                      <TableRow key={service.id}>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">
                              {service.size_label}
                            </span>
                            {/* Null max_weight is the per-kg overflow tier: it
                                applies above every fixed tier, and it prices
                                from base + per kg rather than a flat rate. */}
                            {service.max_weight === null ? (
                              <Badge variant="info">Per kg</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground tabular-nums">
                                up to {service.max_weight} kg
                              </span>
                            )}
                          </div>
                        </TableCell>

                        {zones.map((zone) => {
                          const rate =
                            rateByKey.get(rateKey(service.id, zone)) ?? null
                          return (
                            <TableCell key={zone} className="p-0 text-right">
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingCell({ service, zone, rate })
                                }
                                className={cn(
                                  "h-11 w-full px-3 text-right text-sm tabular-nums transition-colors hover:bg-accent/60",
                                  !rate && "text-muted-foreground"
                                )}
                              >
                                <CellValue rate={rate} />
                              </button>
                            </TableCell>
                          )
                        })}

                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                aria-label={`Actions for ${service.service_type} ${service.size_label}`}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() => {
                                  setEditingService(service)
                                  setServiceDialogOpen(true)
                                }}
                              >
                                <Pencil />
                                Edit tier
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={isPending}
                                onSelect={(event) => {
                                  event.preventDefault()
                                  void handleDeleteService(service)
                                }}
                              >
                                <Trash2 />
                                Delete tier
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </section>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {/* The distinction that decides whether a quote appears at all. */}
        An empty cell is not a free rate: the tier simply does not serve that
        zone, and the engine skips it. A cell showing $0.00 quotes at zero and
        wins every comparison.
      </p>

      <ServiceFormDialog
        open={serviceDialogOpen}
        onOpenChange={setServiceDialogOpen}
        carrierId={editingService?.carrier_id ?? 0}
        service={editingService}
      />

      <ZoneRateDialog
        open={editingCell !== null}
        onOpenChange={(open: boolean) => {
          if (!open) setEditingCell(null)
        }}
        service={editingCell?.service ?? null}
        zone={editingCell?.zone ?? null}
        rate={editingCell?.rate ?? null}
      />
    </>
  )
}

function CellValue({ rate }: { rate: CarrierZoneRateRow | null }) {
  if (!rate) return <span>—</span>
  if (rate.rate !== null) return <span>{formatMoney(rate.rate)}</span>

  // The per-kg tier: base plus a rate per kilogram, floored at a minimum.
  return (
    <span className="text-xs">
      {formatMoney(rate.base_rate)} + {formatMoney(rate.per_kg_rate)}/kg
      {rate.min_charge !== null && ` · min ${formatMoney(rate.min_charge)}`}
    </span>
  )
}
