"use client"

import * as React from "react"
import { Plus } from "lucide-react"

import type { CarrierRow } from "@/lib/queries/shipping-reference"
import { Button } from "@/components/ui/button"
import { DispatchOptionFormDialog } from "./dispatch-option-form-dialog"

export function AddDispatchOptionButton({
  carriers,
  serviceTypes,
  usedMethods,
}: {
  carriers: CarrierRow[]
  serviceTypes: [number, string[]][]
  usedMethods: string[]
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        Add option
      </Button>
      <DispatchOptionFormDialog
        open={open}
        onOpenChange={setOpen}
        carriers={carriers}
        serviceTypes={serviceTypes}
        usedMethods={usedMethods}
      />
    </>
  )
}
