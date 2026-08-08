"use client"

import type * as React from "react"
import type { Control } from "react-hook-form"

import type { TransactionUpdateInput } from "@/lib/validations/order"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"

// The four transaction fields, shared by the add and edit dialogs.
//
// Both schemas are the same four columns, but the two dialogs lay them out
// differently on purpose: the edit dialog splits SKU and quantity into their own
// form because saving them rebuilds the picked items, while adding a line
// generates those items either way and needs no such split
// (docs/orders-ui.md 6.4). Sharing the fields keeps the number-input plumbing in
// one place without forcing the two layouts together.
type FieldControl = Control<TransactionUpdateInput>

// react-hook-form holds these as numbers, but an empty <input type="number">
// reads back as "". NaN is that empty state: it fails the zod number check with
// the field's own message, where coercing to 0 would silently save a zero.
function numericValue(value: number): number | string {
  return Number.isNaN(value) ? "" : value
}

function toNumber(raw: string): number {
  return raw === "" ? Number.NaN : Number(raw)
}

export function TransactionTitleField({ control }: { control: FieldControl }) {
  return (
    <FormField
      control={control}
      name="item_title"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Item title</FormLabel>
          <FormControl>
            <Input {...field} value={field.value ?? ""} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function TransactionPriceField({
  control,
  description,
}: {
  control: FieldControl
  // Overridden when a picked product has no retail price to prefill: the field
  // is then the only thing standing between an empty form and a $0 order line.
  description?: React.ReactNode
}) {
  return (
    <FormField
      control={control}
      name="sale_price"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Unit price</FormLabel>
          <FormControl>
            <Input
              type="number"
              step="0.01"
              inputMode="decimal"
              value={numericValue(field.value)}
              onChange={(event) => field.onChange(toNumber(event.target.value))}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          </FormControl>
          <FormDescription>
            {/* Refunds and reversals were recorded as negative lines, down to
                -640.00 (docs/orders-ui.md 2). */}
            {description ?? "May be negative for a refund or reversal."}
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function TransactionSkuField({
  control,
  description,
}: {
  control: FieldControl
  description: string
}) {
  return (
    <FormField
      control={control}
      name="custom_label"
      render={({ field }) => (
        <FormItem>
          <FormLabel>SKU (custom label)</FormLabel>
          <FormControl>
            <Input {...field} value={field.value ?? ""} />
          </FormControl>
          <FormDescription>{description}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function TransactionQuantityField({
  control,
}: {
  control: FieldControl
}) {
  return (
    <FormField
      control={control}
      name="quantity"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Quantity</FormLabel>
          <FormControl>
            <Input
              type="number"
              step="1"
              min="1"
              inputMode="numeric"
              value={numericValue(field.value)}
              onChange={(event) => field.onChange(toNumber(event.target.value))}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
