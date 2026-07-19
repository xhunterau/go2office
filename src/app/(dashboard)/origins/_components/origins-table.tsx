import type { Tables } from "@/lib/supabase/database.types"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Origin = Tables<"origins">

// Origins is a read-only lookup: no create, edit or delete.
export function OriginsTable({ origins }: { origins: Origin[] }) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Origins</h1>
        <p className="text-sm text-muted-foreground">
          Product origins (read-only).
        </p>
      </div>

      <div className="rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Abbreviation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {origins.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={2}
                  className="h-24 text-center text-muted-foreground"
                >
                  No origins yet.
                </TableCell>
              </TableRow>
            ) : (
              origins.map((origin) => (
                <TableRow key={origin.id}>
                  <TableCell className="font-medium">{origin.name}</TableCell>
                  <TableCell>{origin.abbr ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
