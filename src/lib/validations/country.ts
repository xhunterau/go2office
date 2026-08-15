import { z } from "zod"

// Mirrors the constraints declared in migration 20260809120000, with one
// deliberate asymmetry between the two fields.
export const countrySchema = z.object({
  // Not case-normalised. The column carries no case constraint, and
  // standardize_customer_address() looks the name up as
  // lower(country_name) = lower(btrim(customers.country)) -- so the stored
  // spelling never affects whether a customer's country resolves. That is what
  // lets the form offer titleCase() on blur as a suggestion the user can
  // overrule: "Bosnia and Herzegovina" has to survive being typed correctly.
  // Forcing it here would be the silent-rewrite trap of CLAUDE.md rule 19.
  country_name: z
    .string()
    .trim()
    .min(1, "Country name is required")
    .max(100, "Country name is too long"),
  // Uppercased outright, because here there is no preference to preserve: the
  // countries_code_format CHECK accepts ^[A-Z]{2}$ and nothing else. Accepting
  // 'au' and lifting it is friendlier than rejecting it, and lands on the same
  // stored value -- the same reasoning as padding a short postcode.
  country_code: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Country code must be two letters, like AU")
    .transform((value) => value.toUpperCase()),
})

export type CountryInput = z.input<typeof countrySchema>
export type CountryParsed = z.output<typeof countrySchema>
