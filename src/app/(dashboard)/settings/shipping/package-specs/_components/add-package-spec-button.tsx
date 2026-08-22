"use client"

import * as React from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PackageSpecFormDialog } from "./package-spec-form-dialog"

export function AddPackageSpecButton() {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        Add spec
      </Button>
      <PackageSpecFormDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
