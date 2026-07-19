import { z } from "zod"

export const brandSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255, "Name is too long"),
  abbr: z
    .string()
    .trim()
    .max(50, "Abbreviation is too long")
    .optional()
    .or(z.literal("")),
})

export type BrandInput = z.infer<typeof brandSchema>
