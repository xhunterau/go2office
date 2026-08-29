import Link from "next/link"
import { ArrowRight, MapPin, Truck } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { countAddressQueue, countPostageQueue } from "@/lib/queries/allocation"

export default async function AllocationPage() {
  const supabase = await createClient()

  const [address, postage] = await Promise.all([
    countAddressQueue(supabase),
    countPostageQueue(supabase),
  ])

  const stages = [
    {
      href: "/fulfillment/allocation/address",
      title: "Address",
      icon: MapPin,
      count: address.data ?? 0,
      description:
        "Pending orders whose suburb and postcode do not match the postcode reference. Fix the address or accept it as it stands; either way the order moves on to Postage.",
    },
    {
      href: "/fulfillment/allocation/postage",
      title: "Postage",
      icon: Truck,
      count: postage.data ?? 0,
      description:
        "Orders with a confirmed address, waiting to be priced and approved. Every rate is shown and nothing is approved automatically — you pick the carrier on each order.",
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Order Allocation</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Two checks every <strong>Pending</strong> order passes before it can be
          shipped: is the address deliverable, and what will the carrier charge.
          Approving an order moves it to <strong>Processing</strong>, which is the
          queue{" "}
          <Link
            href="/fulfillment/export-labels"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Export Labels
          </Link>{" "}
          reads.
        </p>
      </div>

      {/* Said once, here, rather than on both stage pages: it explains an
          absence, and an absence is only noticeable from the overview. */}
      <p className="max-w-3xl text-xs text-muted-foreground">
        Australian orders only. The postcode reference is Australian and there is
        no international carrier contract, so overseas orders stay on{" "}
        <Link href="/orders" className="underline underline-offset-4">
          Orders
        </Link>{" "}
        and are handled by hand — 17 customers in the whole database.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {stages.map((stage) => (
          <Link
            key={stage.href}
            href={stage.href}
            className="group flex flex-col gap-2 rounded-xl border border-border p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
          >
            <div className="flex items-center gap-2">
              <stage.icon className="size-4 text-muted-foreground" />
              <span className="font-medium text-foreground">{stage.title}</span>
              <ArrowRight className="ml-auto size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <p className="flex-1 text-sm text-muted-foreground">{stage.description}</p>
            <p className="text-sm font-medium tabular-nums text-foreground">
              {stage.count === 0
                ? "Nothing waiting"
                : `${stage.count} order${stage.count === 1 ? "" : "s"} waiting`}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
