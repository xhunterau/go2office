import { z } from "zod"

export const locationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(50, "Name is too long"),
  comments: z
    .string()
    .trim()
    .max(500, "Comments are too long")
    .optional()
    .or(z.literal("")),
})

export type LocationInput = z.infer<typeof locationSchema>
