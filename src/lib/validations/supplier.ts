import { z } from "zod"

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} is too long`).optional().or(z.literal(""))

export const supplierSchema = z.object({
  company_name: z
    .string()
    .trim()
    .min(1, "Company name is required")
    .max(255, "Company name is too long"),
  contact_person: optionalText(255, "Contact person"),
  email: z
    .string()
    .trim()
    .max(255, "Email is too long")
    .email("Enter a valid email address")
    .optional()
    .or(z.literal("")),
  phone: optionalText(50, "Phone"),
  comments: optionalText(1000, "Comments"),
})

export type SupplierInput = z.infer<typeof supplierSchema>
