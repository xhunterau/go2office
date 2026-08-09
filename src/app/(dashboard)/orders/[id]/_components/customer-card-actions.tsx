"use client"

import * as React from "react"
import { Pencil, Replace } from "lucide-react"
import { toast } from "sonner"

import { replaceOrderCustomer } from "@/lib/actions/order"
import { useConfirm } from "@/components/providers/confirm-provider"
import { Button } from "@/components/ui/button"
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog"
import { CustomerPickerDialog } from "@/components/customers/customer-picker-dialog"

// The two things an operator does to the customer on an order: fix the details
// of the one that is on it, or put a different one on it. Edit reuses the same
// dialog as /customers, so the thirteen columns stay defined in one place.
//
// A client island inside the Server Component summary cards, kept to the button
// row rather than hoisted into the page (project rule 2).
export function CustomerCardActions({
  orderId,
  customerId,
}: {
  orderId: number
  customerId: number
}) {
  const confirm = useConfirm()
  const [editOpen, setEditOpen] = React.useState(false)
  const [pickerOpen, setPickerOpen] = React.useState(false)

  async function handlePick(nextCustomerId: number): Promise<boolean> {
    // Reversible -- replace it back and nothing is lost -- but it silently
    // rewrites the recipient and the address this page shows, so it is worth a
    // beat. Editing the customer instead is the other half of that warning:
    // people reach for Replace when what they meant was a typo fix.
    const ok = await confirm({
      title: "Replace customer",
      description:
        "This order moves to the selected customer. The name and address shown on it become that customer's current details, and the order leaves the previous customer's history. To correct a typo instead, use Edit.",
      confirmText: "Replace",
      cancelText: "Cancel",
    })
    if (!ok) return false

    const result = await replaceOrderCustomer(orderId, nextCustomerId)
    if (!result.success) {
      toast.error(result.error ?? "Something went wrong")
      return false
    }
    toast.success("Customer replaced")
    return true
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil />
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setPickerOpen(true)}>
          <Replace />
          Replace
        </Button>
      </div>

      <CustomerFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        customerId={customerId}
      />
      <CustomerPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentCustomerId={customerId}
        title="Replace customer"
        description="Pick the customer this order belongs to. If they are not on file yet, create them here."
        confirmLabel="Replace customer"
        onPick={handlePick}
      />
    </>
  )
}
