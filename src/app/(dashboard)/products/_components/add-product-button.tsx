"use client"

import * as React from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  ProductFormDialog,
  type BrandOption,
  type OriginOption,
  type SupplierOption,
} from "./product-form-dialog"

export function AddProductButton({
  brands,
  origins,
  suppliers,
}: {
  brands: BrandOption[]
  origins: OriginOption[]
  suppliers: SupplierOption[]
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        Add Product
      </Button>
      <ProductFormDialog
        open={open}
        onOpenChange={setOpen}
        brands={brands}
        origins={origins}
        suppliers={suppliers}
      />
    </>
  )
}
