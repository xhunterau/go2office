"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { CheckCircle2, Loader2, MessageSquareWarning, PackageCheck, RotateCcw, ScanLine } from "lucide-react"
import { toast } from "sonner"

import { useConfirm } from "@/components/providers/confirm-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { dispatchOrder } from "@/lib/actions/dispatch"
import { usableAddressLines } from "@/lib/fulfillment/csv"
import {
  defaultPicks,
  findShortages,
  toDispatchPicks,
  type DispatchPick,
  type PickChoice,
} from "@/lib/fulfillment/dispatch"
import { displayShippingMethod } from "@/lib/orders/shipping-method"
import { SALES_PLATFORM_LABELS } from "@/lib/orders/status"
import type { DispatchItem } from "@/lib/queries/dispatch"
import type { ProductStockLine } from "@/lib/queries/inventory"
import type { LocationOption } from "@/lib/queries/locations"
import type { OrderDetail } from "@/lib/queries/orders"
import { trackingFormSchema, type TrackingFormValues } from "@/lib/validations/dispatch"

import { DispatchItemsTable } from "./dispatch-items-table"

/**
 * Pick and pack as one step: confirm where each item comes from, enter the
 * tracking number, dispatch. xpros' item-by-item barcode check is left out on
 * purpose (user decision, 2026-11-14).
 *
 * Afterwards the page returns to the search, not to the next order in the
 * queue: the operator opens the order for the parcel actually in front of them.
 */
