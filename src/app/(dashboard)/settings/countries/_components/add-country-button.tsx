"use client"

import * as React from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { CountryFormDialog } from "./country-form-dialog"

// The list page is a Server Component, so the dialog's open state needs a
// client boundary of its own rather than being hoisted into the page.
export function AddCountryButton() {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        Add country
      </Button>
      <CountryFormDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
