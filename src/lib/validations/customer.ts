import { z } from "zod"

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long`)
    .optional()
    .or(z.literal(""))

export const customerSchema = z
  .object({
    // Uniqueness is enforced by customers_platform_user_id_unique, not here: a
    // pre-check would be a race and a second round trip. The 23505 is
    // translated in the action instead.
    platform_user_id: optionalText(255, "Platform user ID"),
    full_name: optionalText(255, "Name"),
    email: z
      .string()
      .trim()
      .max(255, "Email is too long")
      .refine((v) => v === "" || z.email().safeParse(v).success, {
        message: "Enter a valid email address",
      })
      .optional()
      .or(z.literal("")),
    phone: optionalText(50, "Phone"),
    company_name: optionalText(255, "Company"),
    // The address is the customer's CURRENT address and is shared by every one
    // of their orders, including past ones -- orders keep no snapshot of their
    // own (docs/orders-ui.md 6.3 / 7.3). The form says so; this is the note for
    // whoever changes the schema.
    address_line1: optionalText(255, "Address line 1"),
    address_line2: optionalText(255, "Address line 2"),
    address_line3: optionalText(255, "Address line 3"),
    address_line4: optionalText(255, "Address line 4"),
    // Labelled "Suburb" in the UI. See parseCustomerFilters for why the column
    // is called city.
    city: optionalText(120, "Suburb"),
    // Not constrained to a list: migrated verbatim, so both `NSW` and
    // `New South Wales` are in there and normalising on save would silently
    // rewrite one of the two.
    state: optionalText(120, "State"),
    postcode: optionalText(20, "Postcode"),
    country: optionalText(120, "Country"),
  })
  // Every field is individually optional, but a customer with nothing in it is
  // not a customer. Without this a blank submit creates an unfindable row.
  .refine(
    (data) => Object.values(data).some((value) => (value ?? "").trim() !== ""),
    { message: "Enter at least one detail", path: ["full_name"] }
  )

export type CustomerInput = z.infer<typeof customerSchema>
