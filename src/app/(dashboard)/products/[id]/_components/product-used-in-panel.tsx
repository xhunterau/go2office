import Link from "next/link"
import { ImageOff, PackageSearch } from "lucide-react"

import type { ProductKitParent } from "@/lib/queries/product-kit-items"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// The "Used In" tab: the reverse of Kit Components. Read-only — a line is
// added or removed from the owning kit's own page — so this stays a Server
// Component. Each SKU links straight to that kit's Kit Components tab.
export function ProductUsedInPanel({
  parents,
  error,
}: {
  parents: ProductKitParent[]
  error: string | null
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Used In</CardTitle>
        <CardDescription>
          {parents.length === 0
            ? "The kits that include this product."
            : `This product is a component of ${parents.length} kit${
                parents.length === 1 ? "" : "s"
              }.`}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load kits: {error}
          </div>
        ) : parents.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <PackageSearch className="size-5" />
            </div>
            <div className="grid gap-1">
              <p className="text-sm font-medium text-foreground">
                Not used in any kit
              </p>
              <p className="max-w-md text-sm text-muted-foreground">
                No kit lists this product as a component yet. Add it from the
                Kit Components tab of the kit itself.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Image</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Qty in Kit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parents.map((parent) => {
                  const kit = parent.kit
                  const sku = kit?.sku ?? `#${parent.kit_product_id}`

                  return (
                    <TableRow key={parent.id}>
                      <TableCell>
                        {kit?.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={kit.image_url}
                            alt={kit.name ?? sku}
                            className="size-10 rounded-md object-cover"
                          />
                        ) : (
                          <div className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            <ImageOff className="size-4" />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/products/${parent.kit_product_id}?tab=kit`}
                            className="hover:underline"
                          >
                            {sku}
                          </Link>
                          {kit && !kit.is_active && (
                            <Badge variant="secondary">Inactive</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{kit?.name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {parent.qty}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
