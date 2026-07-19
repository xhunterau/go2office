import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ImageOff } from "lucide-react"

import type { Database } from "@/lib/supabase/database.types"
import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// Single product row plus the joined lookup labels used on this page.
type ProductDetail = Database["public"]["Tables"]["products"]["Row"] & {
  brands: { name: string | null; abbr: string | null } | null
  origins: { name: string | null; abbr: string | null } | null
  suppliers: { company_name: string | null } | null
}

const DETAIL_COLUMNS =
  "*, brands(name, abbr), origins(name, abbr), suppliers(company_name)"

// Render an empty value as an em dash for consistent, readable blanks.
function display(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—"
  return String(value)
}

function formatPrice(
  value: number | null,
  currency: Database["public"]["Enums"]["currency_code"] | null
): string {
  if (value === null) return "—"
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: currency ?? "AUD",
  }).format(value)
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

// A single label/value pair inside a detail card.
function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: idParam } = await params
  const id = Number(idParam)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("products")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle()

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
        Failed to load product: {error.message}
      </div>
    )
  }

  if (!data) notFound()

  const product = data as ProductDetail

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="w-fit -ml-2 text-muted-foreground"
        >
          <Link href="/products">
            <ArrowLeft />
            Products
          </Link>
        </Button>

        <div className="flex items-start gap-4">
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image_url}
              alt={product.name ?? product.sku}
              className="size-16 rounded-lg border border-border object-cover"
            />
          ) : (
            <div className="flex size-16 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
              <ImageOff className="size-5" />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold text-foreground">
              {product.name ?? "Untitled product"}
            </h1>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">
                {product.sku}
              </span>
              <Badge variant={product.is_active ? "default" : "secondary"}>
                {product.is_active ? "Active" : "Inactive"}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Basic</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Name">{display(product.name)}</Field>
              <Field label="SKU">
                <span className="font-mono">{product.sku}</span>
              </Field>
              <Field label="Brand">{display(product.brands?.name)}</Field>
              <Field label="Origin">{display(product.origins?.name)}</Field>
              <Field label="Supplier">
                {display(product.suppliers?.company_name)}
              </Field>
              <Field label="Model">{display(product.model)}</Field>
              <Field label="UPC">{display(product.upc)}</Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pricing</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Currency">{display(product.currency)}</Field>
              <Field label="Purchase Price">
                {formatPrice(product.purchase_price, product.currency)}
              </Field>
              <Field label="Retail Price">
                {formatPrice(product.retail_price, product.currency)}
              </Field>
              <Field label="GST">{product.is_gst ? "Yes" : "No"}</Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Logistics</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Weight">{display(product.weight)}</Field>
              <Field label="Length">{display(product.length)}</Field>
              <Field label="Width">{display(product.width)}</Field>
              <Field label="Height">{display(product.height)}</Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Flags &amp; Meta</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Active">{product.is_active ? "Yes" : "No"}</Field>
              <Field label="Kit">{product.is_kit ? "Yes" : "No"}</Field>
              <Field label="Created At">{formatDate(product.created_at)}</Field>
              <Field label="Updated At">{formatDate(product.updated_at)}</Field>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
