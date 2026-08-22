import { createClient } from "@/lib/supabase/server"
import {
  fetchPackageSpecCoverage,
  fetchPackageSpecs,
} from "@/lib/queries/shipping-reference"
import { ShippingSectionHeader } from "../_components/section-header"
import { AddPackageSpecButton } from "./_components/add-package-spec-button"
import { PackageSpecsTable } from "./_components/package-specs-table"

export default async function PackageSpecsPage() {
  const supabase = await createClient()
  const list = await fetchPackageSpecs(supabase)
  const coverage = list.data
    ? await fetchPackageSpecCoverage(supabase, list.data)
    : { data: null, error: list.error }

  if (!list.data || !coverage.data) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <ShippingSectionHeader
          title="Flat-Rate Package Specs"
          description="Satchel and box dimensions."
        />
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Failed to load package specs: {list.error ?? coverage.error}
        </div>
      </div>
    )
  }

  const satchels = list.data.filter((row) => row.package_type === "satchel")
  const boxes = list.data.filter((row) => row.package_type === "box")
  const coverageEntries = [...coverage.data]

  return (
    <div className="flex flex-1 flex-col gap-6">
      <ShippingSectionHeader
        title="Flat-Rate Package Specs"
        description={
          <p>
            The packaging, not the weight, sets a flat-rate price: each size is
            billed as if it weighed the amount below, however light the contents
            are. Dimensions decide whether an order fits — and the packed size
            behind that check is an estimate for any order containing a product
            with no dimensions of its own.
          </p>
        }
        action={<AddPackageSpecButton />}
      />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Satchels</h2>
          <p className="text-xs text-muted-foreground">
            {/* Why a satchel is judged in 2D: it is a flat sleeve, so the
                item's thickness eats into both other axes as it wraps. */}
            Fits when <span className="font-mono">longest + shortest ≤ Length</span>{" "}
            and <span className="font-mono">middle + shortest ≤ Width</span> — the
            sleeve has to close around the item&apos;s thickness, so it counts
            twice.
          </p>
        </div>
        <PackageSpecsTable
          rows={satchels}
          coverage={coverageEntries}
          packageType="satchel"
        />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Boxes</h2>
          <p className="text-xs text-muted-foreground">
            Fits when <span className="font-mono">longest ≤ Length</span>,{" "}
            <span className="font-mono">middle ≤ Width</span> and{" "}
            <span className="font-mono">shortest ≤ Depth</span> — strict 3D
            containment against the box&apos;s own walls.
          </p>
        </div>
        <PackageSpecsTable
          rows={boxes}
          coverage={coverageEntries}
          packageType="box"
        />
      </section>
    </div>
  )
}
