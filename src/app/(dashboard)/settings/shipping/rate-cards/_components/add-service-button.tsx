"use client"

import * as React from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ServiceFormDialog } from "./service-form-dialog"

export function AddServiceButton({ carrierId }: { carrierId: number }) {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        Add weight tier
      </Button>
      <ServiceFormDialog
        open={open}
        onOpenChange={setOpen}
        carrierId={carrierId}
      />
    </>
  )
}
