"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react"
import { toast } from "sonner"

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
import { Label } from "@/components/ui/label"
import { useConfirm } from "@/components/providers/confirm-provider"
import {
  AddressAutocomplete,
  type AddressParts,
} from "@/components/orders/address-autocomplete"
import {
  checkAddressResolution,
  saveAddressAndVerify,
  verifyAddressWithoutChanges,
  type AddressResolution,
} from "@/lib/actions/allocation"
import type { AddressStageOrder } from "@/lib/queries/allocation"
import {
  allocationAddressSchema,
  type AllocationAddressInput,
} from "@/lib/validations/allocation"
import { SALES_PLATFORM_LABELS } from "@/lib/orders/status"
import { formatDate } from "@/lib/format"

export function AddressOrderCard({
  order,
  searchEnabled,
}: {
  order: AddressStageOrder
  searchEnabled: boolean
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const customer = order.customer

  const [isSaving, startSave] = React.useTransition()
  const [isPassing, startPass] = React.useTransition()
  const [isChecking, setIsChecking] = React.useState(false)

  // Seeded from the server rather than fetched on mount: being in this queue is
  // itself the answer to "does it resolve", and the localities for the order's
  // postcode came down with the row.
  const [resolution, setResolution] = React.useState<AddressResolution>({
    resolved: false,
    localities: order.knownLocalities,
  })

  const form = useForm<AllocationAddressInput>({
    resolver: zodResolver(allocationAddressSchema),
    defaultValues: {
      address_line1: customer?.address_line1 ?? "",
      address_line2: customer?.address_line2 ?? "",
      city: customer?.city ?? "",
      postcode: customer?.postcode ?? "",
    },
  })

  const busy = isSaving || isPassing

  async function refreshResolution() {
    const postcode = form.getValues("postcode")
    const city = form.getValues("city")
    if (!postcode?.trim() || !city?.trim()) return

    setIsChecking(true)
    const result = await checkAddressResolution(postcode, city)
    setIsChecking(false)
    if (result.success && result.data) setResolution(result.data)
  }

  function applyPlace(parts: AddressParts) {
    if (parts.country && parts.country !== "AU") {
      toast.error("That address is not in Australia", {
        description:
          "Allocation only handles Australian addresses. Handle this order from the order page instead.",
      })
      return
    }

    form.setValue("address_line1", parts.address_line1, { shouldDirty: true })
    form.setValue("city", parts.city, { shouldDirty: true })
    if (parts.postcode) {
      form.setValue("postcode", parts.postcode, { shouldDirty: true })
    }
    void refreshResolution()
  }

  async function confirmUnresolved(): Promise<boolean> {
    if (resolution.resolved) return true

    return confirm({
      title: "This suburb and postcode still do not match",
      description:
        "Nothing in the postcode reference matches this pair, so the shipping quote will most likely come back with no zone and no price. Pass it anyway only if you know the address is right — otherwise fix the suburb, or add the missing row under Settings → Postcodes.",
      confirmText: "Pass anyway",
      cancelText: "Keep editing",
    })
  }

  // The confirm MUST be awaited outside the transition, and this is why:
  // useConfirm opens the dialog by setting state in the provider. React defers
  // committing a state update made inside an async transition until that
  // action settles -- and this action settles only when someone answers the
  // dialog that has not been committed. The dialog never appears and the
  // button spins forever. Same shape as country-form-dialog.tsx, which awaits
  // first and calls its transition afterwards.
  async function onSubmit(values: AllocationAddressInput) {
    if (!(await confirmUnresolved())) return

    startSave(async () => {
      const result = await saveAddressAndVerify(order.id, values)
      if (!result.success || !result.data) {
        toast.error("The address could not be saved", { description: result.error })
        return
      }

      toast.success(`${order.invoice_number} passed to Postage`, {
        description: result.data.resolved
          ? "Address saved and matched to the postcode reference."
          : "Address saved. It still does not match the postcode reference, so the quote may come back empty.",
      })
      if (result.data.warning) toast.warning(result.data.warning)
      router.refresh()
    })
  }

  /** Same ordering rule as onSubmit above: confirm first, transition after. */
  async function handlePassUnchanged() {
    if (!(await confirmUnresolved())) return

    startPass(async () => {
      const result = await verifyAddressWithoutChanges(order.id)
      if (!result.success) {
        toast.error("The order could not be passed", { description: result.error })
        return
      }
      toast.success(`${order.invoice_number} passed to Postage`, {
        description: "The address was left exactly as it is.",
      })
      if (result.data?.warning) toast.warning(result.data.warning)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          href={`/orders/${order.id}`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {order.invoice_number}
        </Link>
        <span className="text-sm text-muted-foreground">
          {customer?.full_name?.trim() || "No name on file"}
        </span>
        <Badge variant="secondary">{SALES_PLATFORM_LABELS[order.platform]}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {formatDate(order.posted_on_date ?? order.created_at)}
        </span>
      </div>

      <div className="rounded-lg bg-muted/40 p-3 text-sm">
        <p className="text-xs font-medium text-muted-foreground">On file now</p>
        <p className="mt-1 text-foreground">
          {[
            customer?.address_line1,
            customer?.address_line2,
            customer?.city,
            customer?.state,
            customer?.postcode,
          ]
            .filter((part) => part?.trim())
            .join(", ") || "No address"}
        </p>
        {/* Says which half of the pair is wrong. An unknown postcode and a
            misspelt suburb look identical on the order and are fixed
            differently. */}
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
          {order.knownLocalities.length === 0
            ? `Postcode ${customer?.postcode?.trim() || "—"} is not in the reference at all.`
            : `Postcode ${customer?.postcode?.trim()} is known, but not with the suburb “${customer?.city?.trim() || "—"}”.`}
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {searchEnabled ? (
            <div className="flex flex-col gap-1.5">
              <Label>Search address</Label>
              <AddressAutocomplete onSelect={applyPlace} disabled={busy} />
              <p className="text-xs text-muted-foreground">
                Fills the fields below. Check the suburb afterwards — Google
                returns localities the postcode reference does not always hold.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="address_line1"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Street address</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={busy} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="address_line2"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Address line 2</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} disabled={busy} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="city"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Suburb</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      disabled={busy}
                      onBlur={() => {
                        field.onBlur()
                        void refreshResolution()
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="postcode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Postcode</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode="numeric"
                      disabled={busy}
                      onBlur={() => {
                        field.onBlur()
                        void refreshResolution()
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    {/* The pad is not cosmetic: the reference stores four digits
                        and a three-digit NT postcode never matches. */}
                    Saved padded to four digits, so 800 becomes 0800.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex flex-col gap-1.5">
              <Label className="text-muted-foreground">State</Label>
              <Input value={customer?.state ?? ""} readOnly disabled />
              <p className="text-xs text-muted-foreground">
                {/* CLAUDE.md rule 21: the trigger rewrites this on every save, so
                    an editable box here would be a field that silently ignores
                    what you type. */}
                Derived from the suburb and postcode when you save. To change it,
                edit the row under{" "}
                <Link
                  href="/settings/postcodes"
                  className="underline underline-offset-4"
                >
                  Settings → Postcodes
                </Link>
                .
              </p>
            </div>
          </div>

          <ResolutionNote
            resolution={resolution}
            checking={isChecking}
            onPick={(locality) => {
              form.setValue("city", locality, { shouldDirty: true })
              void refreshResolution()
            }}
          />

          <p className="text-xs text-muted-foreground">
            {/* orders keep no address of their own (docs/orders-ui.md 6.3), and
                an operator fixing one order's label has no reason to expect
                that. */}
            This is the customer&apos;s address, shared by every order they have
            placed — saving it changes their past orders too.
          </p>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void handlePassUnchanged()}
            >
              {isPassing ? <Loader2 className="size-4 animate-spin" /> : null}
              Pass without changes
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save and pass
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}

function ResolutionNote({
  resolution,
  checking,
  onPick,
}: {
  resolution: AddressResolution
  checking: boolean
  onPick: (locality: string) => void
}) {
  if (checking) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Checking the postcode reference…
      </p>
    )
  }

  if (resolution.resolved) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-success-foreground">
        <CheckCircle2 className="size-3.5" />
        Matches the postcode reference — this address will resolve to a delivery
        zone.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <p className="flex items-start gap-1.5 text-xs text-foreground">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
        No match yet. Saving is still allowed, but the shipping quote will
        probably find no zone for this address.
      </p>
      {resolution.localities.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 pl-5">
          <span className="text-xs text-muted-foreground">Known for this postcode:</span>
          {resolution.localities.map((locality) => (
            <button
              key={locality}
              type="button"
              onClick={() => onPick(locality)}
              className="rounded border border-border bg-background px-1.5 py-0.5 text-xs hover:bg-accent"
            >
              {locality}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
