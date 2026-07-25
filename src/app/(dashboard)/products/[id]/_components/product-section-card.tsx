"use client"

import * as React from "react"
import { Pencil } from "lucide-react"

import type { ProductSection } from "@/lib/validations/product"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PRODUCT_SECTION_TITLES, type SectionFormValues } from "./product-fields"
import {
  ProductSectionDialog,
  type SectionLookups,
} from "./product-section-dialog"

// `fullWidth` marks the long-form rows (descriptions, notes) that would be
// unreadable squeezed into half a column.
export type SectionRow = {
  label: string
  value: React.ReactNode
  fullWidth?: boolean
}

// Read view of one section, with the Edit affordance that opens the shared
// section dialog. Values are pre-formatted by the server component so prices,
// lookups and timestamps each keep their own display rules.
export function ProductSectionCard({
  section,
  productId,
  rows,
  initialValues,
  lookups,
  className,
}: {
  section: ProductSection
  productId: number
  rows: SectionRow[]
  initialValues: SectionFormValues
  lookups: SectionLookups
  className?: string
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">
          {PRODUCT_SECTION_TITLES[section]}
        </CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <Pencil />
            Edit
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4">
          {rows.map((row) => (
            <div
              key={row.label}
              className={cn("grid gap-1", row.fullWidth && "col-span-2")}
            >
              <dt className="text-xs font-medium text-muted-foreground">
                {row.label}
              </dt>
              <dd className="text-sm break-words whitespace-pre-wrap text-foreground">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>

      <ProductSectionDialog
        open={open}
        onOpenChange={setOpen}
        productId={productId}
        section={section}
        initialValues={initialValues}
        lookups={lookups}
      />
    </Card>
  )
}
