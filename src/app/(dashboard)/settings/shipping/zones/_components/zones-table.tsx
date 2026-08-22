import type { PostcodeZoneRow, } from "@/lib/queries/postcode-carrier-zones"
import type { CarrierRow } from "@/lib/queries/shipping-reference"
import { formatMoney } from "@/lib/format"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const COLUMN_COUNT = 5

// No client boundary: nothing on this table is interactive.
export function ZonesTable({
  rows,
  carriers,
}: {
  rows: PostcodeZoneRow[]
  carriers: CarrierRow[]
}) {
  const carrierNames = new Map(carriers.map((carrier) => [carrier.id, carrier.name]))

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">Postcode</TableHead>
            <TableHead>Locality</TableHead>
            <TableHead className="w-20">State</TableHead>
            <TableHead className="w-44">Carrier</TableHead>
            <TableHead className="w-40">Zone</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={COLUMN_COUNT}
                className="h-24 text-center text-muted-foreground"
              >
                No zone rows found.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono">
                  {row.postcode?.postcode ?? "—"}
                </TableCell>
                <TableCell className="font-medium">
                  {row.postcode?.locality ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.postcode?.state ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {carrierNames.get(row.carrier_id) ?? `Carrier ${row.carrier_id}`}
                </TableCell>
                <TableCell>
                  {row.zone.replace(/_/g, " ")}
                  {/* Zero on every row in the imported data; shown only where
                      it is not, so the column does not read as noise. */}
                  {row.surcharge > 0 && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      + {formatMoney(row.surcharge)} surcharge
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