export function DispatchOrderClient({
  order,
  items,
  stock,
  locations,
}: {
  order: OrderDetail
  items: DispatchItem[]
  stock: Record<number, ProductStockLine[]>
  locations: LocationOption[]
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [isPending, startTransition] = React.useTransition()

  // Only what the operator changed. Everything else follows the defaults, which
  // are recomputed from the current stock -- so after a count in place, a line
  // that had no covering shelf picks one up without being touched.
  const [overrides, setOverrides] = React.useState<Map<number, number>>(() => new Map())
  const stockMap = React.useMemo(
    () => new Map(Object.entries(stock).map(([pid, lines]) => [Number(pid), lines])),
    [stock]
  )
  const picks = React.useMemo<PickChoice>(() => {
    const merged = defaultPicks(items, stockMap)
    for (const [itemId, locationId] of overrides) merged.set(itemId, locationId)
    return merged
  }, [items, stockMap, overrides])
  const shortages = React.useMemo(
    () => findShortages(items, picks, stockMap),
    [items, picks, stockMap]
  )

  const note = order.comments?.trim() || null
  const [noteRead, setNoteRead] = React.useState(note === null)

  // An existing number (Aramex writes one when it books) is shown locked; the
  // operator unlocks it only to replace it.
  const existingTracking = order.tracking_number?.trim() || null
  const [editingTracking, setEditingTracking] = React.useState(existingTracking === null)
  const trackingRef = React.useRef<HTMLInputElement | null>(null)

  const form = useForm<TrackingFormValues>({
    resolver: zodResolver(trackingFormSchema),
    defaultValues: { tracking_number: existingTracking ?? "" },
  })

  function startReentry() {
    setEditingTracking(true)
    // After the input has become editable, so the selection sticks.
    requestAnimationFrame(() => {
      trackingRef.current?.focus()
      trackingRef.current?.select()
    })
  }

  const unresolved = items.filter((item) => item.product_id === null).length
  const dispatchPicks = toDispatchPicks(items, picks)
  const blockers = [
    unresolved > 0 &&
      `${unresolved} ${unresolved === 1 ? "item has" : "items have"} an unresolved SKU.`,
    unresolved === 0 && dispatchPicks === null && "Choose a location for every item.",
    shortages.length > 0 && "Not enough stock at the chosen location. Fix the stock or pick another location.",
    !noteRead && "Read the customer note first.",
  ].filter((reason): reason is string => Boolean(reason))

  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0)
  const customer = order.customers
  const shipping = displayShippingMethod(order)

  function submit(values: TrackingFormValues) {
    if (blockers.length > 0 || dispatchPicks === null) return
    void run(values.tracking_number, dispatchPicks)
  }

  async function run(trackingNumber: string, picksToSend: DispatchPick[]) {
    const ok = await confirm({
      title: `Dispatch ${order.invoice_number}?`,
      description: `${totalUnits} ${totalUnits === 1 ? "unit comes" : "units come"} out of stock and the order is completed with tracking number ${trackingNumber}.`,
      confirmText: "Dispatch",
    })
    if (!ok) return

    startTransition(async () => {
      let result = await dispatchOrder({
        order_id: order.id,
        tracking_number: trackingNumber,
        picks: picksToSend,
      })

      if (!result.success && result.data?.sharedWith !== undefined) {
        const share = await confirm({
          title: "Tracking number already used",
          description: `${trackingNumber} is already on order ${result.data.sharedWith}. Use it here only if both orders went out in the same parcel.`,
          confirmText: "Same parcel, use it",
          variant: "destructive",
        })
        if (!share) return
        result = await dispatchOrder({
          order_id: order.id,
          tracking_number: trackingNumber,
          picks: picksToSend,
          allow_shared_tracking: true,
        })
      }

      if (!result.success) {
        toast.error("Not dispatched", { description: result.error })
        // Stock or items may have moved under the page; show the current state.
        router.refresh()
        return
      }

      toast.success(`${order.invoice_number} dispatched`, {
        description: `Tracking number ${result.data?.trackingNumber ?? trackingNumber}`,
      })
      router.push("/fulfillment/dispatch")
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-mono text-lg font-semibold text-foreground">{order.invoice_number}</h1>
        <Badge variant="outline">{SALES_PLATFORM_LABELS[order.platform]}</Badge>
        <Badge variant={shipping.isEmpty ? "warning" : "info"}>{shipping.label}</Badge>
        <Link
          href={`/orders/${order.id}`}
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Open order
        </Link>
      </div>

      {customer ? (
        <div className="rounded-xl border border-border p-4 text-sm">
          <p className="font-medium text-foreground">{customer.full_name}</p>
          {customer.company_name ? <p>{customer.company_name}</p> : null}
          {usableAddressLines(customer).map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p>{[customer.city, customer.state, customer.postcode].filter(Boolean).join(" ")}</p>
        </div>
      ) : null}

      {note ? (
        <div className="flex flex-col gap-3 rounded-xl border border-warning/60 bg-warning/10 p-4 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <MessageSquareWarning className="size-4" />
            Customer note
          </p>
          <p className="whitespace-pre-wrap text-foreground">{note}</p>
          {noteRead ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-success-foreground" />
              Note read
            </p>
          ) : (
            <Button
              size="sm"
              className="self-start"
              onClick={() => {
                setNoteRead(true)
                // Straight on to the scan, as on a page with no note.
                requestAnimationFrame(() => trackingRef.current?.focus())
              }}
            >
              I have read the note
            </Button>
          )}
        </div>
      ) : null}

      <DispatchItemsTable
        orderId={order.id}
        items={items}
        stock={stock}
        picks={picks}
        shortages={shortages}
        locations={locations}
        onPick={(itemId, locationId) =>
          setOverrides((current) => new Map(current).set(itemId, locationId))
        }
      />

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(submit)}
          className="flex flex-col gap-3 rounded-xl border border-border p-4"
        >
          <FormField
            control={form.control}
            name="tracking_number"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1.5">
                  <ScanLine className="size-4" />
                  Tracking number
                </FormLabel>
                <div className="flex max-w-xl gap-2">
                  <FormControl>
                    <Input
                      {...field}
                      ref={(element) => {
                        field.ref(element)
                        trackingRef.current = element
                      }}
                      autoFocus={editingTracking && noteRead}
                      readOnly={!editingTracking}
                      placeholder="Scan or type the tracking number"
                      autoComplete="off"
                      className="font-mono"
                    />
                  </FormControl>
                  {editingTracking ? null : (
                    <Button type="button" variant="outline" onClick={startReentry}>
                      <RotateCcw className="size-4" />
                      Re-enter
                    </Button>
                  )}
                </div>
                {editingTracking ? (
                  <FormDescription>
                    A full barcode scan is fine; it is trimmed to the carrier&apos;s number when saved.
                  </FormDescription>
                ) : (
                  <FormDescription>Recorded when the label was booked.</FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          {blockers.length > 0 ? (
            <ul className="flex flex-col gap-1 text-xs text-warning-foreground">
              {blockers.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}

          <Button
            type="submit"
            className="self-start"
            disabled={isPending || blockers.length > 0}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PackageCheck className="size-4" />
            )}
            Dispatch
          </Button>
        </form>
      </Form>
    </div>
  )
}
