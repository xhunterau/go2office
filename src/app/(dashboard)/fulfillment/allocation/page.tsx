import Link from "next/link"
import { ArrowRight, ChevronRight, Info, MapPin, Printer, Truck } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { countAddressQueue, countPostageQueue } from "@/lib/queries/allocation"
import { fetchOrderStatusCounts } from "@/lib/queries/orders"
import { cn } from "@/lib/utils"

import { AllocationHeader } from "./_components/allocation-header"

const numberFormatter = new Intl.NumberFormat("en-AU")

export default async function AllocationPage() {
  const supabase = await createClient()

  const [address, postage, statusCounts] = await Promise.all([
    countAddressQueue(supabase),
    countPostageQueue(supabase),
    fetchOrderStatusCounts(supabase),
  ])

  const steps = [
    {
      href: "/fulfillment/allocation/address",
      step: 1,
      title: "Address",
      icon: MapPin,
      count: address.data,
      summary: "Suburb and postcode do not match the postcode reference. Fix or accept each one.",
    },
    {
      href: "/fulfillment/allocation/postage",
      step: 2,
      title: "Postage",
      icon: Truck,
      count: postage.data,
      summary: "Address confirmed. Compare every carrier's rate and approve one — nothing is automatic.",
    },
    {
      href: "/fulfillment/export-labels",
      step: 3,
      title: "Export labels",
      icon: Printer,
      count: statusCounts.counts?.byStatus.processing ?? null,
      summary: "Approved and in Processing. Labels are produced on the next page.",
      after: true,
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-6">
      <AllocationHeader
        title="Order Allocation"
        description={
          <>
            The two checks every <strong>Pending</strong> order passes before it can ship. Approving an order
            moves it to <strong>Processing</strong>.
          </>
        }
        active={null}
        counts={null}
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
        {steps.map((step, index) => (
          <div key={step.href} className="flex flex-col items-center gap-3 md:flex-1 md:flex-row">
            <Link
              href={step.href}
              className={cn(
                "group flex w-full flex-1 flex-col gap-2 self-stretch rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40",
                step.after ? "border-dashed border-border" : "border-border"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums text-muted-foreground">
                  {step.step}
                </span>
                <step.icon className="size-4 text-muted-foreground" />
                <span className="font-medium text-foreground">{step.title}</span>
                <ArrowRight className="ml-auto size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <p
                className={cn(
                  "text-3xl font-semibold tabular-nums",
                  step.count ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {step.count == null ? "—" : numberFormatter.format(step.count)}
              </p>
              <p className="text-sm text-muted-foreground">{step.summary}</p>
            </Link>
            {index < steps.length - 1 ? (
              <ChevronRight className="size-5 shrink-0 rotate-90 text-muted-foreground md:rotate-0" />
            ) : null}
          </div>
        ))}
      </div>

      {/* Explains an absence, which is only noticeable from the overview. */}
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Australian orders only — the postcode reference is Australian and there is no international carrier
          contract. Overseas orders stay on{" "}
          <Link href="/orders?status=pending" className="underline underline-offset-4">
            Orders
          </Link>{" "}
          and are handled by hand.
        </span>
      </p>
    </div>
  )
}
