"use client"

import * as React from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { CarrierFormDialog } from "./carrier-form-dialog"

// The list page is a Server Component, so the dialog's open state needs a
// client boundary of its own.
export function AddCarrierButton() {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        Add carrier
      </Button>
      <CarrierFormDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
