"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  MessageSquareWarning,
  PackageCheck,
  ScanLine,
  TriangleAlert,
} from "lucide-react"
import { toast } from "sonner"

import { useConfirm } from "@/components/providers/confirm-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form"
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

import { DispatchItemsList } from "./dispatch-items-list"

/**
 * Two-digit year + six upper-case hex digits (format_invoice_number). A scan of
 * that shape is the packing slip, not the label, and must never be saved as a
 * tracking number.
 */
const INVOICE_PATTERN = /^[0-9A-F]{8}$/i

/**
 * Pick and pack as one step: confirm where each item comes from, scan the
 * label, dispatch. xpros' item-by-item barcode check is left out on purpose
 * (user decision, 2026-11-14).
 *
 * The tracking input is focused on load, like the search page's: the scanner
 * types into it and its trailing Enter submits the form (user decision,
 * 2026-11-25 -- the document-level listener it replaces missed scans whose keys
 * arrived more than 50ms apart). Every check a scan needs runs on submit, so a
 * scan, a typed number and the Dispatch button all take the same path.
 *
 * Afterwards the page returns to the search, not to the next order in the
 * queue: the operator opens the order for the parcel actually in front of them.
 */
export function DispatchOrderClient({
  order,
  items,
  stock,
  locations,
  missingPlatformOrderId,
}: {
  order: OrderDetail
  items: DispatchItem[]
  stock: Record<number, ProductStockLine[]>
  locations: LocationOption[]
  missingPlatformOrderId: boolean
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

  // An existing number (Aramex writes one when it books) is prefilled and
  // selected, so scanning the label overwrites it and pressing Enter keeps it.
  const existingTracking = order.tracking_number?.trim() || null
  const [busy, setBusy] = React.useState(false)

  const form = useForm<TrackingFormValues>({
    resolver: zodResolver(trackingFormSchema),
    defaultValues: { tracking_number: existingTracking ?? "" },
  })

  /** Back to the input with its text selected, ready for the next scan. */
  function rearm(value?: string) {
    if (value !== undefined) form.setValue("tracking_number", value)
    // After the toast or the confirm box has given focus back.
    requestAnimationFrame(() => form.setFocus("tracking_number", { shouldSelect: true }))
  }

  const unresolved = items.filter((item) => item.product_id === null).length
  const dispatchPicks = toDispatchPicks(items, picks)
  const blockers = [
    unresolved > 0 &&
      `${unresolved} ${unresolved === 1 ? "item has" : "items have"} an unresolved SKU.`,
    unresolved === 0 && dispatchPicks === null && "Choose a location for every item.",
    shortages.length > 0 && "Not enough stock at the chosen location. Fix the stock or pick another location.",
  ].filter((reason): reason is string => Boolean(reason))

  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0)
  const customer = order.customers
  const shipping = displayShippingMethod(order)

  async function submit(values: TrackingFormValues) {
    if (isPending || busy) return
    const value = values.tracking_number
    const keepsExisting = existingTracking !== null && value === existingTracking

    // Some historical orders carry their invoice number as the tracking number
    // (rule 27), so only a newly entered value is checked against the pattern.
    if (!keepsExisting && INVOICE_PATTERN.test(value)) {
      if (value.toUpperCase() === order.invoice_number.toUpperCase()) {
        toast.message("This order is already open", { description: "Now scan the tracking number on the label." })
      } else {
        toast.warning(`That is invoice ${value.toUpperCase()}, not a tracking number`, {
          action: { label: "Open it", onClick: () => router.push(`/fulfillment/dispatch?q=${encodeURIComponent(value)}`) },
        })
      }
      rearm(existingTracking ?? "")
      return
    }

    // A label that was booked through Aramex already carries its number. The
    // scan is a raw barcode that may wrap the stored article id, so "contains"
    // is the same parcel; anything else is a different label.
    if (existingTracking && !value.toUpperCase().includes(existingTracking.toUpperCase())) {
      setBusy(true)
      const replace = await confirm({
        title: "Replace the tracking number?",
        description: `This order already has ${existingTracking}. The scanned label reads ${value}.`,
        confirmText: "Use the scanned number",
      })
      setBusy(false)
      if (!replace) {
        rearm(existingTracking)
        return
      }
    }

    if (blockers.length > 0 || dispatchPicks === null) {
      toast.warning("Tracking number captured — not ready to dispatch", { description: blockers[0] })
      return
    }
    void run(value, dispatchPicks)
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
      if (result.data?.syncWarning) toast.warning(result.data.syncWarning)
      router.push("/fulfillment/dispatch")
    })
  }

  const trackingValue = useWatch({ control: form.control, name: "tracking_number" })?.trim() ?? ""

  return (
    <div className="flex flex-col gap-4">
      {/* Order and destination */}
      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-foreground">
            {order.invoice_number}
          </h1>
          <Badge variant="outline" className="text-sm">
            {SALES_PLATFORM_LABELS[order.platform]}
          </Badge>
          <Badge variant={shipping.isEmpty ? "warning" : "info"} className="text-sm">
            {shipping.label}
          </Badge>
          <Link
            href={`/orders/${order.id}`}
            className="ml-auto inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Open order <ExternalLink className="size-3.5" />
          </Link>
        </div>

        {customer ? (
          <div className="flex flex-col gap-0.5 text-base">
            <p className="text-lg font-medium text-foreground">{customer.full_name}</p>
            {customer.company_name ? <p className="text-foreground">{customer.company_name}</p> : null}
            {usableAddressLines(customer).map((line) => (
              <p key={line} className="text-muted-foreground">
                {line}
              </p>
            ))}
            <p className="text-muted-foreground">
              {[customer.city, customer.state, customer.postcode].filter(Boolean).join(" ")}
            </p>
          </div>
        ) : null}
      </section>

      {/* A warning, not a blocker (user decision, 2026-11-18): the parcel can
          still go, but nobody would otherwise learn the platform was never told. */}
      {missingPlatformOrderId ? (
        <section className="flex flex-col gap-1 rounded-2xl border border-warning/60 bg-warning/10 p-5">
          <p className="flex items-center gap-2 text-base font-medium text-foreground">
            <TriangleAlert className="size-5" />
            Tracking will not be sent to {SALES_PLATFORM_LABELS[order.platform]}
          </p>
          <p className="text-sm text-muted-foreground">
            None of this order&apos;s lines carries the {SALES_PLATFORM_LABELS[order.platform]} order
            number, usually because a line was deleted and added again. You can still dispatch it,
            but enter the tracking number in {SALES_PLATFORM_LABELS[order.platform]} by hand.
          </p>
        </section>
      ) : null}

      {/* Shown, not gated: go2office does not make the packer acknowledge the
          note before dispatching (user decision, 2026-11-18). */}
      {note ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-warning/60 bg-warning/10 p-5">
          <p className="flex items-center gap-2 text-base font-medium text-foreground">
            <MessageSquareWarning className="size-5" />
            Customer note
          </p>
          <p className="text-base whitespace-pre-wrap text-foreground">{note}</p>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Items · {totalUnits} {totalUnits === 1 ? "unit" : "units"}
        </h2>
        <DispatchItemsList
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
      </section>

      {/* Pinned to the bottom of the screen: the scan and the button are the
          two things the operator needs whatever they scrolled to. */}
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(submit)}
          className="sticky bottom-0 z-10 -mx-1 flex flex-col gap-3 rounded-t-2xl border border-b-0 border-border bg-background/95 p-4 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)] backdrop-blur supports-[backdrop-filter]:bg-background/80"
        >
          <div className="flex items-center gap-2 text-sm">
            {trackingValue ? (
              <>
                <CheckCircle2 className="size-4 text-success-foreground" />
                <span className="text-muted-foreground">
                  {trackingValue === existingTracking
                    ? "Tracking number recorded when the label was booked"
                    : "Tracking number captured"}
                </span>
              </>
            ) : (
              <>
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
                </span>
                <span className="font-medium text-foreground">Ready — scan the tracking label</span>
                <span className="text-muted-foreground">or type it and press Enter</span>
              </>
            )}
          </div>

          <FormField
            control={form.control}
            name="tracking_number"
            render={({ field }) => (
              <FormItem>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <ScanLine className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
                    <FormControl>
                      <Input
                        {...field}
                        autoFocus
                        // Selected on focus, so a scan replaces what is there
                        // instead of appending to it.
                        onFocus={(event) => event.currentTarget.select()}
                        placeholder="Tracking number"
                        aria-label="Tracking number"
                        autoComplete="off"
                        className="h-12 rounded-xl pl-12 font-mono text-lg md:text-lg"
                      />
                    </FormControl>
                  </div>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {blockers.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm text-warning-foreground">
              {blockers.map((reason) => (
                <li key={reason} className="flex items-start gap-1.5">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}

          <Button
            type="submit"
            size="lg"
            className="h-14 w-full rounded-xl text-lg"
            disabled={isPending || blockers.length > 0}
          >
            {isPending ? <Loader2 className="size-5 animate-spin" /> : <PackageCheck className="size-5" />}
            Dispatch
          </Button>
        </form>
      </Form>
    </div>
  )
}
