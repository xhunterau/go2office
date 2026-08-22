import Link from "next/link"
import {
  ArrowRight,
  Boxes,
  Map,
  Sliders,
  Table2,
  Truck,
} from "lucide-react"

import { createClient } from "@/lib/supabase/server"

// The order the quote engine reads them in, which is also the order they make
// sense in: a dispatch option picks the carrier, the carrier's zone decides the
// column, the rate card decides the price.
const SECTIONS = [
  {
    href: "/settings/shipping/dispatch-options",
    title: "Dispatch Options",
    icon: Sliders,
    description:
      "Which shipping methods get quoted at all, and the carrier and limits behind each. A method with no row here is never priced.",
  },
  {
    href: "/settings/shipping/rate-cards",
    title: "Rate Cards",
    icon: Table2,
    description:
      "Negotiated prices per weight tier and delivery zone, for the carriers that are priced from a table rather than an API.",
  },
  {
    href: "/settings/shipping/carriers",
    title: "Carriers",
    icon: Truck,
    description:
      "The accounts the business holds. Everything else on this page hangs off one of them.",
  },
  {
    href: "/settings/shipping/package-specs",
    title: "Package Specs",
    icon: Boxes,
    description:
      "Satchel and box dimensions, and the weight each is billed at. Decides whether an order fits a flat-rate option.",
  },
  {
    href: "/settings/shipping/constants",
    title: "Shipping Constants",
    icon: Sliders,
    description:
      "Australia Post's ceilings, the eParcel surcharges, and how close two quotes must be to count as the same price.",
  },
  {
    href: "/settings/shipping/zones",
    title: "Postcode Zones",
    icon: Map,
    description:
      "Which delivery zone each suburb falls in, per carrier. Read-only — this mapping is imported, not maintained here.",
  },
] as const

export default async function ShippingSettingsPage() {
  const supabase = await createClient()

  // Head counts only: `head: true` asks PostgREST for the count without the
  // rows, so the hub costs six index scans rather than six table reads.
  const [options, services, carriers, specs, zones] = await Promise.all([
    supabase
      .from("carrier_dispatch_options")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase.from("carrier_services").select("id", { count: "exact", head: true }),
    supabase
      .from("carriers")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase
      .from("flat_rate_package_specs")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("postcode_carrier_zones")
      .select("id", { count: "exact", head: true }),
  ])

  const counts: Record<string, string> = {
    "/settings/shipping/dispatch-options": countLabel(options.count, "active option"),
    "/settings/shipping/rate-cards": countLabel(services.count, "weight tier"),
    "/settings/shipping/carriers": countLabel(carriers.count, "active carrier"),
    "/settings/shipping/package-specs": countLabel(specs.count, "spec"),
    "/settings/shipping/zones": countLabel(zones.count, "row"),
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Shipping</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {/* The one thing none of these screens can show from its own rows. */}
          Reference data behind Re-quote Shipping on an order. Changes apply to
          the next quote onwards — quotes already recorded against an order keep
          the price that was quoted on the day, and are not recalculated.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group flex flex-col gap-2 rounded-xl border border-border p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
          >
            <div className="flex items-center gap-2">
              <section.icon className="size-4 text-muted-foreground" />
              <span className="font-medium text-foreground">{section.title}</span>
              <ArrowRight className="ml-auto size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <p className="text-sm text-muted-foreground">{section.description}</p>
            {counts[section.href] && (
              <p className="text-xs tabular-nums text-muted-foreground">
                {counts[section.href]}
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}

function countLabel(count: number | null, noun: string): string {
  if (count === null) return ""
  const formatted = new Intl.NumberFormat("en-AU").format(count)
  return `${formatted} ${noun}${count === 1 ? "" : "s"}`
}
