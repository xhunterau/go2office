"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { AlertTriangle } from "lucide-react"
import { toast } from "sonner"

import type { OrderTransaction } from "@/lib/queries/orders"
import { updateOrderTransaction } from "@/lib/actions/order"
import {
  transactionUpdateSchema,
  type TransactionUpdateInput,
} from "@/lib/validations/order"
import { useConfirm } from "@/components/providers/confirm-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Form } from "@/components/ui/form"
import {
  TransactionPriceField,
  TransactionQuantityField,
  TransactionSkuField,
  TransactionTitleField,
} from "./transaction-fields"

// Two forms, two save buttons, on purpose.
//
// custom_label and quantity are watched by
// order_transactions_rebuild_items_update: changing either deletes and
// regenerates every picked line under this transaction, losing manual pick
// locations and any hand-corrected row. Putting them under the same button as
// the title and price would make that a side effect of fixing a typo
// (docs/orders-ui.md 6.4). The confirmation sits on the half that rebuilds.
export function TransactionEditDialog({
  open,
  onOpenChange,
  orderId,
  transaction,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orderId: number
  transaction: OrderTransaction
}) {
  const confirm = useConfirm()
  const [isPending, startTransition] = React.useTransition()

  // Each form validates the whole payload but renders only its own half; the
  // other half is submitted unchanged, read from the saved transaction rather
  // than from the sibling form, so unsaved edits over there cannot ride along.
  const detailsDefaults: TransactionUpdateInput = {
    quantity: transaction.quantity,
    sale_price: transaction.sale_price,
    custom_label: transaction.custom_label ?? "",
    item_title: transaction.item_title ?? "",
  }

  const detailsForm = useForm<TransactionUpdateInput>({
    resolver: zodResolver(transactionUpdateSchema),
    defaultValues: detailsDefaults,
  })

  const pickForm = useForm<TransactionUpdateInput>({
    resolver: zodResolver(transactionUpdateSchema),
    defaultValues: detailsDefaults,
  })

  React.useEffect(() => {
    if (open) {
      detailsForm.reset(detailsDefaults)
      pickForm.reset(detailsDefaults)
    }
    // detailsDefaults is derived from `transaction`, which is the real
    // dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction])

  function save(values: TransactionUpdateInput) {
    startTransition(async () => {
      const result = await updateOrderTransaction(
        transaction.id,
        orderId,
        values
      )

      if (!result.success) {
        toast.error(result.error ?? "Something went wrong")
        return
      }

      toast.success(
        result.data?.rebuiltPickedItems
          ? "Line saved — picked items rebuilt"
          : "Line saved"
      )
      onOpenChange(false)
    })
  }

  function onSaveDetails(values: TransactionUpdateInput) {
    save({
      ...values,
      quantity: transaction.quantity,
      custom_label: transaction.custom_label ?? "",
    })
  }

  async function onSavePickList(values: TransactionUpdateInput) {
    const ok = await confirm({
      title: "Rebuild picked items",
      description:
        "Changing the SKU or quantity regenerates every picked line under this transaction from the product's current kit contents. Pick locations survive only for products still in the new expansion, and any hand-corrected line is replaced. This cannot be undone.",
      confirmText: "Save and rebuild",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!ok) return

    save({
      ...values,
      sale_price: transaction.sale_price,
      item_title: transaction.item_title ?? "",
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit line</DialogTitle>
          <DialogDescription>
            What the platform sold. The picked items underneath are derived from
            the SKU and quantity below.
          </DialogDescription>
        </DialogHeader>

        <Form {...detailsForm}>
          <form
            onSubmit={detailsForm.handleSubmit(onSaveDetails)}
            className="space-y-4"
          >
            <TransactionTitleField control={detailsForm.control} />
            <TransactionPriceField control={detailsForm.control} />

            <div className="flex justify-end">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : "Save title and price"}
              </Button>
            </div>
          </form>
        </Form>

        <div className="space-y-4 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
            <p className="text-sm text-warning-foreground">
              Saving either field below rebuilds this line&apos;s picked items
              from today&apos;s kit contents.
            </p>
          </div>

          <Form {...pickForm}>
            <form
              onSubmit={pickForm.handleSubmit(onSavePickList)}
              className="space-y-4"
            >
              <TransactionSkuField
                control={pickForm.control}
                description="The SKU the platform sold. Picked items are resolved from it."
              />
              <TransactionQuantityField control={pickForm.control} />

              <div className="flex justify-end">
                <Button type="submit" variant="destructive" disabled={isPending}>
                  {isPending ? "Saving..." : "Save and rebuild picked items"}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
