import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { cn } from "@/lib/utils"
import type { KitComponentCost, ProductPricing } from "@/lib/queries/product-pricing"
import type { ProductKitItem } from "@/lib/queries/product-kit-items"
import {
  formatDimensions,
  formatMoney,
  formatPercent,
  formatVolume,
  formatWeight,
} from "@/lib/pricing"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// How each origin bills freight, spelled out so the panel explains the number
// instead of just printing it.
const FREIGHT_LABEL: Record<string, string> = {
  SF: "Sea freight, billed per m³",
  AF: "Air freight, billed per kg",
  LP: "Local purchase, no international freight",
}

export function ProductPricingPanel({
  pricing,
  error,
  kitItems = [],
  kitCosts = [],
  kitCostsError = null,
}: {
  pricing: ProductPricing | null
  error: string | null
  // Supplied for kits only: the composition rows carry the SKU and name, the
  // cost rows carry what each line contributes to the roll-up.
  kitItems?: ProductKitItem[]
  kitCosts?: KitComponentCost[]
  kitCostsError?: string | null
}) {
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
        Failed to load pricing: {error}
      </div>
    )
  }

  if (!pricing) {
    return (
      <Card>
        <CardContent className="py-14 text-center text-sm text-muted-foreground">
          No pricing available for this product.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <div className="grid items-start gap-4">
        {pricing.is_kit ? (
          <>
            <KitRollUpCard
              pricing={pricing}
              items={kitItems}
              costs={kitCosts}
              error={kitCostsError}
            />
            <KitDerivedCard pricing={pricing} />
          </>
        ) : (
          <UnitCostCard pricing={pricing} />
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Retail & Margin</CardTitle>
          <CardDescription>
            Retail prices are GST-inclusive shelf prices; margin is calculated on
            the GST-exclusive amount.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <PriceBlock
            title="Suggested"
            note={
              pricing.markup_multiplier
                ? `${pricing.markup_multiplier}× landed cost`
                : "No markup tier matched"
            }
            price={pricing.suggested_retail_price}
            profit={pricing.suggested_retail_profit}
            margin={pricing.suggested_retail_margin_pct}
          />

          <Separator />

          <PriceBlock
            title="Current"
            note={
              pricing.retail_price === null ? "No retail price set" : undefined
            }
            price={pricing.retail_price}
            profit={pricing.retail_profit}
            margin={pricing.retail_margin_pct}
            highlightLowMargin
          />

          <GapNote pricing={pricing} />
        </CardContent>
      </Card>
    </div>
  )
}

// A bought-in product: one purchase price, converted, plus freight.
function UnitCostCard({ pricing }: { pricing: ProductPricing }) {
  // Purchase price is the only input that can be missing; without it there is no
  // cost and every figure below it is null.
  const hasCost = pricing.unit_cost_aud !== null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Landed Unit Cost</CardTitle>
        <CardDescription>
          Purchase price converted to AUD plus freight to our warehouse,
          excluding GST.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {!hasCost && (
          <p className="rounded-lg bg-muted p-3 text-muted-foreground">
            This product has no currency or purchase price, so no cost can be
            calculated.
          </p>
        )}

        <Line
          label="Purchase price"
          note={
            pricing.currency
              ? `${pricing.currency} ${pricing.purchase_price ?? "—"}`
              : undefined
          }
          value={formatMoney(pricing.purchase_price_aud)}
        />

        <Separator />

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Freight</span>
            <span className="font-medium tabular-nums">
              {formatMoney(pricing.freight_cost_aud)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {FREIGHT_LABEL[pricing.origin_abbr ?? ""] ??
              `${pricing.origin_name ?? "Unknown origin"}, billed as sea freight`}
          </p>
          <ChargeableBasis pricing={pricing} />
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">Unit cost (ex-GST)</span>
          <span className="text-base font-semibold tabular-nums">
            {formatMoney(pricing.unit_cost_aud)}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

// A kit: its cost is the sum of what its components already cost us, so the
// breakdown IS the explanation. No freight line — see the note in the card.
function KitRollUpCard({
  pricing,
  items,
  costs,
  error,
}: {
  pricing: ProductPricing
  items: ProductKitItem[]
  costs: KitComponentCost[]
  error: string | null
}) {
  const componentById = new Map(
    items.map((item) => [item.component_product_id, item.component])
  )

  // Line totals are rounded to cents for display while the roll-up sums the
  // components at full precision, so the column can legitimately fail to add up
  // to the total by a few cents. Say so rather than let it look like a bug.
  const displayedTotal = costs.reduce(
    (sum, cost) => sum + (cost.lineCostAud ?? 0),
    0
  )
  const totalsDisagree =
    pricing.unit_cost_aud !== null &&
    costs.every((cost) => cost.lineCostAud !== null) &&
    Math.abs(displayedTotal - pricing.unit_cost_aud) >= 0.005

  return (
    <Card>
      <CardHeader>
        <CardTitle>Component Roll-up</CardTitle>
        <CardDescription>
          A kit costs what its components already cost us. Each of those prices
          carries its own import freight, so nothing further is added here.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {error && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive">
            Failed to load the component breakdown: {error}
          </p>
        )}

        {costs.length === 0 ? (
          <p className="rounded-lg bg-muted p-3 text-muted-foreground">
            This kit has no components yet, so it has no cost. Add them on the
            Kit Components tab.
          </p>
        ) : (
          <>
            {pricing.unit_cost_aud === null && (
              <p className="rounded-lg bg-muted p-3 text-muted-foreground">
                At least one component has no cost of its own — either it is
                missing a purchase price, or it is itself a kit, which is not
                expanded. The kit total is left blank rather than understated.
              </p>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit cost</TableHead>
                    <TableHead className="text-right">Line total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costs.map((cost) => {
                    const component = componentById.get(cost.componentProductId)
                    return (
                      <TableRow key={cost.componentProductId}>
                        <TableCell className="font-mono">
                          <Link
                            href={`/products/${cost.componentProductId}`}
                            className="hover:underline"
                          >
                            {component?.sku ?? `#${cost.componentProductId}`}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {cost.qty}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(cost.unitCostAud)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(cost.lineCostAud)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">Unit cost (ex-GST)</span>
              <span className="text-base font-semibold tabular-nums">
                {formatMoney(pricing.unit_cost_aud)}
              </span>
            </div>

            {totalsDisagree && (
              <p className="text-xs text-muted-foreground">
                The total is computed from unrounded component costs, so it can
                differ by a few cents from the rounded lines above.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// Weight and dimensions a kit does not have of its own. They cost nothing today
// (a local purchase pays no freight) but they are what gets shipped out.
function KitDerivedCard({ pricing }: { pricing: ProductPricing }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Derived Attributes</CardTitle>
        <CardDescription>
          Rolled up from the components, not entered on the kit itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <Line
          label="Weight"
          note="Sum of every component, times its quantity"
          value={formatWeight(pricing.weight)}
        />
        <Separator />
        <Line
          label="Dimensions (L × W × H)"
          note="Longest and second-longest component edge; height is what holds the combined volume"
          value={formatDimensions(
            pricing.length_mm,
            pricing.width_mm,
            pricing.height_mm
          )}
        />
        <Separator />
        <Line
          label="Volume"
          note="Sum of the component volumes, with no allowance for packing voids"
          value={formatVolume(pricing.volume_cbm)}
        />
      </CardContent>
    </Card>
  )
}

function Line({
  label,
  note,
  value,
}: {
  label: string
  note?: string
  value: string
}) {
  return (
    <div className="grid gap-0.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{value}</span>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

// Spells out volume vs weight and which one the freight was billed on. Without
// this the freight figure is unexplainable, and a mis-entered dimension is
// invisible.
function ChargeableBasis({ pricing }: { pricing: ProductPricing }) {
  if (pricing.chargeable_basis === "none") return null

  const billedByWeight = pricing.chargeable_basis === "weight"
  const isAir = pricing.origin_abbr === "AF"
  const chargeable = isAir
    ? formatWeight(pricing.chargeable_kg)
    : formatVolume(pricing.chargeable_cbm)

  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span>Volume {formatVolume(pricing.volume_cbm)}</span>
      <span aria-hidden>·</span>
      <span>Weight {formatWeight(pricing.weight)}</span>
      <ArrowRight className="size-3" aria-hidden />
      <span className="font-medium text-foreground">{chargeable}</span>
      <Badge variant="secondary" className="text-[10px]">
        by {billedByWeight ? "weight" : "volume"}
      </Badge>
    </p>
  )
}

function PriceBlock({
  title,
  note,
  price,
  profit,
  margin,
  highlightLowMargin = false,
}: {
  title: string
  note?: string
  price: number | null
  profit: number | null
  margin: number | null
  highlightLowMargin?: boolean
}) {
  // 30% on the GST-exclusive amount is roughly where an imported item stops
  // covering fulfilment overhead — worth flagging, not blocking.
  const isLow = highlightLowMargin && margin !== null && margin < 30

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{title}</span>
        <span className="text-base font-semibold tabular-nums">
          {formatMoney(price)}
        </span>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">Profit {formatMoney(profit)}</span>
        <span
          className={cn(
            "font-medium tabular-nums",
            isLow ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {formatPercent(margin)} margin
        </span>
      </div>
    </div>
  )
}

// Only worth saying when the two prices actually disagree.
function GapNote({ pricing }: { pricing: ProductPricing }) {
  const { retail_price: current, suggested_retail_price: suggested } = pricing
  if (current === null || suggested === null || current === suggested) return null

  const under = current < suggested
  return (
    <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
      Current price is {formatMoney(Math.abs(current - suggested))}{" "}
      {under ? "below" : "above"} the suggestion.
    </p>
  )
}
