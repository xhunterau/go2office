"use client"

import * as React from "react"
import { Plus } from "lucide-react"
import { toast } from "sonner"

import { loadCustomer } from "@/lib/actions/customer"
import { customerDisplayName } from "@/lib/customers/display-name"
import { Button } from "@/components/ui/button"
import { CustomerPickerDialog } from "@/components/customers/customer-picker-dialog"
import {
  NewOrderDetailsDialog,
  type NewOrderCustomer,
} from "@/app/(dashboard)/orders/_components/new-order-details-dialog"

/**
 * Hand-made order, step 1 of 2: who it is for (docs/manual-order-create.md).
 *
 * The shared picker does the finding and creating; once a customer is chosen
 * the details dialog takes over. Lines are not entered here -- the order page's
 * Add line dialog already does that, so the new order opens there.
 */
export function NewOrderButton() {
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [customer, setCustomer] = React.useState<NewOrderCustomer | null>(null)

  async function handlePick(customerId: number): Promise<boolean> {
    const result = await loadCustomer(customerId)
    if (!result.success || !result.data) {
      toast.error(result.error ?? "Could not load the customer")
      return false
    }
    setCustomer({ id: customerId, name: customerDisplayName(result.data) })
    return true
  }

  return (
    <>
      <Button variant="outline" onClick={() => setPickerOpen(true)}>
        <Plus />
        New order
      </Button>

      <CustomerPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="New order"
        description="Who is this order for? Search for the customer, or create them here."
        confirmLabel="Next"
        onPick={handlePick}
      />

      <NewOrderDetailsDialog
        customer={customer}
        onOpenChange={(open) => {
          if (!open) setCustomer(null)
        }}
      />
    </>
  )
}
